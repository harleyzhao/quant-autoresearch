"""Backtest with TOP_N=5 on 2025-2026"""
import sys
sys.path.insert(0, ".")
import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from backtest.engine import Backtester

DB = "data/cache/market.db"
storage = Storage(DB)

FEATURE_COLS = ["momentum_20", "volatility_20", "rsi_14", "volume_ratio_5"]

factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2021-01-01", "2026-04-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

daily["future_return"] = daily.groupby("code")["close"].pct_change(5).shift(-5)
dataset = daily[["code", "date", "close", "future_return"]].merge(
    factors[["code", "date"] + FEATURE_COLS], on=["code", "date"], how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS)
dataset["future_return"] = dataset["future_return"].fillna(0)

# Winsorize + standardize
for col in FEATURE_COLS:
    lo, hi = dataset[col].quantile(0.01), dataset[col].quantile(0.99)
    dataset[col] = dataset[col].clip(lo, hi)
    dataset[col] = (dataset[col] - dataset[col].mean()) / (dataset[col].std() + 1e-8)

train_df = dataset[dataset["date"] <= "2024-12-31"]
train_df = train_df.dropna(subset=FEATURE_COLS + ["future_return"])

lgb_params = {
    "n_estimators": 30, "num_leaves": 10, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 2.0, "reg_lambda": 2.0,
    "min_child_samples": 100, "subsample": 0.7, "colsample_bytree": 0.7,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)

test_df = dataset[dataset["date"] >= "2025-01-01"]

def run_bt(df, top_n, rebalance_days=10):
    dates = sorted(df["date"].unique())
    rebalance_dates = dates[::rebalance_days]
    price_recs, weight_recs = [], []
    current_weights = {}
    for date in dates:
        day_data = df[df["date"] == date]
        if date in rebalance_dates:
            scores = selector.predict(day_data)
            top = scores.nlargest(top_n, "score")
            selected = set(top["code"].values)
            current_weights = {}
            for _, r in day_data.iterrows():
                current_weights[r["code"]] = 1.0/top_n if r["code"] in selected else 0.0
        pr, wr = {}, {}
        for _, r in day_data.iterrows():
            pr[r["code"]] = r["close"]
            wr[r["code"]] = current_weights.get(r["code"], 0.0)
        price_recs.append(pr)
        weight_recs.append(wr)
    prices = pd.DataFrame(price_recs, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_recs, index=dates).fillna(0)
    cols = sorted(set(prices.columns) & set(weights.columns))
    return Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001).run(weights[cols], prices[cols])

print("=" * 65)
print("2025-2026 Backtest: TOP_N Comparison")
print("=" * 65)
print(f"{'TOP_N':>6} {'Sharpe':>8} {'Annual':>10} {'MaxDD':>10} {'Turnover':>10}")
print("-" * 65)

for top_n in [5, 10, 20, 30, 50]:
    res = run_bt(test_df, top_n)
    print(f"{top_n:>6} {res.sharpe:>8.2f} {res.annual_ret:>9.2%} {res.max_drawdown:>9.2%} {res.turnover:>9.2%}")

print("=" * 65)
