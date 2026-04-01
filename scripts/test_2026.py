"""Test combined strategy on 2025-2026 out-of-sample data"""
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


DB = "data/cache/market.db"
storage = Storage(DB)

# ============================================================
# Step 1: Compute factors for 2025-2026
# ============================================================
print("Step 1: Computing factors for new data...")
pipeline = FactorPipeline()
daily_new = storage.load_all_daily("2024-06-01", "2026-04-01")  # load extra history for factor calc
daily_new["date"] = pd.to_datetime(daily_new["date"])
codes = daily_new["code"].unique()
saved = 0
for code in codes:
    try:
        df = daily_new[daily_new["code"] == code].sort_values("date")
        if len(df) < 60:
            continue
        factors = pipeline.compute(df)
        # only save 2025+ factors
        factors = factors[factors["date"] >= "2025-01-01"]
        if len(factors) > 0:
            storage.save_factors(factors)
            saved += 1
    except:
        pass
print(f"  Factors computed for {saved} stocks")

# ============================================================
# Step 2: Stock Selection
# ============================================================
print("\nStep 2: Stock Selection Model")

FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

# Load all data
factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2021-01-01", "2026-04-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# Weekly
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

# Train on 2021-2024, test on 2025+
train_df = dataset[dataset["date"] <= "2024-12-31"]
test_df = dataset[dataset["date"] >= "2025-01-01"]
print(f"  Train: {len(train_df)} rows, Test(2025+): {len(test_df)} rows")

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

stock_result = run_stock_backtest(test_df, selector, TOP_N)
if stock_result:
    print(f"  Stock Selection 2025+: Sharpe={stock_result.sharpe:.4f}, "
          f"Annual={stock_result.annual_ret:.2%}, MaxDD={stock_result.max_drawdown:.2%}")

# ============================================================
# Step 3: Market Timing (ALSTM)
# ============================================================
print("\nStep 3: ALSTM Market Timing")

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
market = market.dropna().reset_index(drop=True)

TIMING_FEATURES = ["ret_1", "ret_5", "ret_10", "ret_20",
                   "vol_5", "vol_10", "vol_20", "up_ratio", "rsi"]

market["future_5d_ret"] = market["close"].pct_change(5).shift(-5)
q33 = market.loc[market["date"] <= "2024-12-31", "future_5d_ret"].quantile(0.33)
q67 = market.loc[market["date"] <= "2024-12-31", "future_5d_ret"].quantile(0.67)
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

SEQ_LEN = 30
timer = MarketTimer(input_size=len(TIMING_FEATURES), seq_len=SEQ_LEN,
                    hidden_size=64, num_layers=1, num_classes=3,
                    dropout=0.5, lr=1e-3, epochs=30, batch_size=32)

train_end = train_idx[-1] + 1
timer.train(features[:train_end], labels[SEQ_LEN:train_end])

# Timing backtest on 2025+
test_timing_mask = market["date"] >= "2025-01-01"
test_idx = np.where(test_timing_mask)[0]
timing_returns = []
timing_positions = {}

i = 0
while i < len(test_idx):
    t = test_idx[i]
    if t < SEQ_LEN:
        i += 5
        continue
    feat_window = features[t - SEQ_LEN:t]
    pred_class, confidence = timer.predict_proba(feat_window)
    position = MarketTimer.to_position(pred_class, confidence, 0.6)
    date = market.iloc[t]["date"]
    timing_positions[date] = position
    if t + 5 < len(market):
        cur = market.iloc[t]["close"]
        fut = market.iloc[t + 5]["close"]
        ret = (fut - cur) / cur
        timing_returns.append(position * ret)
    i += 5

if timing_returns:
    tr = pd.Series(timing_returns)
    eq = (1 + tr).cumprod()
    print(f"  ALSTM Timing 2025+: Sharpe={sharpe_ratio(tr, 52):.4f}, "
          f"Annual={annual_return(eq, 52):.2%}, MaxDD={max_drawdown(eq):.2%}")

# ============================================================
# Step 4: Combined Strategy
# ============================================================
print("\nStep 4: Combined Strategy (Stock x Timing)")

if stock_result and test_df is not None and len(test_df) > 0:
    dates = sorted(test_df["date"].unique())
    price_records, weight_records = [], []

    for date in dates:
        week_data = test_df[test_df["date"] == date]
        scores = selector.predict(week_data)
        top = scores.nlargest(TOP_N, "score")
        selected = set(top["code"].values)

        # Find nearest timing position
        timing_pos = 0.5
        date_ts = pd.Timestamp(date)
        for td in sorted(timing_positions.keys(), reverse=True):
            if pd.Timestamp(td) <= date_ts:
                timing_pos = timing_positions[td]
                break

        price_row, weight_row = {}, {}
        for _, row in week_data.iterrows():
            base_w = 1.0 / TOP_N if row["code"] in selected else 0.0
            price_row[row["code"]] = row["close"]
            weight_row[row["code"]] = base_w * timing_pos
        price_records.append(price_row)
        weight_records.append(weight_row)

    prices = pd.DataFrame(price_records, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_records, index=dates).fillna(0)
    common = sorted(set(prices.columns) & set(weights.columns))
    bt = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001)
    combined = bt.run(weights[common], prices[common])

    if combined:
        print(f"  Combined 2025+: Sharpe={combined.sharpe:.4f}, "
              f"Annual={combined.annual_ret:.2%}, MaxDD={combined.max_drawdown:.2%}, "
              f"Turnover={combined.turnover:.2%}")

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
print("2025-2026 Out-of-Sample Results")
print("=" * 60)
if stock_result:
    print(f"Stock Selection:  Sharpe={stock_result.sharpe:.4f}  Annual={stock_result.annual_ret:.2%}  MaxDD={stock_result.max_drawdown:.2%}")
if timing_returns:
    print(f"ALSTM Timing:     Sharpe={sharpe_ratio(tr,52):.4f}  Annual={annual_return(eq,52):.2%}  MaxDD={max_drawdown(eq):.2%}")
if combined:
    print(f"Combined:         Sharpe={combined.sharpe:.4f}  Annual={combined.annual_ret:.2%}  MaxDD={combined.max_drawdown:.2%}")
