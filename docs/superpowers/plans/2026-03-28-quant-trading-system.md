# A股量化交易系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建基于 LightGBM(选股) + ALSTM(择时) 的A股量化交易系统，使用 Karpathy autoresearch 循环自动进化策略。

**Architecture:** 双循环独立进化架构。LightGBM 负责中证500/1000截面选股，ALSTM 负责市场择时控制仓位，两个模型通过各自的 autoresearch 循环独立进化，以夏普比率为优化目标。Mac 开发，SSH 连接 Windows(5090) 训练。

**Tech Stack:** Python 3.11+, AKShare, SQLite, LightGBM, PyTorch(ALSTM), Claude Code(autoresearch agent)

---

## 文件结构

```
cuda-2/
├── requirements.txt
├── requirements-gpu.txt
├── data/
│   ├── __init__.py
│   ├── fetcher.py              # AKShare 数据下载
│   ├── storage.py              # SQLite 存储
│   └── universe.py             # 成分股管理
├── factors/
│   ├── __init__.py
│   ├── base.py                 # 因子基类
│   ├── price_volume.py         # 量价因子
│   ├── fundamental.py          # 基本面因子
│   ├── technical.py            # 技术因子
│   └── pipeline.py             # 因子计算流水线
├── models/
│   ├── __init__.py
│   ├── lightgbm_model.py       # LightGBM 选股
│   ├── alstm.py                # ALSTM 网络定义
│   ├── alstm_model.py          # ALSTM 训练/推理
│   └── ensemble.py             # 信号合成
├── backtest/
│   ├── __init__.py
│   ├── engine.py               # 回测引擎
│   ├── metrics.py              # 指标计算
│   └── rules.py                # A股交易规则
├── autoresearch/
│   ├── stock_selection/
│   │   ├── program.md
│   │   ├── train.py
│   │   └── best_sharpe.txt
│   ├── market_timing/
│   │   ├── program.md
│   │   ├── train.py
│   │   └── best_sharpe.txt
│   └── evaluate.py
├── deploy/
│   ├── setup_windows.sh
│   ├── sync.sh
│   └── start_autoresearch.sh
├── scripts/
│   ├── download_data.py
│   └── prepare_data.py
└── tests/
    ├── test_fetcher.py
    ├── test_storage.py
    ├── test_factors.py
    ├── test_backtest.py
    ├── test_lightgbm.py
    └── test_alstm.py
```

---

## Task 1: 项目初始化与依赖

**Files:**
- Create: `requirements.txt`
- Create: `requirements-gpu.txt`
- Create: `.gitignore`

- [ ] **Step 1: 创建 requirements.txt**

```txt
akshare>=1.12.0
pandas>=2.0.0
numpy>=1.24.0
scikit-learn>=1.3.0
lightgbm>=4.0.0
torch>=2.1.0
pytest>=7.4.0
```

- [ ] **Step 2: 创建 requirements-gpu.txt**

```txt
-r requirements.txt
# Windows 5090 GPU: 安装 CUDA 版 PyTorch
# pip install torch --index-url https://download.pytorch.org/whl/cu124
```

- [ ] **Step 3: 创建 .gitignore**

```
data/cache/
__pycache__/
*.pyc
.env
.venv/
*.db
```

- [ ] **Step 4: 初始化 git 并提交**

```bash
cd /Users/harleyzhao/cuda-2
git init
git add requirements.txt requirements-gpu.txt .gitignore
git commit -m "feat: init project with dependencies"
```

---

## Task 2: 数据存储层 (SQLite)

**Files:**
- Create: `data/__init__.py`
- Create: `data/storage.py`
- Create: `tests/test_storage.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_storage.py
import pytest
import pandas as pd
from data.storage import Storage

@pytest.fixture
def storage(tmp_path):
    return Storage(tmp_path / "test.db")

def test_save_and_load_daily(storage):
    df = pd.DataFrame({
        "code": ["000001", "000002"],
        "date": pd.to_datetime(["2024-01-01", "2024-01-01"]),
        "close": [10.0, 20.0],
        "volume": [1000, 2000],
    })
    storage.save_daily(df)
    result = storage.load_daily("000001", "2024-01-01", "2024-01-02")
    assert len(result) == 1
    assert result.iloc[0]["close"] == 10.0

def test_save_and_load_factors(storage):
    df = pd.DataFrame({
        "code": ["000001"],
        "date": pd.to_datetime(["2024-01-01"]),
        "momentum_5": [0.05],
        "pe": [15.0],
    })
    storage.save_factors(df)
    result = storage.load_factors("2024-01-01")
    assert len(result) == 1
    assert result.iloc[0]["momentum_5"] == pytest.approx(0.05)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_storage.py -v
```
Expected: FAIL

