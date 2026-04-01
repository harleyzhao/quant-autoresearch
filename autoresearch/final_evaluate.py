"""
最终评估：在测试集(2024-07~2024-12)上验证选股和择时策略
"""
import sys
sys.path.insert(0, "..")

import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from models.alstm_model import MarketTimer
from backtest.engine import Backtester
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return


def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)

def _compute_macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast).mean()
    ema_slow = close.ewm(span=slow).mean()
    macd = ema_fast - ema_slow
    signal_line = macd.ewm(span=signal).mean()
    return macd - signal_line

def _compute_bollinger_position(close, period=20):
    ma = close.rolling(period).mean()
    std = close.rolling(period).std()
    return (close - ma) / (2 * std)


DB_PATH = "../data/cache/market.db"
storage = Storage(DB_PATH)

# ============================================================
# Part 1: 选股模型测试集验证
# ============================================================
print("=" * 60)
print("Part 1: 选股模型 — 测试集验证")
print("=" * 60)

FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

# 加载全部数据（含测试集）
factors = storage.load_all_factors("2018-01-01", "2025-01-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2018-01-01", "2025-01-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# 构建周频
daily["week"] = daily["date"].dt.isocalendar().week.astype(int)
daily["year"] = daily["date"].dt.year
weekly_prices = daily.groupby(["code", "year", "week"]).last().reset_index()
weekly_prices = weekly_prices.sort_values(["code", "date"])
weekly_prices["future_return"] = weekly_prices.groupby("code")["close"].pct_change().shift(-1)

factors["year"] = factors["date"].dt.year
factors["week"] = factors["date"].dt.isocalendar().week.astype(int)
weekly_factors = factors.groupby(["code", "year", "week"]).last().reset_index()

dataset = weekly_prices[["code", "date", "close", "future_return"]].merge(
    weekly_factors[["code", "date"] + FEATURE_COLS], on=["code", "date"], how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS + ["future_return"])

# 分割
train_df = dataset[(dataset["date"] >= "2018-01-01") & (dataset["date"] <= "2023-12-31")]
val_df = dataset[(dataset["date"] >= "2024-01-01") & (dataset["date"] <= "2024-06-30")]
test_df = dataset[(dataset["date"] >= "2024-07-01") & (dataset["date"] <= "2024-12-31")]

print(f"训练集: {len(train_df)} 行, 验证集: {len(val_df)} 行, 测试集: {len(test_df)} 行")

# 训练（用进化后的最优参数）
lgb_params = {
    "n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
    "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)

TOP_N = 50

def run_stock_backtest(df, selector, top_n):
    dates = sorted(df["date"].unique())
    price_records, weight_records = [], []
    for date in dates:
        week_data = df[df["date"] == date]
        scores = selector.predict(week_data)
        top = scores.nlargest(top_n, "score")
        selected = set(top["code"].values)
        price_row, weight_row = {}, {}
        for _, row in week_data.iterrows():
            price_row[row["code"]] = row["close"]
            weight_row[row["code"]] = 1.0 / top_n if row["code"] in selected else 0.0
        price_records.append(price_row)
        weight_records.append(weight_row)
    prices = pd.DataFrame(price_records, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_records, index=dates).fillna(0)
    common = sorted(set(prices.columns) & set(weights.columns))
    bt = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001)
    return bt.run(weights[common], prices[common])

print("\n--- 选股结果 ---")
for name, df in [("训练集", train_df), ("验证集", val_df), ("测试集", test_df)]:
    result = run_stock_backtest(df, selector, TOP_N)
    if result:
        print(f"{name}: 夏普={result.sharpe:.4f}, 年化={result.annual_ret:.2%}, 最大回撤={result.max_drawdown:.2%}, 换手={result.turnover:.2%}")

# ============================================================
# Part 2: 择时模型测试集验证
# ============================================================
print("\n" + "=" * 60)
print("Part 2: ALSTM择时模型 — 测试集验证")
print("=" * 60)

# 构建市场特征（全时间范围）
daily_all = storage.load_all_daily("2018-01-01", "2025-01-01")
daily_all["date"] = pd.to_datetime(daily_all["date"])
daily_all = daily_all.sort_values(["code", "date"])

market = daily_all.groupby("date").agg(
    close=("close", "mean"), volume=("volume", "mean"),
    high=("high", "mean"), low=("low", "mean"),
    n_stocks=("code", "count"),
).reset_index().sort_values("date")

daily_all["ret"] = daily_all.groupby("code")["close"].pct_change()
up_down = daily_all.groupby("date")["ret"].agg(
    up_count=lambda x: (x > 0).sum(),
    down_count=lambda x: (x < 0).sum(),
    mean_ret=lambda x: x.mean(),
).reset_index()
market = market.merge(up_down, on="date", how="left")

market["ret_1"] = market["close"].pct_change()
market["ret_5"] = market["close"].pct_change(5)
market["ret_10"] = market["close"].pct_change(10)
market["ret_20"] = market["close"].pct_change(20)
market["vol_5"] = market["ret_1"].rolling(5).std()
market["vol_10"] = market["ret_1"].rolling(10).std()
market["vol_20"] = market["ret_1"].rolling(20).std()
market["up_ratio"] = market["up_count"] / (market["up_count"] + market["down_count"]).replace(0, np.nan)
market["rsi"] = _compute_rsi(market["close"], 14)
market["macd"] = _compute_macd(market["close"])
market["boll_pos"] = _compute_bollinger_position(market["close"])
market["ma_20"] = market["close"].rolling(20).mean()
market["ma_ratio"] = market["close"] / market["ma_20"] - 1
market = market.dropna().reset_index(drop=True)

TIMING_FEATURES = ["ret_1", "ret_5", "ret_10", "ret_20", "vol_5", "vol_10", "vol_20",
                   "up_ratio", "rsi", "macd", "boll_pos", "ma_ratio"]

# 标签
market["future_3d_ret"] = market["close"].pct_change(3).shift(-3)
q33 = market["future_3d_ret"].quantile(0.33)
q67 = market["future_3d_ret"].quantile(0.67)
market["label"] = 1
market.loc[market["future_3d_ret"] <= q33, "label"] = 0
market.loc[market["future_3d_ret"] >= q67, "label"] = 2
market = market.dropna(subset=["future_3d_ret"]).reset_index(drop=True)

features = market[TIMING_FEATURES].values.astype(np.float32)
labels = market["label"].values.astype(np.int64)

# 标准化
train_mask = market["date"] <= "2023-12-31"
train_idx = np.where(train_mask)[0]
feat_mean = features[train_idx].mean(axis=0).astype(np.float32)
feat_std = features[train_idx].std(axis=0).astype(np.float32) + 1e-8
features = (features - feat_mean) / feat_std

# 训练 — 传 2D 数据，MarketTimer 内部自动做序列化
SEQ_LEN = 30
timer = MarketTimer(input_size=len(TIMING_FEATURES), seq_len=SEQ_LEN,
                    hidden_size=64, num_layers=1, num_classes=3,
                    dropout=0.5, lr=1e-3, epochs=30, batch_size=32)

train_end_idx = train_idx[-1] + 1
train_features = features[:train_end_idx]
train_labels = labels[SEQ_LEN:train_end_idx]
timer.train(train_features, train_labels)

# 回测
def backtest_timing(market_df, features, mask, timer, seq_len):
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return 0.0, 0.0, 0.0, []
    returns_list = []
    i = 0
    while i < len(idx):
        t = idx[i]
        if t < seq_len:
            i += 5
            continue
        feat_window = features[t - seq_len:t]
        pred_class, confidence = timer.predict_proba(feat_window)
        position = MarketTimer.to_position(pred_class, confidence, 0.6)
        if t + 5 < len(market_df):
            cur = market_df.iloc[t]["close"]
            fut = market_df.iloc[t + 5]["close"]
            ret = (fut - cur) / cur
            returns_list.append(position * ret)
        i += 5
    if not returns_list:
        return 0.0, 0.0, 0.0, []
    rets = pd.Series(returns_list)
    equity = (1 + rets).cumprod()
    sr = sharpe_ratio(rets, freq=52)
    dd = max_drawdown(equity)
    ar = annual_return(equity, freq=52)
    return sr, ar, dd, returns_list

val_mask = (market["date"] >= "2024-01-01") & (market["date"] <= "2024-06-30")
test_mask = (market["date"] >= "2024-07-01") & (market["date"] <= "2024-12-31")

print("\n--- 择时结果 ---")
for name, mask in [("训练集", train_mask), ("验证集", val_mask), ("测试集", test_mask)]:
    sr, ar, dd, _ = backtest_timing(market, features, mask, timer, SEQ_LEN)
    print(f"{name}: 夏普={sr:.4f}, 年化={ar:.2%}, 最大回撤={dd:.2%}")

# ============================================================
# Part 3: 总结
# ============================================================
print("\n" + "=" * 60)
print("最终总结")
print("=" * 60)
print("如果测试集夏普与验证集接近 → 策略有效，可考虑实盘")
print("如果测试集夏普大幅下降 → 过拟合，需继续优化")

# ============================================================
# Part 3: 合成策略 — 选股 × 择时
# ============================================================
print("\n" + "=" * 60)
print("Part 3: 合成策略 — 选股 × 择时")
print("=" * 60)

# 对每个时间段，合成选股和择时信号
def run_combined_backtest(stock_df, selector, top_n, market_df, features, mask, timer, seq_len):
    """选股 × 择时合成回测"""
    # 获取择时仓位（每周一个）
    idx = np.where(mask)[0]
    timing_positions = {}  # date → position

    i = 0
    while i < len(idx):
        t = idx[i]
        if t < seq_len:
            i += 5
            continue
        feat_window = features[t - seq_len:t]
        pred_class, confidence = timer.predict_proba(feat_window)
        position = MarketTimer.to_position(pred_class, confidence, 0.6)
        date = market_df.iloc[t]["date"]
        timing_positions[date] = position
        i += 5

    # 选股回测 + 择时仓位调整
    dates = sorted(stock_df["date"].unique())
    price_records, weight_records = [], []

    for date in dates:
        week_data = stock_df[stock_df["date"] == date]
        scores = selector.predict(week_data)
        top = scores.nlargest(top_n, "score")
        selected = set(top["code"].values)

        # 找最近的择时仓位
        timing_pos = 0.5  # 默认半仓
        date_ts = pd.Timestamp(date)
        for td in sorted(timing_positions.keys(), reverse=True):
            if pd.Timestamp(td) <= date_ts:
                timing_pos = timing_positions[td]
                break

        price_row, weight_row = {}, {}
        for _, row in week_data.iterrows():
            price_row[row["code"]] = row["close"]
            base_weight = 1.0 / top_n if row["code"] in selected else 0.0
            weight_row[row["code"]] = base_weight * timing_pos  # 乘以择时仓位

        price_records.append(price_row)
        weight_records.append(weight_row)

    prices = pd.DataFrame(price_records, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_records, index=dates).fillna(0)
    common = sorted(set(prices.columns) & set(weights.columns))
    bt = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001)
    return bt.run(weights[common], prices[common])

