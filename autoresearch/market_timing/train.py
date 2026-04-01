# autoresearch/market_timing/train.py
"""
ALSTM 个股日频择时模型 — 在选股基础上做日频波段交易
目标：通过日频择时扩大选股收益（低吸高抛）
A股 T+1：当天买入次日才能卖
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
import torch
from data.storage import Storage
from models.alstm_model import MarketTimer
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return


def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


# === 配置 ===
DB_PATH = "../../data/cache/market.db"
SEQ_LEN = 20
HIDDEN_SIZE = 256
NUM_LAYERS = 2
DROPOUT = 0.4
LR = 1e-3
EPOCHS = 30
BATCH_SIZE = 1024

TRAIN_START = "2021-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"

# === 数据加载 ===
print("加载数据...")
storage = Storage(DB_PATH)
daily = storage.load_all_daily("2020-01-01", "2024-07-01")  # 多加载一些用于特征计算
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# === 构建个股级别特征 ===
print("构建个股日频特征...")

# 对每只股票计算技术指标
def compute_stock_features(df):
    """为单只股票计算日频特征"""
    df = df.copy().sort_values("date")
    df["ret_1"] = df["close"].pct_change(1)
    df["ret_3"] = df["close"].pct_change(3)
    df["ret_5"] = df["close"].pct_change(5)
    df["vol_5"] = df["ret_1"].rolling(5).std()
    df["vol_20"] = df["ret_1"].rolling(20).std()
    df["volume_ma5"] = df["volume"].rolling(5).mean()
    df["volume_ratio"] = df["volume"] / df["volume_ma5"].replace(0, np.nan)
    df["rsi_14"] = _compute_rsi(df["close"], 14)

    # 均线偏离
    df["ma_5"] = df["close"].rolling(5).mean()
    df["ma_20"] = df["close"].rolling(20).mean()
    df["ma_dev_5"] = df["close"] / df["ma_5"] - 1
    df["ma_dev_20"] = df["close"] / df["ma_20"] - 1

    # 价格位置（近20日高低点）
    df["high_20"] = df["high"].rolling(20).max()
    df["low_20"] = df["low"].rolling(20).min()
    df["price_pos"] = (df["close"] - df["low_20"]) / (df["high_20"] - df["low_20"]).replace(0, np.nan)

    return df

FEATURE_COLS = [
    "ret_1", "ret_3", "ret_5",
    "vol_5", "vol_20", "volume_ratio",
    "rsi_14", "ma_dev_5", "ma_dev_20", "price_pos",
]
INPUT_SIZE = len(FEATURE_COLS)

# 为所有股票计算特征
print("计算特征...")
all_stocks = []
codes = daily["code"].unique()
for code in codes:
    stock_df = daily[daily["code"] == code]
    if len(stock_df) < 60:
        continue
    stock_df = compute_stock_features(stock_df)
    stock_df = stock_df.dropna(subset=FEATURE_COLS)
    all_stocks.append(stock_df)

all_data = pd.concat(all_stocks, ignore_index=True)
print(f"总数据: {len(all_data)} 行, {all_data['code'].nunique()} 只股票")

# === 标签构建 ===
print("构建标签...")
# 未来1日收益率（日频择时）
all_data["future_1d_ret"] = all_data.groupby("code")["close"].transform(
    lambda x: x.pct_change().shift(-1)
)

# 二分类：明天涨(1) vs 明天跌(0)
# 用训练集的中位数作为阈值
train_data = all_data[(all_data["date"] >= TRAIN_START) & (all_data["date"] <= TRAIN_END)]
median_ret = train_data["future_1d_ret"].median()
all_data["label"] = (all_data["future_1d_ret"] > median_ret).astype(int)
all_data = all_data.dropna(subset=["future_1d_ret"]).reset_index(drop=True)

print(f"标签分布: 跌={sum(all_data['label']==0)}, 涨={sum(all_data['label']==1)}")

# === 按时间分割 ===
train_mask = (all_data["date"] >= TRAIN_START) & (all_data["date"] <= TRAIN_END)
val_mask = (all_data["date"] >= VAL_START) & (all_data["date"] <= VAL_END)

train_df = all_data[train_mask].copy()
val_df = all_data[val_mask].copy()

print(f"训练集: {len(train_df)} 行, 验证集: {len(val_df)} 行")

# === 准备序列数据 ===
print("准备序列训练数据...")

def prepare_sequences_by_stock(df, feature_cols, seq_len):
    """按股票分别创建序列"""
    X_all, y_all = [], []
    for code in df["code"].unique():
        stock = df[df["code"] == code].sort_values("date")
        features = stock[feature_cols].values.astype(np.float32)
        labels = stock["label"].values.astype(int)
        if len(features) < seq_len + 1:
            continue
        for i in range(seq_len, len(features)):
            X_all.append(features[i-seq_len:i])
            y_all.append(labels[i])
    return np.array(X_all, dtype=np.float32), np.array(y_all, dtype=np.int64)

# 标准化（用训练集统计量）
train_features = train_df[FEATURE_COLS].values
feat_mean = train_features.mean(axis=0).astype(np.float32)
feat_std = train_features.std(axis=0).astype(np.float32) + 1e-8

# 应用标准化到所有数据
all_data[FEATURE_COLS] = (all_data[FEATURE_COLS].values - feat_mean) / feat_std

# 重新分割标准化后的数据
train_df = all_data[train_mask].copy()
val_df = all_data[val_mask].copy()

X_train, y_train = prepare_sequences_by_stock(train_df, FEATURE_COLS, SEQ_LEN)
print(f"训练序列: {len(X_train)}, 特征维度: {X_train.shape}")

# === 模型训练 ===
print("训练 ALSTM...")
timer = MarketTimer(
    input_size=INPUT_SIZE, seq_len=SEQ_LEN, hidden_size=HIDDEN_SIZE,
    num_layers=NUM_LAYERS, num_classes=2, dropout=DROPOUT,
    lr=LR, epochs=EPOCHS, batch_size=BATCH_SIZE,
)
timer.train(X_train, y_train)

# === 日频择时回测 ===
def backtest_daily_timing(df, timer, feature_cols, seq_len):
    """
    日频个股择时回测
    模拟：对每只选中的股票，每天判断买入/卖出
    - 信号=买入且未持仓 → 买入（次日生效，T+1）
    - 信号=卖出且已持仓 → 卖出（次日生效，T+1）
    """
    daily_returns = []
    dates = sorted(df["date"].unique())

    for code in df["code"].unique():
        stock = df[df["code"] == code].sort_values("date")
        features = stock[feature_cols].values.astype(np.float32)
        closes = stock["close"].values
        stock_dates = stock["date"].values

        if len(features) < seq_len + 2:
            continue

        holding = False  # 是否持仓
        buy_day = -1     # 买入日（用于T+1）

        for i in range(seq_len, len(features) - 1):
            feat_window = features[i-seq_len:i]
            pred_class, confidence = timer.predict_proba(feat_window)

            # 明日收益
            tomorrow_ret = (closes[i+1] - closes[i]) / closes[i]

            if not holding:
                # 未持仓：看多信号 → 买入（次日生效）
                if pred_class == 1 and confidence >= 0.55:
                    holding = True
                    buy_day = i
                    # 买入日计入收益（次日价格变动）
                    daily_returns.append(tomorrow_ret)
                else:
                    daily_returns.append(0.0)  # 空仓无收益
            else:
                # 已持仓
                if pred_class == 0 and confidence >= 0.55 and i > buy_day:
                    # 看空信号且非买入当天(T+1) → 卖出
                    holding = False
                    daily_returns.append(0.0)  # 卖出日不计收益
                else:
                    # 继续持有
                    daily_returns.append(tomorrow_ret)

    if len(daily_returns) == 0:
        return 0.0, 0.0, 0.0

    rets = pd.Series(daily_returns)
    equity = (1 + rets).cumprod()
    sr = sharpe_ratio(rets, freq=252)
    ar = annual_return(equity, freq=252)
    dd = max_drawdown(equity)
    return sr, ar, dd

# === 回测 ===
print("回测...")
train_sr, train_ar, train_dd = backtest_daily_timing(train_df, timer, FEATURE_COLS, SEQ_LEN)
val_sr, val_ar, val_dd = backtest_daily_timing(val_df, timer, FEATURE_COLS, SEQ_LEN)

# === 输出 ===
print(f"")
print(f"训练集: 夏普={train_sr:.4f}, 年化={train_ar:.2%}, 回撤={train_dd:.2%}")
print(f"验证集: 夏普={val_sr:.4f}, 年化={val_ar:.2%}, 回撤={val_dd:.2%}")
print(f"VAL_SHARPE={val_sr:.4f}")
