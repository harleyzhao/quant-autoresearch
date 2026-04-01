"""
Optuna 自动超参优化 — 不需要 LLM
选股模型: 自动搜索最优 LightGBM 参数 + 特征组合 + 策略参数
"""
import sys
sys.path.insert(0, "..")

import pandas as pd
import numpy as np
import optuna
from data.storage import Storage
from models.lightgbm_model import StockSelector
from backtest.engine import Backtester

optuna.logging.set_verbosity(optuna.logging.WARNING)

DB = "../data/cache/market.db"
storage = Storage(DB)

# ============================================================
# Load data once
# ============================================================
print("Loading data...")
FEATURE_COLS_ALL = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

factors = storage.load_all_factors("2018-01-01", "2024-07-01")
factors["date"] = pd.to_datetime(factors["date"])
daily = storage.load_all_daily("2018-01-01", "2024-07-01")
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
    weekly_factors[["code", "date"] + FEATURE_COLS_ALL], on=["code", "date"], how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS_ALL + ["future_return"])

print(f"Dataset: {len(dataset)} rows")


def run_backtest(df, selector, top_n):
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
            wr[r["code"]] = 1.0 / top_n if r["code"] in sel else 0.0
        price_recs.append(pr)
        weight_recs.append(wr)
    if not price_recs:
        return None
    prices = pd.DataFrame(price_recs, index=dates).ffill().fillna(0)
    weights = pd.DataFrame(weight_recs, index=dates).fillna(0)
    cols = sorted(set(prices.columns) & set(weights.columns))
    return Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001).run(
        weights[cols], prices[cols]
    )


def objective(trial):
    # === 搜索空间 ===

    # 训练窗口起点
    train_start = trial.suggest_categorical("train_start", [
        "2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"
    ])

    # 特征选择 (每个特征是否使用)
    use_features = []
    for f in FEATURE_COLS_ALL:
        if trial.suggest_categorical(f"use_{f}", [True, False]):
            use_features.append(f)
    if len(use_features) < 2:
        return -999  # 至少2个特征

    # LightGBM 超参
    n_estimators = trial.suggest_int("n_estimators", 10, 200)
    num_leaves = trial.suggest_int("num_leaves", 5, 63)
    learning_rate = trial.suggest_float("learning_rate", 0.01, 0.3)
    max_depth = trial.suggest_int("max_depth", 2, 8)
    reg_alpha = trial.suggest_float("reg_alpha", 0.0, 5.0)
    reg_lambda = trial.suggest_float("reg_lambda", 0.0, 5.0)
    min_child_samples = trial.suggest_int("min_child_samples", 10, 200)
    subsample = trial.suggest_float("subsample", 0.5, 1.0)
    colsample_bytree = trial.suggest_float("colsample_bytree", 0.5, 1.0)

    # 策略参数
    top_n = trial.suggest_int("top_n", 5, 50, step=5)
    n_groups = trial.suggest_int("n_groups", 3, 10)

    # === 训练 ===
    train_df = dataset[
        (dataset["date"] >= train_start) & (dataset["date"] <= "2023-12-31")
    ]
    val_df = dataset[
        (dataset["date"] >= "2024-01-01") & (dataset["date"] <= "2024-06-30")
    ]

    if len(train_df) < 1000 or len(val_df) < 100:
        return -999

    lgb_params = {
        "n_estimators": n_estimators,
        "num_leaves": num_leaves,
        "learning_rate": learning_rate,
        "max_depth": max_depth,
        "reg_alpha": reg_alpha,
        "reg_lambda": reg_lambda,
        "min_child_samples": min_child_samples,
        "subsample": subsample,
        "colsample_bytree": colsample_bytree,
        "verbose": -1,
    }

    try:
        selector = StockSelector(
            feature_cols=use_features, n_groups=n_groups, params=lgb_params
        )
        selector.train(train_df)
        result = run_backtest(val_df, selector, top_n)
        if result is None:
            return -999
        return result.sharpe
    except Exception:
        return -999


# ============================================================
# Run optimization
# ============================================================
print("Starting Optuna optimization...")
print("No LLM needed. Pure GPU/CPU optimization.")
print("Press Ctrl+C to stop.\n")

study = optuna.create_study(
    direction="maximize",
    study_name="stock_selection",
    storage="sqlite:///../data/cache/optuna.db",
    load_if_exists=True,
)

best_so_far = study.best_value if len(study.trials) > 0 else -999

def callback(study, trial):
    global best_so_far
    if trial.value and trial.value > best_so_far:
        best_so_far = trial.value
        features_used = [f for f in FEATURE_COLS_ALL if trial.params.get(f"use_{f}", False)]
        print(f"\n*** NEW BEST: Sharpe={trial.value:.4f} ***")
        print(f"  Features: {features_used}")
        print(f"  top_n={trial.params['top_n']}, train_start={trial.params['train_start']}")
        print(f"  n_estimators={trial.params['n_estimators']}, num_leaves={trial.params['num_leaves']}")
        print(f"  reg_alpha={trial.params['reg_alpha']:.2f}, reg_lambda={trial.params['reg_lambda']:.2f}")
        print(f"  Trial #{trial.number}\n")

try:
    study.optimize(objective, n_trials=10000, callbacks=[callback], show_progress_bar=True)
except KeyboardInterrupt:
    pass

# Print final results
print(f"\n{'='*65}")
print(f"Optimization Results")
print(f"{'='*65}")
print(f"Total trials: {len(study.trials)}")
print(f"Best Sharpe: {study.best_value:.4f}")
print(f"\nBest params:")
for k, v in study.best_params.items():
    print(f"  {k}: {v}")
