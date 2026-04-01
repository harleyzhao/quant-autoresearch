"""
Optuna 自动超参优化 — 择时 ALSTM 波段模型
不需要 LLM，纯 GPU 优化
"""
import sys
sys.path.insert(0, "..")

import pandas as pd
import numpy as np
import optuna
from data.storage import Storage
from models.alstm_model import MarketTimer
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return

optuna.logging.set_verbosity(optuna.logging.WARNING)

DB = "../data/cache/market.db"
storage = Storage(DB)


def _compute_rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


# ============================================================
# Load and prepare data once
# ============================================================
print("Loading data...", flush=True)
daily = storage.load_all_daily("2020-01-01", "2024-07-01")
print(f"  Loaded {len(daily)} daily rows", flush=True)
daily["date"] = pd.to_datetime(daily["date"])
daily = daily.sort_values(["code", "date"])
codes = daily["code"].unique()
print(f"  {len(codes)} stocks", flush=True)

# Compute features for all stocks
ALL_FEATURES = [
    "ret_1", "ret_3", "ret_5", "ret_10", "ret_20",
    "vol_5", "vol_10", "vol_20",
    "volume_ratio", "rsi_14",
    "ma_dev_5", "ma_dev_10", "ma_dev_20", "price_pos",
]

print("Computing features...", flush=True)
all_stocks = []
total_codes = len(codes)
for ci, code in enumerate(codes):
    if (ci + 1) % 50 == 0:
        print(f"  {ci+1}/{total_codes} stocks...", flush=True)
    sdf = daily[daily["code"] == code].copy().sort_values("date")
    if len(sdf) < 60:
        continue
    sdf["ret_1"] = sdf["close"].pct_change(1)
    sdf["ret_3"] = sdf["close"].pct_change(3)
    sdf["ret_5"] = sdf["close"].pct_change(5)
    sdf["ret_10"] = sdf["close"].pct_change(10)
    sdf["ret_20"] = sdf["close"].pct_change(20)
    sdf["vol_5"] = sdf["ret_1"].rolling(5).std()
    sdf["vol_10"] = sdf["ret_1"].rolling(10).std()
    sdf["vol_20"] = sdf["ret_1"].rolling(20).std()
    sdf["volume_ma5"] = sdf["volume"].rolling(5).mean()
    sdf["volume_ratio"] = sdf["volume"] / sdf["volume_ma5"].replace(0, np.nan)
    sdf["rsi_14"] = _compute_rsi(sdf["close"], 14)
    sdf["ma_5"] = sdf["close"].rolling(5).mean()
    sdf["ma_10"] = sdf["close"].rolling(10).mean()
    sdf["ma_20"] = sdf["close"].rolling(20).mean()
    sdf["ma_dev_5"] = sdf["close"] / sdf["ma_5"] - 1
    sdf["ma_dev_10"] = sdf["close"] / sdf["ma_10"] - 1
    sdf["ma_dev_20"] = sdf["close"] / sdf["ma_20"] - 1
    sdf["high_20"] = sdf["high"].rolling(20).max()
    sdf["low_20"] = sdf["low"].rolling(20).min()
    sdf["price_pos"] = (sdf["close"] - sdf["low_20"]) / (sdf["high_20"] - sdf["low_20"]).replace(0, np.nan)

    # Label: future 5d return for swing position detection
    sdf["future_5d_ret"] = sdf["close"].pct_change(5).shift(-5)
    sdf = sdf.dropna(subset=ALL_FEATURES + ["future_5d_ret"])
    all_stocks.append(sdf)

all_data = pd.concat(all_stocks, ignore_index=True)
print(f"  Done: {len(all_data)} total rows, {all_data['code'].nunique()} stocks", flush=True)

# Compute quantiles on train period
train_part = all_data[(all_data["date"] >= "2021-01-01") & (all_data["date"] <= "2023-12-31")]
val_part = all_data[(all_data["date"] >= "2024-01-01") & (all_data["date"] <= "2024-06-30")]

# Standardize
feat_mean = train_part[ALL_FEATURES].values.mean(axis=0).astype(np.float32)
feat_std = train_part[ALL_FEATURES].values.std(axis=0).astype(np.float32) + 1e-8
all_data[ALL_FEATURES] = (all_data[ALL_FEATURES].values - feat_mean) / feat_std

# Re-split after standardization
train_data = all_data[(all_data["date"] >= "2021-01-01") & (all_data["date"] <= "2023-12-31")]
val_data = all_data[(all_data["date"] >= "2024-01-01") & (all_data["date"] <= "2024-06-30")]

print(f"Train: {len(train_data)}, Val: {len(val_data)}")


