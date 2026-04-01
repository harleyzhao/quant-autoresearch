"""
2025-2026 回测 V2 — 个股级别日频择时
选股：每周选出Top50
择时：对每只选中的股票，ALSTM日频判断买入/卖出（波段操作）
"""
import sys
sys.path.insert(0, ".")

import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from models.alstm_model import MarketTimer
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
# Step 1: Train Stock Selection Model
# ============================================================
print("=" * 60)
print("[1] 训练选股模型 (LightGBM)")
print("=" * 60)

FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily_all = storage.load_all_daily("2021-01-01", "2026-04-01")
daily_all["date"] = pd.to_datetime(daily_all["date"])
daily_all = daily_all.sort_values(["code", "date"])

# 周频选股数据
daily_tmp = daily_all.copy()
daily_tmp["week"] = daily_tmp["date"].dt.isocalendar().week.astype(int)
daily_tmp["year"] = daily_tmp["date"].dt.year
weekly_prices = daily_tmp.groupby(["code", "year", "week"]).last().reset_index()
weekly_prices = weekly_prices.sort_values(["code", "date"])
weekly_prices["future_return"] = weekly_prices.groupby("code")["close"].pct_change().shift(-1)

factors["year"] = factors["date"].dt.year
factors["week"] = factors["date"].dt.isocalendar().week.astype(int)
weekly_factors = factors.groupby(["code", "year", "week"]).last().reset_index()

dataset = weekly_prices[["code", "date", "close", "future_return"]].merge(
    weekly_factors[["code", "date"] + FEATURE_COLS], on=["code", "date"], how="inner",
)
dataset = dataset.dropna(subset=FEATURE_COLS + ["future_return"])

train_df = dataset[dataset["date"] <= "2024-12-31"]
selector = StockSelector(
    feature_cols=FEATURE_COLS, n_groups=5,
    params={"n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
            "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
            "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
            "verbose": -1}
)
selector.train(train_df)
print(f"  选股模型训练完成, 训练数据: {len(train_df)} 行")

# ============================================================
# Step 2: Train Individual Stock Timing Model (ALSTM)
# ============================================================
print("\n" + "=" * 60)
print("[2] 训练个股择时模型 (ALSTM)")
print("=" * 60)

# 个股特征
TIMING_FEATURES = [
    "ret_1", "ret_3", "ret_5",
    "vol_5", "vol_20", "volume_ratio",
    "rsi_14", "ma_dev_5", "ma_dev_20", "price_pos",
]
SEQ_LEN = 20

def compute_stock_features(df):
    df = df.copy().sort_values("date")
    df["ret_1"] = df["close"].pct_change(1)
    df["ret_3"] = df["close"].pct_change(3)
    df["ret_5"] = df["close"].pct_change(5)
    df["vol_5"] = df["ret_1"].rolling(5).std()
    df["vol_20"] = df["ret_1"].rolling(20).std()
    df["volume_ma5"] = df["volume"].rolling(5).mean()
    df["volume_ratio"] = df["volume"] / df["volume_ma5"].replace(0, np.nan)
    df["rsi_14"] = _compute_rsi(df["close"], 14)
    df["ma_5"] = df["close"].rolling(5).mean()
    df["ma_20"] = df["close"].rolling(20).mean()
    df["ma_dev_5"] = df["close"] / df["ma_5"] - 1
    df["ma_dev_20"] = df["close"] / df["ma_20"] - 1
    df["high_20"] = df["high"].rolling(20).max()
    df["low_20"] = df["low"].rolling(20).min()
    df["price_pos"] = (df["close"] - df["low_20"]) / (df["high_20"] - df["low_20"]).replace(0, np.nan)
    return df

# 用 2021-2024 数据训练个股择时
print("  计算个股特征...")
daily_train = storage.load_all_daily("2020-06-01", "2025-01-01")
daily_train["date"] = pd.to_datetime(daily_train["date"])
daily_train = daily_train.sort_values(["code", "date"])

all_stocks = []
for code in daily_train["code"].unique():
    sdf = daily_train[daily_train["code"] == code]
    if len(sdf) < 60:
        continue
    sdf = compute_stock_features(sdf)
    sdf = sdf.dropna(subset=TIMING_FEATURES)
    all_stocks.append(sdf)

all_data = pd.concat(all_stocks, ignore_index=True)

