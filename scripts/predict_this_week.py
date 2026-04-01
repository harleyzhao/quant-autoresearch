"""Predict this week's stock picks using the evolved model"""
import sys
sys.path.insert(0, ".")
import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector

DB = "data/cache/market.db"
storage = Storage(DB)

# Best evolved features (4 factors)
FEATURE_COLS = ["momentum_20", "volatility_20", "rsi_14", "volume_ratio_5"]

# Load all data
factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2021-01-01", "2026-04-01")
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])

# Build dataset
daily["future_return"] = daily.groupby("code")["close"].pct_change(5).shift(-5)
dataset = daily[["code", "date", "close", "future_return"]].merge(
    factors[["code", "date"] + FEATURE_COLS], on=["code", "date"], how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS)

# Winsorize and standardize
for col in FEATURE_COLS:
    lo = dataset[col].quantile(0.01)
    hi = dataset[col].quantile(0.99)
    dataset[col] = dataset[col].clip(lo, hi)
    dataset[col] = (dataset[col] - dataset[col].mean()) / (dataset[col].std() + 1e-8)

# Fill NaN in future_return for prediction rows
dataset["future_return"] = dataset["future_return"].fillna(0)

# Train on all data up to 2026-03-28
train_df = dataset[dataset["date"] <= "2026-03-28"]
train_df = train_df.dropna(subset=FEATURE_COLS + ["future_return"])

lgb_params = {
    "n_estimators": 30, "num_leaves": 10, "learning_rate": 0.1,
    "max_depth": 3, "reg_alpha": 2.0, "reg_lambda": 2.0,
    "min_child_samples": 100, "subsample": 0.7, "colsample_bytree": 0.7,
    "verbose": -1
}
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5, params=lgb_params)
selector.train(train_df)

# Get latest available date
latest_date = dataset["date"].max()
latest = dataset[dataset["date"] == latest_date]

if len(latest) == 0:
    print("No data for latest date!")
    sys.exit(1)

scores = selector.predict(latest)
top50 = scores.nlargest(50, "score").sort_values("score", ascending=False)

# Get stock names from akshare
try:
    import akshare as ak
    stock_info = ak.stock_zh_a_spot_em()
    name_map = dict(zip(stock_info["代码"], stock_info["名称"]))
except:
    name_map = {}

print(f"=" * 65)
print(f"Stock Picks for Week of 2026-03-30")
print(f"Based on data up to: {latest_date.strftime('%Y-%m-%d')}")
print(f"Model: LightGBM (evolved, 24000+ rounds)")
print(f"=" * 65)
print(f"{'Rank':>4} {'Code':>8} {'Name':<10} {'Score':>8} {'Price':>8}")
print("-" * 65)

for i, (_, row) in enumerate(top50.iterrows()):
    code = row["code"]
    price_row = latest[latest["code"] == code]
    price = price_row["close"].values[0] if len(price_row) > 0 else 0
    name = name_map.get(code, "")
    print(f"{i+1:4d} {code:>8} {name:<10} {row['score']:>8.4f} {price:>8.2f}")

print(f"=" * 65)
print(f"Total: {len(top50)} stocks selected")
