import pandas as pd
import numpy as np
from dataclasses import dataclass
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return


@dataclass
class BacktestResult:
    sharpe: float
    annual_ret: float
    max_drawdown: float
    turnover: float
    equity_curve: pd.Series


class Backtester:
    def __init__(self, commission: float = 0.0003, stamp_tax: float = 0.001,
                 slippage: float = 0.0001):
        self.commission = commission
        self.stamp_tax = stamp_tax
        self.slippage = slippage

    def run(self, weights: pd.DataFrame, prices: pd.DataFrame) -> BacktestResult:
        """
        weights: index=日期, columns=股票代码, values=目标权重
        prices: index=日期, columns=股票代码, values=收盘价
        """
        returns = prices.pct_change().fillna(0)
        port_returns = (weights.shift(1).fillna(0) * returns).sum(axis=1)

        # 换手成本
        weight_diff = weights.diff().fillna(0).abs()
        turnover = weight_diff.sum(axis=1)
        buy_cost = weight_diff.clip(lower=0).sum(axis=1) * (self.commission + self.slippage)
        sell_cost = weight_diff.clip(upper=0).abs().sum(axis=1) * (self.commission + self.stamp_tax + self.slippage)
        cost = buy_cost + sell_cost

        net_returns = port_returns - cost
        equity = (1 + net_returns).cumprod()

        return BacktestResult(
            sharpe=sharpe_ratio(net_returns, freq=52),
            annual_ret=annual_return(equity, freq=52),
            max_drawdown=max_drawdown(equity),
            turnover=float(turnover.mean()),
            equity_curve=equity,
        )
