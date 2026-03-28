import pytest
import torch
import numpy as np
from models.alstm import ALSTM
from models.alstm_model import MarketTimer


def test_alstm_forward():
    model = ALSTM(input_size=15, hidden_size=128, num_layers=2, num_classes=3)
    x = torch.randn(8, 60, 15)  # batch=8, seq=60, features=15
    out = model(x)
    assert out.shape == (8, 3)


def test_market_timer_train_and_predict():
    n_days = 500
    features = np.random.randn(n_days, 15).astype(np.float32)
    # 0=看空, 1=中性, 2=看多
    labels = np.random.randint(0, 3, n_days - 60)

    timer = MarketTimer(input_size=15, seq_len=60, hidden_size=64,
                        num_layers=1, epochs=2, batch_size=32)
    timer.train(features, labels)

    pred = timer.predict(features[-60:])
    assert pred in [0, 1, 2]


def test_market_timer_position():
    timer = MarketTimer(input_size=15, seq_len=60)
    assert timer.to_position(2, 0.8) == 1.0   # 看多高置信
    assert timer.to_position(1, 0.5) == 0.5   # 中性
    assert timer.to_position(0, 0.8) == 0.0   # 看空高置信
