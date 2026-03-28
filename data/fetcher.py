import akshare as ak
import pandas as pd


class Fetcher:
    def fetch_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        """获取个股日线数据。code: 6位代码如 '000001'"""
        df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                start_date=start, end_date=end, adjust="qfq")
        df = df.rename(columns={
            "日期": "date", "开盘": "open", "最高": "high",
            "最低": "low", "收盘": "close", "成交量": "volume",
        })
        df["code"] = code
        df["date"] = pd.to_datetime(df["date"])
        return df[["code", "date", "open", "high", "low", "close", "volume"]]

    def fetch_csi500_components(self) -> list[str]:
        """获取中证500成分股代码列表"""
        df = ak.index_stock_cons(symbol="000905")
        return df["品种代码"].tolist()

    def fetch_csi1000_components(self) -> list[str]:
        """获取中证1000成分股代码列表"""
        df = ak.index_stock_cons(symbol="000852")
        return df["品种代码"].tolist()

    def fetch_index_daily(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        """获取指数日线数据。symbol: '000905'(中证500) 或 '000852'(中证1000)"""
        df = ak.stock_zh_index_daily(symbol=f"sh{symbol}")
        df = df.rename(columns={"date": "date", "open": "open", "high": "high",
                                "low": "low", "close": "close", "volume": "volume"})
        df["date"] = pd.to_datetime(df["date"])
        df = df[(df["date"] >= start) & (df["date"] <= end)]
        return df