- [ ] **Step 3: 实现 Storage**

```python
# data/__init__.py
(空文件)

# data/storage.py
import sqlite3
import pandas as pd
from pathlib import Path


class Storage:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily (
                    code TEXT, date TEXT, open REAL, high REAL,
                    low REAL, close REAL, volume REAL,
                    PRIMARY KEY (code, date)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS factors (
                    code TEXT, date TEXT,
                    factor_name TEXT, factor_value REAL,
                    PRIMARY KEY (code, date, factor_name)
                )
            """)

    def save_daily(self, df: pd.DataFrame):
        with sqlite3.connect(self.db_path) as conn:
            df.to_sql("daily", conn, if_exists="append", index=False)

    def load_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        with sqlite3.connect(self.db_path) as conn:
            return pd.read_sql(
                "SELECT * FROM daily WHERE code=? AND date>=? AND date<?",
                conn, params=(code, start, end),
            )

    def save_factors(self, df: pd.DataFrame):
        """Save wide-format factor DataFrame (columns are factor names)."""
        id_cols = ["code", "date"]
        factor_cols = [c for c in df.columns if c not in id_cols]
        long = df.melt(id_vars=id_cols, value_vars=factor_cols,
                       var_name="factor_name", value_name="factor_value")
        with sqlite3.connect(self.db_path) as conn:
            long.to_sql("factors", conn, if_exists="append", index=False)

    def load_factors(self, date: str) -> pd.DataFrame:
        with sqlite3.connect(self.db_path) as conn:
            long = pd.read_sql(
                "SELECT * FROM factors WHERE date=?", conn, params=(date,),
            )
        if long.empty:
            return long
        return long.pivot(index=["code", "date"], columns="factor_name",
                          values="factor_value").reset_index()
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_storage.py -v
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add data/ tests/test_storage.py
git commit -m "feat: add SQLite storage layer"
```

---

## Task 3: 数据获取 (AKShare)

**Files:**
- Create: `data/fetcher.py`
- Create: `data/universe.py`
- Create: `tests/test_fetcher.py`
- Create: `scripts/download_data.py`

- [ ] **Step 1: 写测试**

```python
# tests/test_fetcher.py
import pytest
from data.fetcher import Fetcher

@pytest.fixture
def fetcher():
    return Fetcher()

def test_fetch_daily_returns_dataframe(fetcher):
    """需要网络，标记为集成测试"""
    df = fetcher.fetch_daily("000001", "20240101", "20240110")
    assert len(df) > 0
    assert "close" in df.columns
    assert "volume" in df.columns

def test_fetch_index_components(fetcher):
    codes = fetcher.fetch_csi500_components()
    assert len(codes) == 500
    assert all(isinstance(c, str) for c in codes)
```

- [ ] **Step 2: 实现 Fetcher 和 Universe**

```python
# data/fetcher.py
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
```

```python
# data/universe.py
from data.fetcher import Fetcher


class Universe:
    def __init__(self, index: str = "csi500"):
        self.fetcher = Fetcher()
        self.index = index

    def get_components(self) -> list[str]:
        if self.index == "csi500":
            return self.fetcher.fetch_csi500_components()
        elif self.index == "csi1000":
            return self.fetcher.fetch_csi1000_components()
        else:
            raise ValueError(f"Unknown index: {self.index}")
```

```python
# scripts/download_data.py
"""一键下载历史数据到 SQLite"""
import sys
sys.path.insert(0, ".")

from data.fetcher import Fetcher
from data.storage import Storage
from data.universe import Universe


def main():
    storage = Storage("data/cache/market.db")
    universe = Universe("csi500")
    fetcher = Fetcher()

    codes = universe.get_components()
    print(f"下载 {len(codes)} 只股票数据...")

    for i, code in enumerate(codes):
        try:
            df = fetcher.fetch_daily(code, "20180101", "20241231")
            storage.save_daily(df)
            if (i + 1) % 50 == 0:
                print(f"  进度: {i+1}/{len(codes)}")
        except Exception as e:
            print(f"  跳过 {code}: {e}")

    print("完成")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 运行测试（需网络）**

```bash
pytest tests/test_fetcher.py -v -k "test_fetch_daily"
```

- [ ] **Step 4: 提交**

```bash
git add data/fetcher.py data/universe.py scripts/download_data.py tests/test_fetcher.py
git commit -m "feat: add AKShare data fetcher and download script"
```

---

## Task 4: 因子计算

**Files:**
- Create: `factors/__init__.py`
- Create: `factors/base.py`
- Create: `factors/price_volume.py`
- Create: `factors/fundamental.py`
- Create: `factors/technical.py`
- Create: `factors/pipeline.py`
- Create: `tests/test_factors.py`

- [ ] **Step 1: 写测试**

```python
# tests/test_factors.py
import pytest
import pandas as pd
import numpy as np
from factors.price_volume import momentum, turnover_rate
from factors.technical import rsi, macd_diff
from factors.pipeline import FactorPipeline


