import pytest
import pandas as pd
import numpy as np
from factors.price_volume import momentum, turnover_rate
from factors.technical import rsi, macd_diff
from factors.pipeline import FactorPipeline


def make_daily(n=30):
    dates = pd.bdate_range("2024-01-01", periods=n)
    close = 10 + np.cumsum(np.random.randn(n) * 0.5)
    return pd.DataFrame({
        "date": dates, "open": close - 0.1, "high": close + 0.5,
        "low": close - 0.5, "close": close, "volume": np.random.randint(1000, 5000, n),
    })


def test_momentum():
    df = make_daily(30)
    result = momentum(df["close"], 5)
    assert len(result) == 30
    assert pd.notna(result.iloc[-1])


def test_rsi():
    df = make_daily(30)
    result = rsi(df["close"], 14)
    valid = result.dropna()
    assert all((0 <= v <= 100) for v in valid)


def test_pipeline_produces_factors():
    df = make_daily(60)
    df["code"] = "000001"
    pipeline = FactorPipeline()
    factors = pipeline.compute(df)
    assert "momentum_5" in factors.columns
    assert "rsi_14" in factors.columns
    assert len(factors) > 0
