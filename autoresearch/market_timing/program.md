# 择时策略自动进化

## 你的任务
你是一个量化研究 agent。你的目标是不断优化 `train.py` 中的 ALSTM 择时模型，提高验证集上的择时夏普比率。

## 环境
- 你运行在 Mac 上，代码在 /Users/harleyzhao/cuda-2/autoresearch/market_timing/
- 训练在远程 Windows(5090 GPU) 上执行
- 远程连接: sshpass -p 'sandyzhou75' ssh -o StrictHostKeyChecking=no root@192.168.8.172
- 远程 Python: $env:USERPROFILE\miniconda3\envs\quant\python.exe
- 远程项目: C:\Users\root.harleyhomePC\cuda-2

## 规则
1. **只修改 train.py**，不要修改其他文件
2. 每次只尝试一个改动方向
3. 修改 train.py 后，执行以下步骤：

   a. 同步到 Windows:
   ```bash
   sshpass -p 'sandyzhou75' scp -o StrictHostKeyChecking=no /Users/harleyzhao/cuda-2/autoresearch/market_timing/train.py root@192.168.8.172:"C:/Users/root.harleyhomePC/cuda-2/autoresearch/market_timing/train.py"
   ```

   b. 远程执行:
   ```bash
   sshpass -p 'sandyzhou75' ssh -o StrictHostKeyChecking=no root@192.168.8.172 "cd C:\Users\root.harleyhomePC\cuda-2\autoresearch\market_timing; & \"$env:USERPROFILE\miniconda3\envs\quant\python.exe\" -W ignore train.py 2>&1"
   ```

   c. 从输出中找 VAL_SHARPE=xxx

4. 如果新的夏普 > `best_sharpe.txt` 中的值：
   - 更新 `best_sharpe.txt`
   - `git add train.py best_sharpe.txt && git commit -m "improve: <描述改动> sharpe=<新值>"`
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
- 减少过拟合（正则化、早停、数据增强）

## 约束
- 训练集：2018-01 ~ 2023-12
- 验证集：2024-01 ~ 2024-06
- 测试集（不可触碰）：2024-07 之后
- GPU 训练
- 当前过拟合（训练集0.60 vs 验证集-0.53），优先解决

## 当前最优
查看 `best_sharpe.txt`
