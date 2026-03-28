import pytest
import pandas as pd
import numpy as np
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return
from backtest.engine import Backtester


def test_sharpe_ratio():
    # 稳定正收益 → 高夏普
    returns = pd.Series([0.01] * 52)  # 周频
    sr = sharpe_ratio(returns, freq=52)
    assert sr > 3.0


def test_max_drawdown():
    equity = pd.Series([100, 110, 105, 95, 100, 108])
    dd = max_drawdown(equity)
    assert dd == pytest.approx(-15 / 110, rel=0.01)


def test_backtester_basic():
    dates = pd.bdate_range("2024-01-01", periods=10, freq="W-FRI")
    prices = pd.DataFrame({
        "A": [10, 11, 12, 11, 13, 14, 13, 15, 16, 17],
        "B": [20, 19, 21, 22, 20, 21, 23, 22, 24, 25],
    }, index=dates)

    # 每周等权持有 A 和 B
    weights = pd.DataFrame({
        "A": [0.5] * 10,
        "B": [0.5] * 10,
    }, index=dates)

    bt = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0)
    result = bt.run(weights, prices)
    assert result.sharpe is not None
    assert result.max_drawdown <= 0
    assert len(result.equity_curve) == 10
