import pytest
import pandas as pd
from data.storage import Storage

@pytest.fixture
def storage(tmp_path):
    return Storage(tmp_path / "test.db")

def test_save_and_load_daily(storage):
    df = pd.DataFrame({
        "code": ["000001", "000002"],
        "date": pd.to_datetime(["2024-01-01", "2024-01-01"]),
        "close": [10.0, 20.0],
        "volume": [1000, 2000],
    })
    storage.save_daily(df)
    result = storage.load_daily("000001", "2024-01-01", "2024-01-02")
    assert len(result) == 1
    assert result.iloc[0]["close"] == 10.0

def test_save_and_load_factors(storage):
    df = pd.DataFrame({
        "code": ["000001"],
        "date": pd.to_datetime(["2024-01-01"]),
        "momentum_5": [0.05],
        "pe": [15.0],
    })
    storage.save_factors(df)
    result = storage.load_factors("2024-01-01")
    assert len(result) == 1
    assert result.iloc[0]["momentum_5"] == pytest.approx(0.05)
