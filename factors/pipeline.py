import pandas as pd
from factors.price_volume import momentum, volatility, turnover_rate, volume_ratio
from factors.technical import rsi, macd_diff, bollinger_position, ma_deviation


class FactorPipeline:
    def compute(self, df: pd.DataFrame) -> pd.DataFrame:
        """输入单只股票的日线数据，输出因子DataFrame"""
        result = df[["code", "date"]].copy()

        # 量价因子
        result["momentum_5"] = momentum(df["close"], 5)
        result["momentum_10"] = momentum(df["close"], 10)
        result["momentum_20"] = momentum(df["close"], 20)
        result["volatility_20"] = volatility(df["close"], 20)
        result["volume_ratio_5"] = volume_ratio(df["volume"], 5)

        # 技术因子
        result["rsi_14"] = rsi(df["close"], 14)
        result["macd_diff"] = macd_diff(df["close"])
        result["boll_pos"] = bollinger_position(df["close"])
        result["ma_dev_20"] = ma_deviation(df["close"], 20)

        return result.dropna()
