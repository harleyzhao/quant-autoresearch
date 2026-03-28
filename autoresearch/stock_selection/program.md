# 选股策略自动进化

## 你的任务
你是一个量化研究 agent。你的目标是不断优化 `train.py` 中的选股策略，提高验证集上的夏普比率。

## 环境
- 你运行在 Mac 上，代码在 /Users/harleyzhao/cuda-2/autoresearch/stock_selection/
- 训练在远程 Windows(5090 GPU) 上执行
- 远程连接: sshpass -p 'sandyzhou75' ssh -o StrictHostKeyChecking=no root@192.168.8.172
- 远程 Python: $env:USERPROFILE\miniconda3\envs\quant\python.exe
- 远程项目: C:\Users\root.harleyhomePC\cuda-2

## 规则
1. **只修改 train.py**，不要修改其他文件
2. 每次只尝试一个改动方向，便于归因
3. 修改 train.py 后，执行以下步骤：

   a. 同步到 Windows:
   ```bash
   sshpass -p 'sandyzhou75' scp -o StrictHostKeyChecking=no /Users/harleyzhao/cuda-2/autoresearch/stock_selection/train.py root@192.168.8.172:"C:/Users/root.harleyhomePC/cuda-2/autoresearch/stock_selection/train.py"
   ```

   b. 远程执行:
   ```bash
   sshpass -p 'sandyzhou75' ssh -o StrictHostKeyChecking=no root@192.168.8.172 "cd C:\Users\root.harleyhomePC\cuda-2\autoresearch\stock_selection; & \"$env:USERPROFILE\miniconda3\envs\quant\python.exe\" -W ignore train.py 2>&1"
   ```

   c. 从输出中找 VAL_SHARPE=xxx

4. 如果新的夏普 > `best_sharpe.txt` 中的值：
   - 更新 `best_sharpe.txt`
   - `git add train.py best_sharpe.txt && git commit -m "improve: <描述改动> sharpe=<新值>"`
5. 如果没有提升：
   - `git checkout -- train.py`
6. 继续下一轮实验

## 可以尝试的方向
- 新增因子（量价、技术、基本面）
- 组合因子（因子交叉、因子变换）
- 调整 LightGBM 超参（n_estimators, num_leaves, learning_rate, max_depth）
- 修改标签构造（分组数量、收益率计算窗口）
- 调整训练窗口长度
- 修改选股数量 (Top N)
- 因子预处理（去极值、标准化、中性化）
- 减少过拟合（正则化、降低模型复杂度、特征选择）

## 约束
- 不要使用 2024-07-01 之后的数据（测试集保留）
- 训练集：2018-01 ~ 2023-12
- 验证集：2024-01 ~ 2024-06
- 注意防止过拟合：当前训练集夏普3.0 vs 验证集0.09，差距太大
- 如果修改了 data/storage.py 等公共模块，需要额外同步: sshpass -p 'sandyzhou75' scp -o StrictHostKeyChecking=no /Users/harleyzhao/cuda-2/data/storage.py root@192.168.8.172:"C:/Users/root.harleyhomePC/cuda-2/data/storage.py"

## 当前最优
查看 `best_sharpe.txt` 获取当前最优夏普比率。
