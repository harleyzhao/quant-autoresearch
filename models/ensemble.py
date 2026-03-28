import pandas as pd


def combine_signals(selected_stocks: pd.DataFrame, position: float,
                    n_stocks: int = 50) -> pd.DataFrame:
    """
    合成选股和择时信号。
    selected_stocks: 选股结果，含 code 和 score 列
    position: 择时仓位 (0.0 ~ 1.0)
    返回: 权重 DataFrame，含 code 和 weight 列
    """
    top = selected_stocks.nlargest(n_stocks, "score").copy()
    weight = position / n_stocks if n_stocks > 0 else 0.0
    top["weight"] = weight
    return top[["code", "weight"]]
