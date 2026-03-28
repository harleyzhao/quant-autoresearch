# autoresearch/stock_selection/train.py
"""
选股策略训练与回测 — autoresearch agent 可编辑此文件
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from backtest.engine import Backtester

# === 配置 ===
DB_PATH = "../../data/cache/market.db"
TRAIN_START = "2018-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"
TOP_N = 50
FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

# === 数据加载 ===
print("加载数据...")
storage = Storage(DB_PATH)

# 加载因子数据（宽表）
factors = storage.load_all_factors(TRAIN_START, "2024-07-01")
factors["date"] = pd.to_datetime(factors["date"])

# 加载日线数据用于计算未来收益和回测
daily = storage.load_all_daily(TRAIN_START, "2024-07-01")
daily["date"] = pd.to_datetime(daily["date"])

# === 构建周频数据 ===
print("构建周频数据...")

# 每周五的收盘价
daily = daily.sort_values(["code", "date"])
daily["weekday"] = daily["date"].dt.weekday
# 取每周最后一个交易日
daily["week"] = daily["date"].dt.isocalendar().week.astype(int)
daily["year"] = daily["date"].dt.year
weekly_prices = daily.groupby(["code", "year", "week"]).last().reset_index()
weekly_prices = weekly_prices.sort_values(["code", "date"])

# 计算未来一周收益率
weekly_prices["future_return"] = weekly_prices.groupby("code")["close"].pct_change().shift(-1)

# 合并因子：取每周最后一个交易日的因子
factors["year"] = factors["date"].dt.year
factors["week"] = factors["date"].dt.isocalendar().week.astype(int)
weekly_factors = factors.groupby(["code", "year", "week"]).last().reset_index()

# 合并因子和收益
dataset = weekly_prices[["code", "date", "close", "future_return"]].merge(
    weekly_factors[["code", "date"] + FEATURE_COLS],
    on=["code", "date"],
    how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS + ["future_return"])
print(f"数据集大小: {len(dataset)} 行, {dataset['code'].nunique()} 只股票, {dataset['date'].nunique()} 周")

# === 分割训练集和验证集 ===
train_df = dataset[(dataset["date"] >= TRAIN_START) & (dataset["date"] <= TRAIN_END)]
val_df = dataset[(dataset["date"] >= VAL_START) & (dataset["date"] <= VAL_END)]
print(f"训练集: {len(train_df)} 行, 验证集: {len(val_df)} 行")

# === 模型训练 ===
print("训练模型...")
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5)
selector.train(train_df)

# === 回测函数 ===
def run_backtest(df, selector, top_n):
    """对给定数据集运行周频选股回测"""
    dates = sorted(df["date"].unique())

    # 获取所有股票代码
    all_codes = sorted(df["code"].unique())

    # 构建价格矩阵和权重矩阵
    price_records = []
    weight_records = []

    for date in dates:
        week_data = df[df["date"] == date]

        # 预测并选股
        scores = selector.predict(week_data)
        top = scores.nlargest(top_n, "score")
        selected_codes = set(top["code"].values)

        # 价格
        price_row = {}
        weight_row = {}
        for _, row in week_data.iterrows():
            code = row["code"]
            price_row[code] = row["close"]
            weight_row[code] = 1.0 / top_n if code in selected_codes else 0.0

        price_records.append(price_row)
        weight_records.append(weight_row)

    prices = pd.DataFrame(price_records, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_records, index=dates).fillna(0)

    # 对齐列
    common_cols = sorted(set(prices.columns) & set(weights.columns))
    prices = prices[common_cols]
    weights = weights[common_cols]

    backtester = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001)
    return backtester.run(weights, prices)

# === 回测 ===
print("回测训练集...")
train_result = run_backtest(train_df, selector, TOP_N)
train_sharpe = train_result.sharpe

print("回测验证集...")
val_result = run_backtest(val_df, selector, TOP_N)
val_sharpe = val_result.sharpe

# === 输出结果 ===
print(f"")
print(f"训练集夏普: {train_sharpe:.4f}")
print(f"训练集年化: {train_result.annual_ret:.2%}")
print(f"训练集回撤: {train_result.max_drawdown:.2%}")
print(f"验证集夏普: {val_sharpe:.4f}")
print(f"验证集年化: {val_result.annual_ret:.2%}")
print(f"验证集回撤: {val_result.max_drawdown:.2%}")
print(f"VAL_SHARPE={val_sharpe:.4f}")
