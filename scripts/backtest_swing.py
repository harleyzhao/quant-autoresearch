"""
波段择时回测：在选中的股票上做高抛低吸
ALSTM 预测的是"当前处于波段高位还是低位"
- 低位(超卖) → 买入/加仓
- 高位(超买) → 卖出/减仓
- 中间 → 持有不动
"""
import sys
sys.path.insert(0, ".")
import pandas as pd
import numpy as np
from data.storage import Storage
from models.lightgbm_model import StockSelector
from models.alstm_model import MarketTimer
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return


def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


DB = "data/cache/market.db"
storage = Storage(DB)

# ============================================================
# Step 1: Train Stock Selection
# ============================================================
print("[1] Training stock selection model...")

STOCK_FEATURES = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

factors = storage.load_all_factors("2021-01-01", "2026-04-01")
factors["date"] = pd.to_datetime(factors["date"])
daily_all = storage.load_all_daily("2021-01-01", "2026-04-01")
daily_all["date"] = pd.to_datetime(daily_all["date"])
daily_all = daily_all.sort_values(["code", "date"])

# Weekly for stock selection
dtmp = daily_all.copy()
dtmp["week"] = dtmp["date"].dt.isocalendar().week.astype(int)
dtmp["year"] = dtmp["date"].dt.year
wp = dtmp.groupby(["code", "year", "week"]).last().reset_index().sort_values(["code", "date"])
wp["future_return"] = wp.groupby("code")["close"].pct_change().shift(-1)

factors["year"] = factors["date"].dt.year
factors["week"] = factors["date"].dt.isocalendar().week.astype(int)
wf = factors.groupby(["code", "year", "week"]).last().reset_index()

ds = wp[["code", "date", "close", "future_return"]].merge(
    wf[["code", "date"] + STOCK_FEATURES], on=["code", "date"], how="inner",
)
ds = ds.dropna(subset=STOCK_FEATURES + ["future_return"])
train_ds = ds[ds["date"] <= "2024-12-31"]

selector = StockSelector(
    feature_cols=STOCK_FEATURES, n_groups=5,
    params={"n_estimators": 50, "num_leaves": 15, "learning_rate": 0.1,
            "max_depth": 3, "reg_alpha": 1.0, "reg_lambda": 1.0,
            "min_child_samples": 50, "subsample": 0.8, "colsample_bytree": 0.8,
            "verbose": -1}
)
selector.train(train_ds)
print("  Done")

# ============================================================
# Step 2: Train Swing Timing Model
# ============================================================
print("\n[2] Training swing timing model (ALSTM)...")

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

# 构建训练数据
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

# 标签: 预测未来5天收益的位置
# 0 = 低位(未来5天涨幅大, 应该买入)
# 1 = 中间(持有不动)
# 2 = 高位(未来5天跌幅大, 应该卖出)
all_data["future_5d_ret"] = all_data.groupby("code")["close"].transform(
    lambda x: x.pct_change(5).shift(-5)
)
all_data = all_data.dropna(subset=["future_5d_ret"]).reset_index(drop=True)

train_part = all_data[(all_data["date"] >= "2021-01-01") & (all_data["date"] <= "2024-12-31")]
q30 = train_part["future_5d_ret"].quantile(0.30)
q70 = train_part["future_5d_ret"].quantile(0.70)

# 低位 = 未来要涨(买入机会), 高位 = 未来要跌(卖出时机)
all_data["label"] = 1  # 中间
all_data.loc[all_data["future_5d_ret"] >= q70, "label"] = 0  # 低位(未来涨→现在是买点)
all_data.loc[all_data["future_5d_ret"] <= q30, "label"] = 2  # 高位(未来跌→现在是卖点)

print(f"  Labels: buy={sum(all_data['label']==0)}, hold={sum(all_data['label']==1)}, sell={sum(all_data['label']==2)}")

# 标准化
train_vals = train_part[TIMING_FEATURES].values
feat_mean = train_vals.mean(axis=0).astype(np.float32)
feat_std = train_vals.std(axis=0).astype(np.float32) + 1e-8
all_data[TIMING_FEATURES] = (all_data[TIMING_FEATURES].values - feat_mean) / feat_std

# 序列化
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
print(f"  Training sequences: {len(X_train)}")

timer = MarketTimer(
    input_size=len(TIMING_FEATURES), seq_len=SEQ_LEN,
    hidden_size=128, num_layers=2, num_classes=3,
    dropout=0.4, lr=1e-3, epochs=30, batch_size=512,
)
timer.train(X_train, y_train)
print("  Done")

# ============================================================
# Step 3: Backtest on 2025-2026
# ============================================================
print("\n[3] Backtesting 2025-2026...")

