import pytest
from data.fetcher import Fetcher


@pytest.fixture
def fetcher():
    return Fetcher()


@pytest.mark.integration
def test_fetch_daily_returns_dataframe(fetcher):
    df = fetcher.fetch_daily("000001", "20240101", "20240110")
    assert len(df) > 0
    assert "close" in df.columns
    assert "volume" in df.columns


@pytest.mark.integration
def test_fetch_index_components(fetcher):
    codes = fetcher.fetch_csi500_components()
    assert len(codes) == 500
    assert all(isinstance(c, str) for c in codes)
