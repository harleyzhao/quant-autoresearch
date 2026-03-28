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
    print("整体评估脚本 - 合并选股和择时最优结果")
    # TODO: 加载两个循环各自的最优模型，合成评估