# 加载测试数据
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
    sdf[TIMING_FEATURES] = (sdf[TIMING_FEATURES].values - feat_mean) / feat_std
    test_stocks[code] = sdf

# 选股名单
test_ds = ds[ds["date"] >= "2025-01-01"]
weekly_dates = sorted(test_ds["date"].unique())
weekly_selections = {}
for date in weekly_dates:
    wd = test_ds[test_ds["date"] == date]
    scores = selector.predict(wd)
    top = scores.nlargest(50, "score")
    weekly_selections[date] = set(top["code"].values)

# 日频波段回测
all_dates = sorted(daily_test[daily_test["date"] >= "2025-01-01"]["date"].unique())
swing_returns = []     # 波段策略
buyhold_returns = []   # 纯持有对比

current_selection = set()
holdings = {}  # code → {"holding": bool, "buy_day": date}

for today in all_dates:
    # 更新选股名单
    for wdate in weekly_dates:
        if pd.Timestamp(wdate) <= pd.Timestamp(today):
            current_selection = weekly_selections[wdate]

    swing_rets_today = []
    bh_rets_today = []

    for code in current_selection:
        if code not in test_stocks:
            continue
        sdf = test_stocks[code]
        rows = sdf[sdf["date"] == today]
        if len(rows) == 0:
            continue
        idx = sdf.index.get_loc(rows.index[0])
        if idx < SEQ_LEN or idx + 1 >= len(sdf):
            continue

        today_close = sdf.iloc[idx]["close"]
        tomorrow_close = sdf.iloc[idx + 1]["close"]
        daily_ret = (tomorrow_close - today_close) / today_close

        # 纯持有: 永远持有
        bh_rets_today.append(daily_ret)

        # 波段策略
        feat_window = sdf.iloc[idx-SEQ_LEN:idx][TIMING_FEATURES].values.astype(np.float32)
        if feat_window.shape[0] != SEQ_LEN:
            swing_rets_today.append(daily_ret)  # fallback to hold
            continue

        pred_class, confidence = timer.predict_proba(feat_window)
        state = holdings.get(code, {"holding": True, "buy_day": None})

        if pred_class == 0 and confidence >= 0.55:
            # 低位信号 → 买入/持有
            if not state["holding"]:
                holdings[code] = {"holding": True, "buy_day": today}
            swing_rets_today.append(daily_ret)

        elif pred_class == 2 and confidence >= 0.55:
            # 高位信号 → 卖出
            if state["holding"] and state.get("buy_day") != today:  # T+1
                holdings[code] = {"holding": False, "buy_day": None}
                swing_rets_today.append(0.0)  # 卖出，不享受收益
            else:
                swing_rets_today.append(daily_ret)  # T+1限制，继续持有

        else:
            # 中间 → 保持现状
            if state["holding"]:
                swing_rets_today.append(daily_ret)
            else:
                swing_rets_today.append(0.0)

    swing_returns.append(np.mean(swing_rets_today) if swing_rets_today else 0.0)
    buyhold_returns.append(np.mean(bh_rets_today) if bh_rets_today else 0.0)

# 计算结果
sw = pd.Series(swing_returns)
bh = pd.Series(buyhold_returns)
sw_eq = (1 + sw).cumprod()
bh_eq = (1 + bh).cumprod()

print(f"\n{'='*65}")
print(f"2025-2026 Results: Swing Trading vs Buy & Hold")
print(f"Period: {all_dates[0].strftime('%Y-%m-%d')} ~ {all_dates[-1].strftime('%Y-%m-%d')}")
print(f"{'='*65}")
print(f"{'Strategy':<30} {'Sharpe':>8} {'Annual':>10} {'MaxDD':>10} {'Final':>8}")
print(f"{'-'*65}")
print(f"{'Buy & Hold (Top 50)':<30} {sharpe_ratio(bh,252):>8.2f} {annual_return(bh_eq,252):>9.2%} {max_drawdown(bh_eq):>9.2%} {bh_eq.iloc[-1]:>7.2f}x")
print(f"{'Swing Trading (Top 50)':<30} {sharpe_ratio(sw,252):>8.2f} {annual_return(sw_eq,252):>9.2%} {max_drawdown(sw_eq):>9.2%} {sw_eq.iloc[-1]:>7.2f}x")
print(f"{'='*65}")

# 超额收益
excess = annual_return(sw_eq, 252) - annual_return(bh_eq, 252)
print(f"\nSwing vs Buy&Hold: {excess:>+.2%} annual excess return")

# 交易统计
hold_days = sum(1 for r in swing_returns if r != 0)
empty_days = sum(1 for r in swing_returns if r == 0)
print(f"Holding days: {hold_days}/{len(swing_returns)} ({hold_days/len(swing_returns):.1%})")
