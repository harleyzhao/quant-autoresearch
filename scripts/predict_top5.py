"""Predict this week's top 5 stock picks using the best validated model"""
import sys
sys.path.insert(0, ".")
import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector

DB = "data/cache/market.db"
storage = Storage(DB)

# Best validated version: 9 factors, weekly
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
dataset = dataset.dropna(subset=FEATURE_COLS)
dataset["future_return"] = dataset["future_return"].fillna(0)

# Train on all data up to now
train_df = dataset.dropna(subset=FEATURE_COLS + ["future_return"])

lgb_params = {
    "n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
    "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)

# Predict on latest week
latest_date = dataset["date"].max()
latest = dataset[dataset["date"] == latest_date]
scores = selector.predict(latest)
top5 = scores.nlargest(5, "score").sort_values("score", ascending=False)

# Get stock names
try:
    import akshare as ak
    stock_info = ak.stock_zh_a_spot_em()
    name_map = dict(zip(stock_info["代码"], stock_info["名称"]))
    price_map = dict(zip(stock_info["代码"], stock_info["最新价"]))
    change_map = dict(zip(stock_info["代码"], stock_info["涨跌幅"]))
except:
    name_map, price_map, change_map = {}, {}, {}

print(f"=" * 55)
print(f"TOP 5 Stock Picks (Week of 2026-03-30)")
print(f"Model: Best validated (9 factors, weekly, Sharpe 4.81)")
print(f"OOS performance: Annual 55.76% for Top 10")
print(f"Data up to: {latest_date.strftime('%Y-%m-%d')}")
print(f"=" * 55)
print(f"{'Rank':>4} {'Code':>8} {'Name':<10} {'Score':>7} {'Price':>8} {'Chg%':>7}")
print("-" * 55)

for i, (_, row) in enumerate(top5.iterrows()):
    code = row["code"]
    name = name_map.get(code, "")
    price = price_map.get(code, "")
    chg = change_map.get(code, "")
    print(f"{i+1:4d} {code:>8} {name:<10} {row['score']:>7.3f} {str(price):>8} {str(chg):>6}%")

print(f"=" * 55)
