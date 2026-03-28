import pytest
import pandas as pd
import numpy as np
from models.lightgbm_model import StockSelector


def make_factor_data(n_stocks=100, n_dates=50):
    records = []
    for d in range(n_dates):
        date = pd.Timestamp("2024-01-01") + pd.Timedelta(weeks=d)
        for s in range(n_stocks):
            records.append({
                "code": f"{s:06d}", "date": date,
                "momentum_5": np.random.randn(),
                "volatility_20": abs(np.random.randn()),
                "rsi_14": np.random.uniform(20, 80),
                "future_return": np.random.randn() * 0.05,
            })
    return pd.DataFrame(records)


def test_train_and_predict():
    df = make_factor_data()
    feature_cols = ["momentum_5", "volatility_20", "rsi_14"]

    selector = StockSelector(feature_cols=feature_cols, n_groups=5)
    train_df = df[df["date"] < "2024-10-01"]
    test_df = df[df["date"] >= "2024-10-01"]

    selector.train(train_df)
    scores = selector.predict(test_df)
    assert len(scores) == len(test_df)
    assert "score" in scores.columns


def test_select_top_n():
    df = make_factor_data(n_stocks=100, n_dates=10)
    feature_cols = ["momentum_5", "volatility_20", "rsi_14"]
    selector = StockSelector(feature_cols=feature_cols)
    selector.train(df)

    latest = df[df["date"] == df["date"].max()]
    top = selector.select_top(latest, n=10)
    assert len(top) == 10