def objective(trial):
    # === 搜索空间 ===

    # 特征选择 — 缩小到 Top5 发现的有效特征子集
    # 固定使用 Top5 共有的核心特征，只搜索可选特征
    use_features = ["ret_5", "ret_20", "vol_5", "vol_10", "ma_dev_5", "ma_dev_10"]
    optional = ["ret_1", "ret_3", "vol_20", "volume_ratio", "rsi_14", "ma_dev_20", "price_pos"]
    for f in optional:
        if trial.suggest_categorical(f"use_{f}", [True, False]):
            use_features.append(f)

    # ALSTM 超参 — 缩小到 Top5 发现的最优区域
    seq_len = trial.suggest_categorical("seq_len", [15, 20, 25])
    hidden_size = trial.suggest_categorical("hidden_size", [256, 512])
    num_layers = trial.suggest_int("num_layers", 1, 2)
    dropout = trial.suggest_float("dropout", 0.3, 0.6)
    lr = trial.suggest_float("lr", 5e-3, 1.5e-2, log=True)
    epochs = trial.suggest_int("epochs", 12, 20)
    batch_size = trial.suggest_categorical("batch_size", [512, 1024, 2048])

    # 标签参数
    q_low = trial.suggest_float("q_low", 0.2, 0.35)
    q_high = 1.0 - q_low

    # 置信度阈值
    confidence_threshold = trial.suggest_float("confidence", 0.5, 0.6)

    # === Labels ===
    q_l = train_part["future_5d_ret"].quantile(q_low)
    q_h = train_part["future_5d_ret"].quantile(q_high)

    all_data_copy = all_data.copy()
    all_data_copy["label"] = 1
    all_data_copy.loc[all_data_copy["future_5d_ret"] >= q_h, "label"] = 0  # 低位(买)
    all_data_copy.loc[all_data_copy["future_5d_ret"] <= q_l, "label"] = 2  # 高位(卖)

    td = all_data_copy[(all_data_copy["date"] >= "2021-01-01") & (all_data_copy["date"] <= "2023-12-31")]
    vd = all_data_copy[(all_data_copy["date"] >= "2024-01-01") & (all_data_copy["date"] <= "2024-06-30")]

    # === Build sequences ===
    X_list, y_list = [], []
    for code in td["code"].unique():
        sdf = td[td["code"] == code].sort_values("date")
        feat = sdf[use_features].values.astype(np.float32)
        lab = sdf["label"].values.astype(int)
        if len(feat) < seq_len + 1:
            continue
        for i in range(seq_len, len(feat)):
            X_list.append(feat[i - seq_len:i])
            y_list.append(lab[i])

    if len(X_list) < 100:
        return -999

    X_train = np.array(X_list, dtype=np.float32)
    y_train = np.array(y_list, dtype=np.int64)

    # === Train ===
    try:
        timer = MarketTimer(
            input_size=len(use_features), seq_len=seq_len,
            hidden_size=hidden_size, num_layers=num_layers,
            num_classes=3, dropout=dropout, lr=lr,
            epochs=epochs, batch_size=batch_size,
        )
        timer.train(X_train, y_train)
    except Exception:
        return -999

    # === Validate: swing backtest on val period (batch inference) ===
    swing_rets = []

    for code in vd["code"].unique():
        sdf = vd[vd["code"] == code].sort_values("date")
        feat = sdf[use_features].values.astype(np.float32)
        closes = sdf["close"].values

        if len(feat) < seq_len + 2:
            continue

        # 批量收集所有特征窗口
        windows = []
        valid_indices = []
        for i in range(seq_len, len(feat) - 1):
            windows.append(feat[i - seq_len:i])
            valid_indices.append(i)

        if not windows:
            continue

        # 批量推理（一次性送 GPU）
        try:
            results = timer.batch_predict_proba(windows)
        except:
            continue

        # 应用交易逻辑
        holding = True
        buy_day = -1
        for idx, (pred, conf) in zip(valid_indices, results):
            tomorrow_ret = (closes[idx + 1] - closes[idx]) / closes[idx]

            if pred == 0 and conf >= confidence_threshold:
                if not holding:
                    holding = True
                    buy_day = idx
                swing_rets.append(tomorrow_ret)
            elif pred == 2 and conf >= confidence_threshold and holding and idx > buy_day:
                holding = False
                swing_rets.append(0.0)
            else:
                swing_rets.append(tomorrow_ret if holding else 0.0)

    if len(swing_rets) < 10:
        return -999

    sr = sharpe_ratio(pd.Series(swing_rets), freq=252)
    return sr


# ============================================================
# Run
# ============================================================
print("Starting Optuna optimization for ALSTM swing timing...")
print("No LLM needed. Pure GPU optimization.")
print("Press Ctrl+C to stop.\n")

study = optuna.create_study(
    direction="maximize",
    study_name="swing_timing_v4",
    storage="sqlite:///../data/cache/optuna.db",
    load_if_exists=True,
)

best_so_far = study.best_value if len(study.trials) > 0 else -999


def callback(study, trial):
    global best_so_far
    if trial.value and trial.value > best_so_far:
        best_so_far = trial.value
        features_used = [f for f in ALL_FEATURES if trial.params.get(f"use_{f}", False)]
        print(f"\n*** NEW BEST: Sharpe={trial.value:.4f} ***")
        print(f"  Features({len(features_used)}): {features_used}")
        print(f"  seq_len={trial.params['seq_len']}, hidden={trial.params['hidden_size']}, "
              f"layers={trial.params['num_layers']}, dropout={trial.params['dropout']:.2f}")
        print(f"  lr={trial.params['lr']:.5f}, epochs={trial.params['epochs']}, "
              f"batch={trial.params['batch_size']}")
        print(f"  q_low={trial.params['q_low']:.2f}, confidence={trial.params['confidence']:.2f}")
        print(f"  Trial #{trial.number}\n")


try:
    study.optimize(objective, n_trials=10000, callbacks=[callback], show_progress_bar=True)
except KeyboardInterrupt:
    pass

print(f"\n{'='*65}")
print(f"Optimization Results")
print(f"{'='*65}")
print(f"Total trials: {len(study.trials)}")
print(f"Best Sharpe: {study.best_value:.4f}")
print(f"\nBest params:")
for k, v in study.best_params.items():
    print(f"  {k}: {v}")