def make_daily(n=30):
    dates = pd.bdate_range("2024-01-01", periods=n)
    close = 10 + np.cumsum(np.random.randn(n) * 0.5)
    return pd.DataFrame({
        "date": dates, "open": close - 0.1, "high": close + 0.5,
        "low": close - 0.5, "close": close, "volume": np.random.randint(1000, 5000, n),
    })


def test_momentum():
    df = make_daily(30)
    result = momentum(df["close"], 5)
    assert len(result) == 30
    assert pd.notna(result.iloc[-1])


def test_rsi():
    df = make_daily(30)
    result = rsi(df["close"], 14)
    valid = result.dropna()
    assert all((0 <= v <= 100) for v in valid)


def test_pipeline_produces_factors():
    df = make_daily(60)
    df["code"] = "000001"
    pipeline = FactorPipeline()
    factors = pipeline.compute(df)
    assert "momentum_5" in factors.columns
    assert "rsi_14" in factors.columns
    assert len(factors) > 0
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_factors.py -v
```

- [ ] **Step 3: 实现因子模块**

```python
# factors/__init__.py
(空文件)

# factors/base.py
"""因子计算基础工具"""
import pandas as pd
import numpy as np


def rolling_rank(series: pd.Series, window: int) -> pd.Series:
    """滚动排名百分位"""
    return series.rolling(window).apply(lambda x: pd.Series(x).rank().iloc[-1] / len(x))
```

```python
# factors/price_volume.py
import pandas as pd
import numpy as np


def momentum(close: pd.Series, period: int) -> pd.Series:
    return close.pct_change(period)


def volatility(close: pd.Series, period: int) -> pd.Series:
    return close.pct_change().rolling(period).std()


def turnover_rate(volume: pd.Series, period: int) -> pd.Series:
    return volume.rolling(period).mean() / volume.rolling(period * 4).mean()


def volume_ratio(volume: pd.Series, period: int = 5) -> pd.Series:
    return volume / volume.rolling(period).mean()
```

```python
# factors/technical.py
import pandas as pd
import numpy as np


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def macd_diff(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    ema_fast = close.ewm(span=fast).mean()
    ema_slow = close.ewm(span=slow).mean()
    macd = ema_fast - ema_slow
    sig = macd.ewm(span=signal).mean()
    return macd - sig


def bollinger_position(close: pd.Series, period: int = 20) -> pd.Series:
    ma = close.rolling(period).mean()
    std = close.rolling(period).std()
    return (close - ma) / (2 * std)


def ma_deviation(close: pd.Series, period: int = 20) -> pd.Series:
    return close / close.rolling(period).mean() - 1
```

```python
# factors/fundamental.py
"""基本面因子 — 从财务数据计算，后续扩展"""
import pandas as pd


def ep(close: pd.Series, eps: pd.Series) -> pd.Series:
    return eps / close


def bp(close: pd.Series, bps: pd.Series) -> pd.Series:
    return bps / close
```

```python
# factors/pipeline.py
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_factors.py -v
```

- [ ] **Step 5: 提交**

```bash
git add factors/ tests/test_factors.py
git commit -m "feat: add factor computation pipeline"
```

---

## Task 5: 回测引擎

**Files:**
- Create: `backtest/__init__.py`
- Create: `backtest/metrics.py`
- Create: `backtest/rules.py`
- Create: `backtest/engine.py`
- Create: `tests/test_backtest.py`

- [ ] **Step 1: 写测试**

```python
# tests/test_backtest.py
import pytest
import pandas as pd
import numpy as np
from backtest.metrics import sharpe_ratio, max_drawdown, annual_return
from backtest.engine import Backtester


def test_sharpe_ratio():
    # 稳定正收益 → 高夏普
    returns = pd.Series([0.01] * 52)  # 周频
    sr = sharpe_ratio(returns, freq=52)
    assert sr > 3.0


def test_max_drawdown():
    equity = pd.Series([100, 110, 105, 95, 100, 108])
    dd = max_drawdown(equity)
    assert dd == pytest.approx(-15 / 110, rel=0.01)


def test_backtester_basic():
    dates = pd.bdate_range("2024-01-01", periods=10, freq="W-FRI")
    prices = pd.DataFrame({
        "A": [10, 11, 12, 11, 13, 14, 13, 15, 16, 17],
        "B": [20, 19, 21, 22, 20, 21, 23, 22, 24, 25],
    }, index=dates)

    # 每周等权持有 A 和 B
    weights = pd.DataFrame({
        "A": [0.5] * 10,
        "B": [0.5] * 10,
    }, index=dates)

    bt = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0)
    result = bt.run(weights, prices)
    assert result.sharpe is not None
    assert result.max_drawdown <= 0
    assert len(result.equity_curve) == 10
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_backtest.py -v
```

- [ ] **Step 3: 实现回测模块**

```python
# backtest/__init__.py
(空文件)

