"""
2025-2026 完整组合回测 — 使用进化后的最优参数
选股: LightGBM (强正则化, 训练窗口2021-2024)
择时: ALSTM (市场级别, 12特征, SEQ_LEN=60)
"""
import sys
sys.path.insert(0, ".")

import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from models.alstm_model import MarketTimer
from backtest.engine import Backtester
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return
from factors.pipeline import FactorPipeline


def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)

def _compute_macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast).mean()
    ema_slow = close.ewm(span=slow).mean()
    return ema_fast - ema_slow - (ema_fast - ema_slow).ewm(span=signal).mean()

def _compute_boll_pos(close, period=20):
    ma = close.rolling(period).mean()
    std = close.rolling(period).std()
    return (close - (ma - 2*std)) / ((ma + 2*std) - (ma - 2*std)).replace(0, np.nan)


DB = "data/cache/market.db"
storage = Storage(DB)

# ============================================================
print("=" * 60)
print("2025-2026 Out-of-Sample Backtest")
print("=" * 60)

# ============================================================
# Part 1: Stock Selection
# ============================================================
print("\n[1] Stock Selection (LightGBM)")

FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

# Load data
factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2021-01-01", "2026-04-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# Weekly aggregation
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

# Split: train on 2021-2024, test on 2025+
train_df = dataset[dataset["date"] <= "2024-12-31"]
test_df = dataset[dataset["date"] >= "2025-01-01"]
print(f"  Train: {len(train_df)} rows")
print(f"  Test(2025+): {len(test_df)} rows, {test_df['date'].min()} ~ {test_df['date'].max()}")

# Best evolved params
lgb_params = {
    "n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
    "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)
TOP_N = 50

def run_stock_bt(df):
    dates = sorted(df["date"].unique())
    price_recs, weight_recs = [], []
    for date in dates:
        wd = df[df["date"] == date]
        scores = selector.predict(wd)
        top = scores.nlargest(TOP_N, "score")
        sel = set(top["code"].values)
        pr, wr = {}, {}
        for _, r in wd.iterrows():
            pr[r["code"]] = r["close"]
            wr[r["code"]] = 1.0/TOP_N if r["code"] in sel else 0.0
        price_recs.append(pr)
        weight_recs.append(wr)
    prices = pd.DataFrame(price_recs, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_recs, index=dates).fillna(0)
    cols = sorted(set(prices.columns) & set(weights.columns))
    return Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001).run(weights[cols], prices[cols])

stock_res = run_stock_bt(test_df)
print(f"  Result: Sharpe={stock_res.sharpe:.4f}, Annual={stock_res.annual_ret:.2%}, "
      f"MaxDD={stock_res.max_drawdown:.2%}, Turnover={stock_res.turnover:.2%}")

# ============================================================
# Part 2: Market Timing (ALSTM)
# ============================================================
print("\n[2] ALSTM Market Timing")

daily_all = storage.load_all_daily("2018-01-01", "2026-04-01")
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
market["boll_pos"] = _compute_boll_pos(market["close"])
market["ma_ratio"] = market["close"] / market["close"].rolling(20).mean() - 1
market = market.dropna().reset_index(drop=True)

TIMING_FEATURES = ["ret_1","ret_5","ret_10","ret_20","vol_5","vol_10","vol_20",
                   "up_ratio","rsi","macd","boll_pos","ma_ratio"]

# Labels (use train period quantiles only)
market["future_5d_ret"] = market["close"].pct_change(5).shift(-5)
train_ret = market.loc[market["date"] <= "2024-12-31", "future_5d_ret"].dropna()
q33, q67 = train_ret.quantile(0.33), train_ret.quantile(0.67)
market["label"] = 1
market.loc[market["future_5d_ret"] <= q33, "label"] = 0
market.loc[market["future_5d_ret"] >= q67, "label"] = 2
market = market.dropna(subset=["future_5d_ret"]).reset_index(drop=True)

features = market[TIMING_FEATURES].values.astype(np.float32)
labels = market["label"].values.astype(int)

train_mask = market["date"] <= "2024-12-31"
train_idx = np.where(train_mask)[0]
feat_mean = features[train_idx].mean(axis=0)
feat_std = features[train_idx].std(axis=0) + 1e-8
features = (features - feat_mean) / feat_std
features = np.nan_to_num(features, nan=0.0)

