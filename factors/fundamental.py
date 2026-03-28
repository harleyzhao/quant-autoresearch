"""基本面因子 - 从财务数据计算，后续扩展"""
import pandas as pd


def ep(close: pd.Series, eps: pd.Series) -> pd.Series:
    return eps / close


def bp(close: pd.Series, bps: pd.Series) -> pd.Series:
    return bps / close
