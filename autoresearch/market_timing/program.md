# 个股日频择时策略自动进化

## 你的任务
优化 ALSTM 个股日频择时模型，目标是在选股基础上通过日频波段交易扩大收益。
当前基线：验证集夏普 0.74，但回撤 -77% 太大，需优先降低回撤。

## 可用模型 API

### MarketTimer (models/alstm_model.py)
```python
class MarketTimer:
    def __init__(self, input_size, seq_len=60, hidden_size=128, num_layers=2,
                 num_classes=3, dropout=0.3, lr=1e-3, epochs=50, batch_size=64):
    def train(self, features: np.ndarray, labels: np.ndarray):
        # 接受 2D (n_days, n_features) 或 3D (n_samples, seq_len, n_features)
    def predict_proba(self, features: np.ndarray) -> tuple[int, float]:
        # 输入 (seq_len, n_features)，返回 (类别, 置信度)
```

## 可以尝试的方向
- 调整模型参数: hidden_size(64/128/256), num_layers(1/2), dropout(0.3/0.5/0.7), batch_size(256/512/1024)
- 调整序列长度 SEQ_LEN(10/20/30/40)
- 改进特征工程（增减技术指标）
- 调整标签定义（阈值、未来收益天数）
- 调整买卖信号的置信度阈值
- 加入止损/止盈逻辑降低回撤
- 加入持仓时间限制（最多持N天）
- 改进回测逻辑

## 约束
- **必须使用 ALSTM 模型（MarketTimer 类）**
- **A股 T+1，买入当天不能卖出**
- **仓位只能 0 或 1（持有或不持有），不可做空**
- 训练集：2021-01 ~ 2023-12，验证集：2024-01 ~ 2024-06
- 每次只改一个方向
- 必须输出完整可运行的 train.py

## 已知陷阱
- MarketTimer.train() 接受 2D 或 3D 输入，自动检测维度
- 不要用 `pd.cut().astype(int)`，用手动赋值
- 不要用 `fillna(method='ffill')`，用 `.ffill()`
- 不要给 MarketTimer 传不支持的参数（如 early_stopping）
- 当前回撤 -77% 太大，优先解决