# 标签: 明天涨(1) vs 跌(0)
all_data["future_1d_ret"] = all_data.groupby("code")["close"].transform(lambda x: x.pct_change().shift(-1))
train_part = all_data[(all_data["date"] >= "2021-01-01") & (all_data["date"] <= "2024-12-31")]
median_ret = train_part["future_1d_ret"].median()
all_data["label"] = (all_data["future_1d_ret"] > median_ret).astype(int)
all_data = all_data.dropna(subset=["future_1d_ret"]).reset_index(drop=True)

# 标准化
train_vals = train_part[TIMING_FEATURES].values
feat_mean = train_vals.mean(axis=0).astype(np.float32)
feat_std = train_vals.std(axis=0).astype(np.float32) + 1e-8
all_data[TIMING_FEATURES] = (all_data[TIMING_FEATURES].values - feat_mean) / feat_std

# 序列化训练数据
train_data = all_data[(all_data["date"] >= "2021-01-01") & (all_data["date"] <= "2024-12-31")]
X_list, y_list = [], []
for code in train_data["code"].unique():
    sdf = train_data[train_data["code"] == code].sort_values("date")
    feat = sdf[TIMING_FEATURES].values.astype(np.float32)
    lab = sdf["label"].values.astype(int)
    if len(feat) < SEQ_LEN + 1:
        continue
    for i in range(SEQ_LEN, len(feat)):
        X_list.append(feat[i-SEQ_LEN:i])
        y_list.append(lab[i])

X_train = np.array(X_list, dtype=np.float32)
y_train = np.array(y_list, dtype=np.int64)
print(f"  训练序列: {len(X_train)}")

timer = MarketTimer(
    input_size=len(TIMING_FEATURES), seq_len=SEQ_LEN,
    hidden_size=128, num_layers=2, num_classes=2,
    dropout=0.4, lr=1e-3, epochs=30, batch_size=512,
)
timer.train(X_train, y_train)
print("  择时模型训练完成")

# ============================================================
# Step 3: Combined Backtest on 2025-2026
# ============================================================
print("\n" + "=" * 60)
print("[3] 2025-2026 组合回测: 周频选股 + 日频个股择时")
print("=" * 60)

# 加载 2025+ 日线数据并计算特征
daily_test = storage.load_all_daily("2024-06-01", "2026-04-01")
daily_test["date"] = pd.to_datetime(daily_test["date"])
daily_test = daily_test.sort_values(["code", "date"])

test_stocks = {}
for code in daily_test["code"].unique():
    sdf = daily_test[daily_test["code"] == code]
    if len(sdf) < 60:
        continue
    sdf = compute_stock_features(sdf)
    sdf = sdf.dropna(subset=TIMING_FEATURES)
    # 标准化
    sdf[TIMING_FEATURES] = (sdf[TIMING_FEATURES].values - feat_mean) / feat_std
    test_stocks[code] = sdf

# 选股: 每周选出 Top50
test_dataset = dataset[dataset["date"] >= "2025-01-01"]
weekly_dates = sorted(test_dataset["date"].unique())

# 构建每周的选股名单
weekly_selections = {}
for date in weekly_dates:
    wd = test_dataset[test_dataset["date"] == date]
    scores = selector.predict(wd)
    top = scores.nlargest(50, "score")
    weekly_selections[date] = set(top["code"].values)

# 日频回测
print("  日频回测...")
all_dates = sorted(daily_test[daily_test["date"] >= "2025-01-01"]["date"].unique())
daily_portfolio_returns = []  # 每天的组合收益

# 状态: 每只股票的持仓状态
holdings = {}  # code → {"holding": bool, "buy_day": date}
current_selection = set()
CONFIDENCE_THRESHOLD = 0.55