SEQ_LEN = 60
timer = MarketTimer(input_size=len(TIMING_FEATURES), seq_len=SEQ_LEN,
                    hidden_size=128, num_layers=2, num_classes=3,
                    dropout=0.3, lr=1e-3, epochs=50, batch_size=32)

# Prepare sequences
def make_seqs(feat, lab, sl):
    X, y = [], []
    for i in range(sl, len(feat)):
        X.append(feat[i-sl:i])
        y.append(lab[i])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)

train_end = train_idx[-1] + 1
X_train, y_train = make_seqs(features[:train_end], labels[:train_end], SEQ_LEN)
print(f"  Training on {len(X_train)} sequences...")
timer.train(X_train, y_train)

# Get timing positions for 2025+
test_mask = market["date"] >= "2025-01-01"
test_idx = np.where(test_mask)[0]
timing_positions = {}
timing_rets = []

i = 0
while i < len(test_idx):
    t = test_idx[i]
    if t < SEQ_LEN or t + 5 >= len(market):
        i += 5
        continue
    fw = features[t-SEQ_LEN:t]
    pc, cf = timer.predict_proba(fw)
    pos = MarketTimer.to_position(pc, cf, 0.6)
    timing_positions[market.iloc[t]["date"]] = pos
    cur = market.iloc[t]["close"]
    fut = market.iloc[t+5]["close"]
    timing_rets.append(pos * (fut-cur)/cur)
    i += 5

if timing_rets:
    tr = pd.Series(timing_rets)
    eq = (1 + tr).cumprod()
    print(f"  Result: Sharpe={sharpe_ratio(tr,52):.4f}, Annual={annual_return(eq,52):.2%}, "
          f"MaxDD={max_drawdown(eq):.2%}")

# ============================================================
# Part 3: Combined (Stock x Timing)
# ============================================================
print("\n[3] Combined (Stock Selection x Market Timing)")

dates = sorted(test_df["date"].unique())
price_recs, weight_recs = [], []
for date in dates:
    wd = test_df[test_df["date"] == date]
    scores = selector.predict(wd)
    top = scores.nlargest(TOP_N, "score")
    sel = set(top["code"].values)

    tp = 0.5
    dts = pd.Timestamp(date)
    for td in sorted(timing_positions.keys(), reverse=True):
        if pd.Timestamp(td) <= dts:
            tp = timing_positions[td]
            break

    pr, wr = {}, {}
    for _, r in wd.iterrows():
        pr[r["code"]] = r["close"]
        wr[r["code"]] = (1.0/TOP_N if r["code"] in sel else 0.0) * tp
    price_recs.append(pr)
    weight_recs.append(wr)

prices = pd.DataFrame(price_recs, index=dates).ffill().fillna(0)
weights = pd.DataFrame(weight_recs, index=dates).fillna(0)
cols = sorted(set(prices.columns) & set(weights.columns))
combined = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001).run(weights[cols], prices[cols])
print(f"  Result: Sharpe={combined.sharpe:.4f}, Annual={combined.annual_ret:.2%}, "
      f"MaxDD={combined.max_drawdown:.2%}, Turnover={combined.turnover:.2%}")

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
print("FINAL 2025-2026 OUT-OF-SAMPLE RESULTS")
print("=" * 60)
print(f"{'Strategy':<25} {'Sharpe':>8} {'Annual':>10} {'MaxDD':>10} {'Turnover':>10}")
print("-" * 63)
print(f"{'Stock Selection':<25} {stock_res.sharpe:>8.2f} {stock_res.annual_ret:>9.2%} {stock_res.max_drawdown:>9.2%} {stock_res.turnover:>9.2%}")
if timing_rets:
    print(f"{'ALSTM Timing':<25} {sharpe_ratio(tr,52):>8.2f} {annual_return(eq,52):>9.2%} {max_drawdown(eq):>9.2%} {'N/A':>10}")
print(f"{'Combined':<25} {combined.sharpe:>8.2f} {combined.annual_ret:>9.2%} {combined.max_drawdown:>9.2%} {combined.turnover:>9.2%}")
print("=" * 63)
