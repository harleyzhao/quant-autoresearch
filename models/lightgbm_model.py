import lightgbm as lgb
import pandas as pd
import numpy as np


class StockSelector:
    def __init__(self, feature_cols: list[str], n_groups: int = 5,
                 params: dict = None):
        self.feature_cols = feature_cols
        self.n_groups = n_groups
        self.model = None
        self.params = params or {
            "n_estimators": 200,
            "num_leaves": 63,
            "learning_rate": 0.05,
            "max_depth": 6,
            "verbose": -1,
        }

    def train(self, df: pd.DataFrame, label_col: str = "future_return"):
        """训练排序模型。df 必须包含 feature_cols, date, code, label_col"""
        df = df.copy()
        # 每个截面内按收益率排名，转换为分组 label (0 ~ n_groups-1)
        def rank_to_label(series):
            pct = series.rank(pct=True)
            return (pct * self.n_groups).clip(upper=self.n_groups).astype(int) - 1

        df["label"] = df.groupby("date")[label_col].transform(rank_to_label)
        df["label"] = df["label"].clip(lower=0)

        X = df[self.feature_cols].values
        y = df["label"].values.astype(float)

        self.model = lgb.LGBMRegressor(**self.params)
        self.model.fit(X, y)

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        X = df[self.feature_cols].values
        scores = self.model.predict(X)
        result = df[["code", "date"]].copy()
        result["score"] = scores
        return result

    def select_top(self, df: pd.DataFrame, n: int = 50) -> pd.DataFrame:
        scores = self.predict(df)
        return scores.nlargest(n, "score")