# backtest/metrics.py
import pandas as pd
import numpy as np


def sharpe_ratio(returns: pd.Series, freq: int = 52, rf: float = 0.0) -> float:
    excess = returns - rf / freq
    if excess.std() == 0:
        return 0.0
    return float(excess.mean() / excess.std() * np.sqrt(freq))


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.expanding().max()
    dd = (equity - peak) / peak
    return float(dd.min())


def annual_return(equity: pd.Series, freq: int = 52) -> float:
    total = equity.iloc[-1] / equity.iloc[0]
    n_periods = len(equity)
    return float(total ** (freq / n_periods) - 1)
```

```python
# backtest/rules.py
"""A股交易规则"""
import pandas as pd


def apply_limit_up_down(prices: pd.DataFrame, weights: pd.DataFrame) -> pd.DataFrame:
    """涨跌停无法交易：涨停买不进，跌停卖不出"""
    pct = prices.pct_change()
    limit_up = pct >= 0.095  # 涨停近似
    limit_down = pct <= -0.095

    adjusted = weights.copy()
    prev_weights = weights.shift(1).fillna(0)

    for col in weights.columns:
        # 涨停：不能新买入（权重不能增加）
        mask_up = limit_up[col] if col in limit_up.columns else pd.Series(False, index=weights.index)
        increase = adjusted[col] > prev_weights[col]
        adjusted.loc[mask_up & increase, col] = prev_weights.loc[mask_up & increase, col]

        # 跌停：不能卖出（权重不能减少）
        mask_down = limit_down[col] if col in limit_down.columns else pd.Series(False, index=weights.index)
        decrease = adjusted[col] < prev_weights[col]
        adjusted.loc[mask_down & decrease, col] = prev_weights.loc[mask_down & decrease, col]

    return adjusted


def filter_st(codes: list[str], st_list: list[str]) -> list[str]:
    """剔除ST股"""
    return [c for c in codes if c not in st_list]
```

```python
# backtest/engine.py
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_backtest.py -v
```

- [ ] **Step 5: 提交**

```bash
git add backtest/ tests/test_backtest.py
git commit -m "feat: add backtest engine with A-share rules"
```

---

## Task 6: LightGBM 选股模型

**Files:**
- Create: `models/__init__.py`
- Create: `models/lightgbm_model.py`
- Create: `tests/test_lightgbm.py`

- [ ] **Step 1: 写测试**

```python
# tests/test_lightgbm.py
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_lightgbm.py -v
```

- [ ] **Step 3: 实现 StockSelector**

```python
# models/__init__.py
(空文件)

# models/lightgbm_model.py
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
            "objective": "lambdarank",
            "metric": "ndcg",
            "ndcg_eval_at": [10, 20],
            "num_leaves": 63,
            "learning_rate": 0.05,
            "max_depth": 6,
            "verbose": -1,
        }

    def train(self, df: pd.DataFrame, label_col: str = "future_return"):
        """训练排序模型。df 必须包含 feature_cols, date, code, label_col"""
        df = df.copy()
        # 每个截面内按收益率排名作为 label
        df["label"] = df.groupby("date")[label_col].rank(pct=True)
        # group size: 每个日期有多少只股票
        group_sizes = df.groupby("date").size().values

        X = df[self.feature_cols].values
        y = df["label"].values

        dataset = lgb.Dataset(X, label=y, group=group_sizes)
        self.model = lgb.train(self.params, dataset, num_boost_round=200)

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        X = df[self.feature_cols].values
        scores = self.model.predict(X)
        result = df[["code", "date"]].copy()
        result["score"] = scores
        return result

    def select_top(self, df: pd.DataFrame, n: int = 50) -> pd.DataFrame:
        scores = self.predict(df)
        return scores.nlargest(n, "score")
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_lightgbm.py -v
```

- [ ] **Step 5: 提交**

```bash
git add models/ tests/test_lightgbm.py
git commit -m "feat: add LightGBM stock selection model"
```

---

## Task 7: ALSTM 择时模型

**Files:**
- Create: `models/alstm.py`
- Create: `models/alstm_model.py`
- Create: `tests/test_alstm.py`

- [ ] **Step 1: 写测试**

```python
# tests/test_alstm.py
import pytest
import torch
import numpy as np
from models.alstm import ALSTM
from models.alstm_model import MarketTimer


