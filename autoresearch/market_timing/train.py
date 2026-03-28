# autoresearch/market_timing/train.py
"""
ALSTM 择时模型训练与回测 — autoresearch agent 可编辑此文件
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
import torch
from models.alstm_model import MarketTimer
from backtest.engine import Backtester

# === 配置 ===
DB_PATH = "../../data/cache/market.db"
INDEX_CODE = "000905"  # 中证500指数
SEQ_LEN = 60
HIDDEN_SIZE = 128
NUM_LAYERS = 2
DROPOUT = 0.3
LR = 1e-3
EPOCHS = 50
BATCH_SIZE = 64

TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"

# === 数据加载和特征构建 ===
# TODO: 从数据库加载指数数据，构建择时特征

# === 标签构建 ===
# TODO: 未来一周涨跌幅 → 三分类(看空/中性/看多)

# === 模型训练 ===
timer = MarketTimer(
    input_size=15, seq_len=SEQ_LEN, hidden_size=HIDDEN_SIZE,
    num_layers=NUM_LAYERS, dropout=DROPOUT, lr=LR,
    epochs=EPOCHS, batch_size=BATCH_SIZE,
)
# TODO: 训练

# === 回测 ===
# TODO: 用择时信号控制仓位，计算夏普

train_sharpe = 0.0
val_sharpe = 0.0

print(f"训练集夏普: {train_sharpe:.4f}")
print(f"验证集夏普: {val_sharpe:.4f}")
print(f"VAL_SHARPE={val_sharpe:.4f}")
