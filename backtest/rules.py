"""A股交易规则"""
import pandas as pd


def apply_limit_up_down(prices: pd.DataFrame, weights: pd.DataFrame) -> pd.DataFrame:
    """涨跌停无法交易：涨停买不进，跌停卖不出"""
    pct = prices.pct_change()
    limit_up = pct >= 0.095
    limit_down = pct <= -0.095

    adjusted = weights.copy()
    prev_weights = weights.shift(1).fillna(0)

    for col in weights.columns:
        mask_up = limit_up[col] if col in limit_up.columns else pd.Series(False, index=weights.index)
        increase = adjusted[col] > prev_weights[col]
        adjusted.loc[mask_up & increase, col] = prev_weights.loc[mask_up & increase, col]

        mask_down = limit_down[col] if col in limit_down.columns else pd.Series(False, index=weights.index)
        decrease = adjusted[col] < prev_weights[col]
        adjusted.loc[mask_down & decrease, col] = prev_weights.loc[mask_down & decrease, col]

    return adjusted


def filter_st(codes: list[str], st_list: list[str]) -> list[str]:
    """剔除ST股"""
    return [c for c in codes if c not in st_list]
