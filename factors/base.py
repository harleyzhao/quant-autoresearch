"""因子计算基础工具"""
import pandas as pd
import numpy as np


def rolling_rank(series: pd.Series, window: int) -> pd.Series:
    """滚动排名百分位"""
    return series.rolling(window).apply(lambda x: pd.Series(x).rank().iloc[-1] / len(x))
