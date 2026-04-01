"""Backtest weekly stock selection with different TOP_N"""
import sys
sys.path.insert(0, ".")
import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from backtest.engine import Backtester

DB = "data/cache/market.db"
storage = Storage(DB)

# 9-factor weekly model (the one that got 45% annual)
FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

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

# Train 2021-2024
train_df = dataset[dataset["date"] <= "2024-12-31"]
lgb_params = {
    "n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
    "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)

test_df = dataset[dataset["date"] >= "2025-01-01"]

def run_bt(df, top_n):
    dates = sorted(df["date"].unique())
    price_recs, weight_recs = [], []
    for date in dates:
        wd = df[df["date"] == date]
        scores = selector.predict(wd)
        top = scores.nlargest(top_n, "score")
        sel = set(top["code"].values)
        pr, wr = {}, {}
        for _, r in wd.iterrows():
            pr[r["code"]] = r["close"]
            wr[r["code"]] = 1.0/top_n if r["code"] in sel else 0.0
        price_recs.append(pr)
        weight_recs.append(wr)
    prices = pd.DataFrame(price_recs, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_recs, index=dates).fillna(0)
    cols = sorted(set(prices.columns) & set(weights.columns))
    return Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001).run(weights[cols], prices[cols])

print("=" * 65)
print("2025-2026 Weekly Stock Selection (9 factors, no timing)")
print("=" * 65)
print(f"{'TOP_N':>6} {'Sharpe':>8} {'Annual':>10} {'MaxDD':>10} {'Turnover':>10}")
print("-" * 65)

for top_n in [5, 10, 20, 30, 50]:
    res = run_bt(test_df, top_n)
    print(f"{top_n:>6} {res.sharpe:>8.2f} {res.annual_ret:>9.2%} {res.max_drawdown:>9.2%} {res.turnover:>9.2%}")

print("=" * 65)