for day_idx, today in enumerate(all_dates):
    # 检查是否有新的周选股结果
    for wdate in weekly_dates:
        if pd.Timestamp(wdate) <= pd.Timestamp(today):
            current_selection = weekly_selections[wdate]

    if len(current_selection) == 0:
        daily_portfolio_returns.append(0.0)
        continue

    # 对每只选中的股票做择时
    stock_returns = []
    n_selected = len(current_selection)

    for code in current_selection:
        if code not in test_stocks:
            continue

        sdf = test_stocks[code]
        today_rows = sdf[sdf["date"] == today]
        if len(today_rows) == 0:
            continue

        today_idx = sdf.index.get_loc(today_rows.index[0])
        if today_idx < SEQ_LEN or today_idx + 1 >= len(sdf):
            continue

        # 获取特征窗口
        feat_window = sdf.iloc[today_idx-SEQ_LEN:today_idx][TIMING_FEATURES].values.astype(np.float32)
        if feat_window.shape[0] != SEQ_LEN:
            continue

        # ALSTM 预测
        pred_class, confidence = timer.predict_proba(feat_window)

        # 明天的收益
        tomorrow_close = sdf.iloc[today_idx + 1]["close"]
        today_close = sdf.iloc[today_idx]["close"]
        tomorrow_ret = (tomorrow_close - today_close) / today_close

        # 持仓状态
        state = holdings.get(code, {"holding": False, "buy_day": None})

        if not state["holding"]:
            # 未持仓: 看多 → 买入
            if pred_class == 1 and confidence >= CONFIDENCE_THRESHOLD:
                holdings[code] = {"holding": True, "buy_day": today}
                stock_returns.append(tomorrow_ret)  # 买入，享受明天收益
            else:
                stock_returns.append(0.0)  # 不买，无收益
        else:
            # 已持仓
            if pred_class == 0 and confidence >= CONFIDENCE_THRESHOLD and state["buy_day"] != today:
                # 看空且非买入当天(T+1) → 卖出
                holdings[code] = {"holding": False, "buy_day": None}
                stock_returns.append(0.0)  # 卖出日不计收益
            else:
                # 继续持有
                stock_returns.append(tomorrow_ret)

    # 等权平均
    if stock_returns:
        daily_portfolio_returns.append(np.mean(stock_returns))
    else:
        daily_portfolio_returns.append(0.0)

# 计算组合指标
rets = pd.Series(daily_portfolio_returns)
equity = (1 + rets).cumprod()
combined_sharpe = sharpe_ratio(rets, freq=252)
combined_annual = annual_return(equity, freq=252)
combined_dd = max_drawdown(equity)

# 纯选股（买入持有）
stock_only_returns = []
current_sel = set()
for day_idx, today in enumerate(all_dates):
    for wdate in weekly_dates:
        if pd.Timestamp(wdate) <= pd.Timestamp(today):
            current_sel = weekly_selections[wdate]

    srets = []
    for code in current_sel:
        if code not in test_stocks:
            continue
        sdf = test_stocks[code]
        rows = sdf[sdf["date"] == today]
        if len(rows) == 0:
            continue
        idx = sdf.index.get_loc(rows.index[0])
        if idx + 1 >= len(sdf):
            continue
        srets.append((sdf.iloc[idx+1]["close"] - sdf.iloc[idx]["close"]) / sdf.iloc[idx]["close"])
    stock_only_returns.append(np.mean(srets) if srets else 0.0)

so_rets = pd.Series(stock_only_returns)
so_eq = (1 + so_rets).cumprod()
so_sharpe = sharpe_ratio(so_rets, freq=252)
so_annual = annual_return(so_eq, freq=252)
so_dd = max_drawdown(so_eq)

# ============================================================
# Results
# ============================================================
print("\n" + "=" * 60)
print("2025-2026 FINAL RESULTS (Daily Frequency)")
print("=" * 60)
print(f"  Test period: {all_dates[0].strftime('%Y-%m-%d')} ~ {all_dates[-1].strftime('%Y-%m-%d')}")
print(f"  Trading days: {len(all_dates)}")
print()
print(f"{'Strategy':<30} {'Sharpe':>8} {'Annual':>10} {'MaxDD':>10}")
print("-" * 58)
print(f"{'Stock Only (buy & hold)':<30} {so_sharpe:>8.2f} {so_annual:>9.2%} {so_dd:>9.2%}")
print(f"{'Stock + Daily Timing':<30} {combined_sharpe:>8.2f} {combined_annual:>9.2%} {combined_dd:>9.2%}")
print("=" * 58)

# 择时增益
print(f"\n择时 vs 纯选股:")
print(f"  年化收益差: {combined_annual - so_annual:>+.2%}")
print(f"  回撤改善: {combined_dd - so_dd:>+.2%}")
print(f"  最终净值: 纯选股={so_eq.iloc[-1]:.4f}, 组合={equity.iloc[-1]:.4f}")

# 持仓统计
total_trades = sum(1 for r in daily_portfolio_returns if r != 0)
zero_days = sum(1 for r in daily_portfolio_returns if r == 0)
print(f"\n交易统计:")
print(f"  有持仓天数: {total_trades}")
print(f"  空仓天数: {zero_days}")
print(f"  持仓比例: {total_trades/len(daily_portfolio_returns):.1%}")
