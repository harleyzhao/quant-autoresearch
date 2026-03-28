import pandas as pd
import numpy as np


def sharpe_ratio(returns: pd.Series, freq: int = 52, rf: float = 0.0) -> float:
    excess = returns - rf / freq
    std = excess.std()
    if std == 0:
        # Constant positive returns → infinite Sharpe; constant zero/negative → 0
        return float("inf") if excess.mean() > 0 else 0.0
    return float(excess.mean() / std * np.sqrt(freq))


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.expanding().max()
    dd = (equity - peak) / peak
    return float(dd.min())


def annual_return(equity: pd.Series, freq: int = 52) -> float:
    total = equity.iloc[-1] / equity.iloc[0]
    n_periods = len(equity)
    return float(total ** (freq / n_periods) - 1)