def test_alstm_forward():
    model = ALSTM(input_size=15, hidden_size=128, num_layers=2, num_classes=3)
    x = torch.randn(8, 60, 15)  # batch=8, seq=60, features=15
    out = model(x)
    assert out.shape == (8, 3)


def test_market_timer_train_and_predict():
    n_days = 500
    features = np.random.randn(n_days, 15).astype(np.float32)
    # 0=看空, 1=中性, 2=看多
    labels = np.random.randint(0, 3, n_days - 60)

    timer = MarketTimer(input_size=15, seq_len=60, hidden_size=64,
                        num_layers=1, epochs=2, batch_size=32)
    timer.train(features, labels)

    pred = timer.predict(features[-60:])
    assert pred in [0, 1, 2]


def test_market_timer_position():
    timer = MarketTimer(input_size=15, seq_len=60)
    assert timer.to_position(2, 0.8) == 1.0   # 看多高置信
    assert timer.to_position(1, 0.5) == 0.5   # 中性
    assert timer.to_position(0, 0.8) == 0.0   # 看空高置信
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_alstm.py -v
```

- [ ] **Step 3: 实现 ALSTM**

```python
# models/alstm.py
import torch
import torch.nn as nn


class Attention(nn.Module):
    def __init__(self, hidden_size: int):
        super().__init__()
        self.attn = nn.Linear(hidden_size, 1)

    def forward(self, lstm_output: torch.Tensor) -> torch.Tensor:
        # lstm_output: (batch, seq, hidden)
        scores = self.attn(lstm_output).squeeze(-1)  # (batch, seq)
        weights = torch.softmax(scores, dim=1).unsqueeze(-1)  # (batch, seq, 1)
        context = (lstm_output * weights).sum(dim=1)  # (batch, hidden)
        return context


class ALSTM(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 128,
                 num_layers: int = 2, num_classes: int = 3,
                 dropout: float = 0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers,
                            batch_first=True, dropout=dropout if num_layers > 1 else 0)
        self.attention = Attention(hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq, input_size)
        lstm_out, _ = self.lstm(x)       # (batch, seq, hidden)
        context = self.attention(lstm_out)  # (batch, hidden)
        out = self.dropout(context)
        return self.fc(out)                # (batch, num_classes)
```

```python
# models/alstm_model.py
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from models.alstm import ALSTM


