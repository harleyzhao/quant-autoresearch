# 选股策略自动进化

## 你的任务
你是一个量化研究 agent。你的目标是不断优化 train.py 中的选股策略，提高验证集上的夏普比率。

## 可用模型 API

### StockSelector (models/lightgbm_model.py)
```python
class StockSelector:
    def __init__(self, feature_cols: list[str], n_groups: int = 5, params: dict = None):
        # params 是 LGBMRegressor 的参数, 默认:
        # {"n_estimators": 200, "num_leaves": 63, "learning_rate": 0.05, "max_depth": 6, "verbose": -1}
    def train(self, df: pd.DataFrame, label_col: str = "future_return"): ...
    def predict(self, df: pd.DataFrame) -> pd.DataFrame:  # 返回含 code, date, score 列
    def select_top(self, df: pd.DataFrame, n: int = 50) -> pd.DataFrame: ...
```

### Storage (data/storage.py)
```python
class Storage:
    def __init__(self, db_path): ...
    def load_all_factors(self, start=None, end=None) -> pd.DataFrame:  # 宽表: code, date, factor1, factor2, ...
    def load_all_daily(self, start=None, end=None) -> pd.DataFrame:  # code, date, open, high, low, close, volume
```

### Backtester (backtest/engine.py)
```python
class Backtester:
    def __init__(self, commission=0.0003, stamp_tax=0.001, slippage=0.0001): ...
    def run(self, weights: pd.DataFrame, prices: pd.DataFrame) -> BacktestResult:
        # weights/prices: index=日期, columns=股票代码
        # BacktestResult: sharpe, annual_ret, max_drawdown, turnover, equity_curve
```

## 可以尝试的方向
- 新增因子（量价、技术、基本面因子）
- 组合因子（因子交叉、因子变换、因子差分）
- 调整 LightGBM 超参: params={"n_estimators": X, "num_leaves": X, "learning_rate": X, "max_depth": X, "reg_alpha": X, "reg_lambda": X}
- 修改标签构造（分组数量、收益率计算窗口、排名方式）
- 调整训练窗口长度
- 修改选股数量 (Top N)
- 因子预处理（去极值 winsorize、标准化 zscore、行业中性化）
- 减少过拟合（增加正则化、降低模型复杂度、特征选择）

## 约束
- 不要使用 2024-07-01 之后的数据（测试集保留）
- 训练集：2018-01 ~ 2023-12，验证集：2024-01 ~ 2024-06
- 每次只改一个方向，便于归因
- 必须输出完整可运行的 train.py

## 已知陷阱（必须避免！）
- **pandas 3.0 不支持 `fillna(method='ffill')`，必须用 `.ffill()` 代替**
- **pandas 3.0 不支持 `fillna(method='bfill')`，必须用 `.bfill()` 代替**
- 数据库中只有这些因子: momentum_5, momentum_10, momentum_20, volatility_20, volume_ratio_5, rsi_14, macd_diff, boll_pos, ma_dev_20
- 如需新因子必须在 train.py 中用 pandas 从日线数据现场计算
- StockSelector 的参数名是 `params`（不是 `lgb_params`）
- predict() 返回的 DataFrame 包含 code, date, score 三列