# 构建各时间段的 mask
train_timing_mask = market["date"] <= "2023-12-31"
val_timing_mask = (market["date"] >= "2024-01-01") & (market["date"] <= "2024-06-30")
test_timing_mask = (market["date"] >= "2024-07-01") & (market["date"] <= "2024-12-31")

print("\n--- 合成策略结果（选股 × 择时）---")
for name, stock_data, t_mask in [
    ("训练集", train_df, train_timing_mask),
    ("验证集", val_df, val_timing_mask),
    ("测试集", test_df, test_timing_mask),
]:
    result = run_combined_backtest(stock_data, selector, TOP_N, market, features, t_mask, timer, SEQ_LEN)
    if result:
        print(f"{name}: 夏普={result.sharpe:.4f}, 年化={result.annual_ret:.2%}, 最大回撤={result.max_drawdown:.2%}, 换手={result.turnover:.2%}")

print("\n--- 对比 ---")
print(f"{'策略':<15} {'训练集夏普':<12} {'验证集夏普':<12} {'测试集夏普':<12}")
print(f"{'纯选股':<15} {'1.3105':<12} {'0.2637':<12} {'1.9027':<12}")
print(f"{'纯择时':<15} {'1.1480':<12} {'-0.3559':<12} {'1.4496':<12}")
print(f"{'选股×择时':<13} ", end="")  # 合成结果在上面输出
