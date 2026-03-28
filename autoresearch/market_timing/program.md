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
