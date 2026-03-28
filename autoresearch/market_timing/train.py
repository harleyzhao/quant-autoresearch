# autoresearch/market_timing/train.py
"""
ALSTM 择时模型训练与回测 — autoresearch agent 可编辑此文件
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
import torch
from data.storage import Storage
from models.alstm_model import MarketTimer
from backtest.metrics import sharpe_ratio


# === 辅助函数 ===
def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


# === 配置 ===
DB_PATH = "../../data/cache/market.db"
SEQ_LEN = 60
HIDDEN_SIZE = 128
NUM_LAYERS = 2
DROPOUT = 0.3
LR = 1e-3
EPOCHS = 50
BATCH_SIZE = 64
POSITION_THRESHOLD = 0.6

TRAIN_START = "2018-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"

# === 数据加载 ===
print("加载数据...")
storage = Storage(DB_PATH)
daily = storage.load_all_daily(TRAIN_START, "2024-07-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# === 构建市场级别特征 ===
print("构建市场特征...")

# 用全市场等权收益作为市场代理
market = daily.groupby("date").agg(
    close=("close", "mean"),
    volume=("volume", "mean"),
    high=("high", "mean"),
    low=("low", "mean"),
    n_stocks=("code", "count"),
).reset_index().sort_values("date")

# 涨跌家数
daily["ret"] = daily.groupby("code")["close"].pct_change()
up_down = daily.groupby("date")["ret"].agg(
    up_count=lambda x: (x > 0).sum(),
    down_count=lambda x: (x < 0).sum(),
    mean_ret=lambda x: x.mean(),
).reset_index()
market = market.merge(up_down, on="date", how="left")

# 市场特征
market["ret_1"] = market["close"].pct_change(1)
market["ret_5"] = market["close"].pct_change(5)
market["ret_10"] = market["close"].pct_change(10)
market["ret_20"] = market["close"].pct_change(20)
market["vol_5"] = market["close"].pct_change().rolling(5).std()
market["vol_20"] = market["close"].pct_change().rolling(20).std()
market["vol_ratio"] = market["vol_5"] / market["vol_20"].replace(0, np.nan)
market["volume_ma5"] = market["volume"].rolling(5).mean()
market["volume_ratio"] = market["volume"] / market["volume_ma5"].replace(0, np.nan)
market["up_ratio"] = market["up_count"] / (market["up_count"] + market["down_count"]).replace(0, np.nan)
market["ma5"] = market["close"].rolling(5).mean()
market["ma20"] = market["close"].rolling(20).mean()
market["ma_cross"] = market["ma5"] / market["ma20"].replace(0, np.nan) - 1
market["high_low_range"] = (market["high"] - market["low"]) / market["close"].replace(0, np.nan)
market["rsi_14"] = _compute_rsi(market["close"], 14)

market = market.dropna().reset_index(drop=True)

FEATURE_COLS = [
    "ret_1", "ret_5", "ret_10", "ret_20",
    "vol_5", "vol_20", "vol_ratio",
    "volume_ratio", "up_ratio", "ma_cross",
    "high_low_range", "rsi_14", "mean_ret",
]
INPUT_SIZE = len(FEATURE_COLS)

# === 标签构建 ===
print("构建标签...")
# 未来5个交易日收益率
market["future_5d_ret"] = market["close"].pct_change(5).shift(-5)

# 三分类: 看空(0), 中性(1), 看多(2)
q_low = market["future_5d_ret"].quantile(0.33)
q_high = market["future_5d_ret"].quantile(0.67)
market["label"] = 1  # 中性
market.loc[market["future_5d_ret"] <= q_low, "label"] = 0  # 看空
market.loc[market["future_5d_ret"] >= q_high, "label"] = 2  # 看多
market = market.dropna(subset=["future_5d_ret"]).reset_index(drop=True)

print(f"市场数据: {len(market)} 天")
print(f"标签分布: 看空={sum(market['label']==0)}, 中性={sum(market['label']==1)}, 看多={sum(market['label']==2)}")

# === 分割训练/验证 ===
train_mask = market["date"] <= TRAIN_END
val_mask = (market["date"] >= VAL_START) & (market["date"] <= VAL_END)

features = market[FEATURE_COLS].values.astype(np.float32)
labels = market["label"].values.astype(int)
dates = market["date"].values

# 标准化特征（用训练集的均值方差）
train_idx = np.where(train_mask)[0]
feat_mean = features[train_idx].mean(axis=0)
feat_std = features[train_idx].std(axis=0) + 1e-8
features = (features - feat_mean) / feat_std

# === 模型训练 ===
print("训练 ALSTM...")
timer = MarketTimer(
    input_size=INPUT_SIZE, seq_len=SEQ_LEN, hidden_size=HIDDEN_SIZE,
    num_layers=NUM_LAYERS, dropout=DROPOUT, lr=LR,
    epochs=EPOCHS, batch_size=BATCH_SIZE,
)

# 构建训练序列（只用训练集时间范围内的数据）
train_end_idx = train_idx[-1] + 1
train_features = features[:train_end_idx]
train_labels = labels[SEQ_LEN:train_end_idx]
timer.train(train_features, train_labels)

# === 回测函数 ===
def backtest_timing(features, labels, dates, mask, timer, seq_len):
    """择时回测：用模型预测仓位，计算收益"""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return 0.0, []

    positions = []
    weekly_returns = []

    # 每5天调仓一次（周频）
    i = 0
    while i < len(idx):
        t = idx[i]
        if t < seq_len:
            i += 5
            continue

        # 预测
        feat_window = features[t - seq_len:t]
        pred_class, confidence = timer.predict_proba(feat_window)
        position = timer.to_position(pred_class, confidence, POSITION_THRESHOLD)
        positions.append(position)

        # 未来5天的市场收益
        future_end = min(t + 5, len(features) - 1)
        if t + 1 <= future_end:
            period_ret = (features[future_end, 0] - features[t, 0])  # 用标准化后的ret_1不准确
            # 用原始的 future_5d_ret
            period_ret_raw = market.iloc[t]["future_5d_ret"] if t < len(market) else 0
            weekly_returns.append(position * period_ret_raw)

        i += 5

    if len(weekly_returns) == 0:
        return 0.0, []

    returns = pd.Series(weekly_returns)
    sr = sharpe_ratio(returns, freq=52)
    return sr, weekly_returns

# === 回测 ===
print("回测...")
train_sharpe, _ = backtest_timing(features, labels, dates, train_mask, timer, SEQ_LEN)
val_sharpe, _ = backtest_timing(features, labels, dates, val_mask, timer, SEQ_LEN)

# === 输出结果 ===
print(f"")
print(f"训练集夏普: {train_sharpe:.4f}")
print(f"验证集夏普: {val_sharpe:.4f}")
print(f"VAL_SHARPE={val_sharpe:.4f}")