class MarketTimer:
    def __init__(self, input_size: int = 15, seq_len: int = 60,
                 hidden_size: int = 128, num_layers: int = 2,
                 num_classes: int = 3, dropout: float = 0.3,
                 lr: float = 1e-3, epochs: int = 50, batch_size: int = 64):
        self.input_size = input_size
        self.seq_len = seq_len
        self.num_classes = num_classes
        self.epochs = epochs
        self.batch_size = batch_size
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = ALSTM(input_size, hidden_size, num_layers,
                           num_classes, dropout).to(self.device)
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        self.criterion = nn.CrossEntropyLoss()

    def _make_sequences(self, features: np.ndarray, labels: np.ndarray = None):
        X = []
        for i in range(len(features) - self.seq_len):
            X.append(features[i:i + self.seq_len])
        X = np.array(X, dtype=np.float32)
        if labels is not None:
            return X, labels[:len(X)]
        return X

    def train(self, features: np.ndarray, labels: np.ndarray):
        X, y = self._make_sequences(features, labels)
        dataset = TensorDataset(torch.tensor(X), torch.tensor(y, dtype=torch.long))
        loader = DataLoader(dataset, batch_size=self.batch_size, shuffle=True)

        self.model.train()
        for epoch in range(self.epochs):
            for batch_x, batch_y in loader:
                batch_x, batch_y = batch_x.to(self.device), batch_y.to(self.device)
                self.optimizer.zero_grad()
                output = self.model(batch_x)
                loss = self.criterion(output, batch_y)
                loss.backward()
                self.optimizer.step()

    def predict(self, features: np.ndarray) -> int:
        """输入最近 seq_len 天的特征，返回预测类别"""
        if len(features) < self.seq_len:
            raise ValueError(f"Need at least {self.seq_len} days of features")
        x = features[-self.seq_len:]
        x = torch.tensor(x, dtype=torch.float32).unsqueeze(0).to(self.device)
        self.model.eval()
        with torch.no_grad():
            output = self.model(x)
            return int(output.argmax(dim=1).item())

    def predict_proba(self, features: np.ndarray) -> tuple[int, float]:
        """返回 (预测类别, 最大概率)"""
        x = features[-self.seq_len:]
        x = torch.tensor(x, dtype=torch.float32).unsqueeze(0).to(self.device)
        self.model.eval()
        with torch.no_grad():
            output = torch.softmax(self.model(x), dim=1)
            prob, cls = output.max(dim=1)
            return int(cls.item()), float(prob.item())

    @staticmethod
    def to_position(pred_class: int, confidence: float, threshold: float = 0.6) -> float:
        if pred_class == 2 and confidence >= threshold:
            return 1.0
        elif pred_class == 0 and confidence >= threshold:
            return 0.0
        else:
            return 0.5
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_alstm.py -v
```

- [ ] **Step 5: 提交**

```bash
git add models/alstm.py models/alstm_model.py tests/test_alstm.py
git commit -m "feat: add ALSTM market timing model"
```

---

## Task 8: 信号合成

**Files:**
- Create: `models/ensemble.py`

- [ ] **Step 1: 实现信号合成**

```python
# models/ensemble.py
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
```

- [ ] **Step 2: 提交**

```bash
git add models/ensemble.py
git commit -m "feat: add signal combination module"
```

---

## Task 9: Autoresearch 循环 — 选股

**Files:**
- Create: `autoresearch/stock_selection/program.md`
- Create: `autoresearch/stock_selection/train.py`
- Create: `autoresearch/stock_selection/best_sharpe.txt`

- [ ] **Step 1: 创建 program.md**

```markdown
# 选股策略自动进化

## 你的任务
你是一个量化研究 agent。你的目标是不断优化 `train.py` 中的选股策略，提高验证集上的夏普比率。

## 规则
1. **只修改 train.py**，不要修改其他文件
2. 每次只尝试一个改动方向，便于归因
3. 运行 `python train.py`，它会输出验证集夏普比率
4. 如果新的夏普 > `best_sharpe.txt` 中的值：
   - 更新 `best_sharpe.txt`
   - `git add -A && git commit -m "improve: <描述你的改动> sharpe=<新值>"`
5. 如果没有提升：
   - `git checkout -- train.py`
6. 继续下一轮实验

## 可以尝试的方向
- 新增因子（量价、技术、基本面）
- 组合因子（因子交叉、因子变换）
- 调整 LightGBM 超参（num_leaves, learning_rate, max_depth, num_boost_round）
- 修改标签构造（分组数量、收益率计算窗口）
- 调整训练窗口长度
- 修改选股数量 (Top N)
- 因子预处理（去极值、标准化、中性化）

## 约束
- 不要使用 2024-07-01 之后的数据（测试集保留）
- 训练集：2018-01 ~ 2023-12
- 验证集：2024-01 ~ 2024-06
- 单次实验限时10分钟
- 注意防止过拟合：训练集和验证集夏普差距不能太大

