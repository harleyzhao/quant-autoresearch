import pandas as pd
import numpy as np


def momentum(close: pd.Series, period: int) -> pd.Series:
    return close.pct_change(period)


def volatility(close: pd.Series, period: int) -> pd.Series:
    return close.pct_change().rolling(period).std()


def turnover_rate(volume: pd.Series, period: int) -> pd.Series:
    return volume.rolling(period).mean() / volume.rolling(period * 4).mean()


def volume_ratio(volume: pd.Series, period: int = 5) -> pd.Series:
    return volume / volume.rolling(period).mean()