## 当前最优
查看 `best_sharpe.txt` 获取当前最优夏普比率。
```

- [ ] **Step 2: 创建 train.py**

```python
# autoresearch/stock_selection/train.py
"""
选股策略训练与回测 — autoresearch agent 可编辑此文件
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
from data.storage import Storage
from factors.pipeline import FactorPipeline
from models.lightgbm_model import StockSelector
from backtest.engine import Backtester

# === 配置 ===
DB_PATH = "../../data/cache/market.db"
TRAIN_START = "2018-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"
TOP_N = 50
FEATURE_COLS = [
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_20", "volume_ratio_5",
    "rsi_14", "macd_diff", "boll_pos", "ma_dev_20",
]

# === 数据加载 ===
storage = Storage(DB_PATH)
# 加载全部因子数据（需要先运行 prepare_data.py）
# 这里假设因子已经计算并存入数据库

# === 模型训练 ===
selector = StockSelector(feature_cols=FEATURE_COLS, n_groups=5)
# TODO: 加载训练数据并训练

# === 回测 ===
backtester = Backtester(commission=0.0003, stamp_tax=0.001, slippage=0.0001)
# TODO: 构建周频权重矩阵并回测

# === 输出结果 ===
train_sharpe = 0.0  # TODO
val_sharpe = 0.0    # TODO

print(f"训练集夏普: {train_sharpe:.4f}")
print(f"验证集夏普: {val_sharpe:.4f}")
print(f"VAL_SHARPE={val_sharpe:.4f}")
```

- [ ] **Step 3: 初始化 best_sharpe.txt**

```
0.0
```

- [ ] **Step 4: 提交**

```bash
git add autoresearch/stock_selection/
git commit -m "feat: add stock selection autoresearch loop"
```

---

## Task 10: Autoresearch 循环 — 择时

**Files:**
- Create: `autoresearch/market_timing/program.md`
- Create: `autoresearch/market_timing/train.py`
- Create: `autoresearch/market_timing/best_sharpe.txt`

- [ ] **Step 1: 创建 program.md**

```markdown
# 择时策略自动进化

## 你的任务
你是一个量化研究 agent。你的目标是不断优化 `train.py` 中的 ALSTM 择时模型，提高验证集上的择时夏普比率。

## 规则
1. **只修改 train.py**，不要修改其他文件
2. 每次只尝试一个改动方向
3. 运行 `python train.py`，查看验证集夏普比率
4. 如果新的夏普 > `best_sharpe.txt` 中的值：
   - 更新 `best_sharpe.txt`
   - `git add -A && git commit -m "improve: <描述改动> sharpe=<新值>"`
5. 否则：`git checkout -- train.py`
6. 继续

## 可以尝试的方向
- 修改 ALSTM 结构（层数、hidden_size、dropout）
- 更换 Attention 类型（additive → dot-product → multi-head）
- 增减输入特征（市场宽度、波动率、资金流）
- 调整序列长度（30/60/90天）
- 修改仓位映射阈值
- 调整学习率、batch_size、训练轮数
- 添加学习率调度器
- 尝试不同的标签定义（涨跌幅分位数、趋势判定）

## 约束
- 训练集：2018-01 ~ 2023-12
- 验证集：2024-01 ~ 2024-06
- 测试集（不可触碰）：2024-07 之后
- 单次实验限时15分钟
- GPU 训练

## 当前最优
查看 `best_sharpe.txt`
```

- [ ] **Step 2: 创建 train.py**

```python
# autoresearch/market_timing/train.py
"""
ALSTM 择时模型训练与回测 — autoresearch agent 可编辑此文件
"""
import sys
sys.path.insert(0, "../..")

import pandas as pd
import numpy as np
import torch
from models.alstm_model import MarketTimer
from backtest.engine import Backtester

# === 配置 ===
DB_PATH = "../../data/cache/market.db"
INDEX_CODE = "000905"  # 中证500指数
SEQ_LEN = 60
HIDDEN_SIZE = 128
NUM_LAYERS = 2
DROPOUT = 0.3
LR = 1e-3
EPOCHS = 50
BATCH_SIZE = 64

TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-06-30"

# === 数据加载和特征构建 ===
# TODO: 从数据库加载指数数据，构建择时特征

# === 标签构建 ===
# TODO: 未来一周涨跌幅 → 三分类(看空/中性/看多)

# === 模型训练 ===
timer = MarketTimer(
    input_size=15, seq_len=SEQ_LEN, hidden_size=HIDDEN_SIZE,
    num_layers=NUM_LAYERS, dropout=DROPOUT, lr=LR,
    epochs=EPOCHS, batch_size=BATCH_SIZE,
)
# TODO: 训练

# === 回测 ===
# TODO: 用择时信号控制仓位，计算夏普

train_sharpe = 0.0
val_sharpe = 0.0

print(f"训练集夏普: {train_sharpe:.4f}")
print(f"验证集夏普: {val_sharpe:.4f}")
print(f"VAL_SHARPE={val_sharpe:.4f}")
```

- [ ] **Step 3: 初始化 best_sharpe.txt 为 `0.0`**

- [ ] **Step 4: 提交**

```bash
git add autoresearch/market_timing/
git commit -m "feat: add market timing autoresearch loop"
```

---

## Task 11: 整体评估脚本

**Files:**
- Create: `autoresearch/evaluate.py`

- [ ] **Step 1: 实现**

```python
# autoresearch/evaluate.py
"""
合成评估：选股 × 择时 → 整体夏普比率
不可被 autoresearch agent 修改
"""
import sys
sys.path.insert(0, "..")

from models.ensemble import combine_signals
from backtest.engine import Backtester


def evaluate(stock_scores, timing_position, prices, n_stocks=50):
    weights = combine_signals(stock_scores, timing_position, n_stocks)
    # TODO: 构建完整权重矩阵并回测
    backtester = Backtester()
    # result = backtester.run(weight_matrix, prices)
    # return result


if __name__ == "__main__":
    print("整体评估脚本 — 合并选股和择时最优结果")
    # TODO: 加载两个循环各自的最优模型，合成评估
```

- [ ] **Step 2: 提交**

```bash
git add autoresearch/evaluate.py
git commit -m "feat: add combined evaluation script"
```

---

## Task 12: 部署脚本 (SSH远程)

**Files:**
- Create: `deploy/sync.sh`
- Create: `deploy/setup_windows.sh`
- Create: `deploy/start_autoresearch.sh`
- Create: `.env.example`

- [ ] **Step 1: 创建部署脚本**

```bash
# deploy/sync.sh
#!/bin/bash
# Mac→Windows 代码同步
REMOTE_USER=${REMOTE_USER:-user}
REMOTE_HOST=${REMOTE_HOST:-windows-ip}
REMOTE_DIR=${REMOTE_DIR:-~/cuda-2}

rsync -avz --exclude='data/cache' --exclude='.venv' --exclude='__pycache__' \
  --exclude='.git' \
  ./ ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/
echo "同步完成"
```

```bash
# deploy/setup_windows.sh
#!/bin/bash
# Windows 环境一键配置（通过 SSH 执行）
pip install -r requirements-gpu.txt
python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
npm install -g @anthropic-ai/claude-code
cd ~/cuda-2 && git init
echo "环境配置完成"
```

```bash
# deploy/start_autoresearch.sh
#!/bin/bash
# 远程启动 autoresearch 循环
REMOTE_USER=${REMOTE_USER:-user}
REMOTE_HOST=${REMOTE_HOST:-windows-ip}

echo "启动选股进化循环..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ~/cuda-2/autoresearch/stock_selection && \
  tmux new-session -d -s stock 'claude-code --agent program.md'"

echo "启动择时进化循环..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ~/cuda-2/autoresearch/market_timing && \
  tmux new-session -d -s timing 'claude-code --agent program.md'"

echo "两个循环已启动。查看进度："
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} -t 'tmux attach -t stock'"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} -t 'tmux attach -t timing'"
```

```bash
# .env.example
REMOTE_USER=your_username
REMOTE_HOST=your_windows_ip
REMOTE_DIR=~/cuda-2
```

- [ ] **Step 2: 提交**

```bash
git add deploy/ .env.example
git commit -m "feat: add SSH deployment scripts"
```

---

## Task 13: 数据预处理脚本

**Files:**
- Create: `scripts/prepare_data.py`

- [ ] **Step 1: 实现**

```python
# scripts/prepare_data.py
"""下载数据后，计算全部因子并存入数据库"""
import sys
sys.path.insert(0, ".")

import pandas as pd
from data.storage import Storage
from data.universe import Universe
from factors.pipeline import FactorPipeline


def main():
    storage = Storage("data/cache/market.db")
    universe = Universe("csi500")
    pipeline = FactorPipeline()

    codes = universe.get_components()
    print(f"计算 {len(codes)} 只股票的因子...")

    for i, code in enumerate(codes):
        try:
            df = storage.load_daily(code, "2017-01-01", "2025-01-01")
            if len(df) < 60:
                continue
            factors = pipeline.compute(df)
            storage.save_factors(factors)
            if (i + 1) % 50 == 0:
                print(f"  进度: {i+1}/{len(codes)}")
        except Exception as e:
            print(f"  跳过 {code}: {e}")

    print("因子计算完成")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 提交**

```bash
git add scripts/prepare_data.py
git commit -m "feat: add data preparation script"
```

---

## 执行顺序

```
Task 1  → 项目初始化
Task 2  → 数据存储层
Task 3  → 数据获取
Task 13 → 数据预处理
Task 4  → 因子计算
Task 5  → 回测引擎
Task 6  → LightGBM 选股
Task 7  → ALSTM 择时
Task 8  → 信号合成
Task 9  → Autoresearch 选股循环
Task 10 → Autoresearch 择时循环
Task 11 → 整体评估
Task 12 → 部署脚本
```
