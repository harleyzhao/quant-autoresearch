#!/bin/bash
# 择时 autoresearch 循环
# 用法: bash autoresearch/run_market_timing.sh

cd /Users/harleyzhao/cuda-2/autoresearch/market_timing

PROMPT=$(cat program.md)

echo "=== 择时 Autoresearch 循环启动 ==="
echo "当前最优夏普: $(cat best_sharpe.txt)"
echo "按 Ctrl+C 停止"
echo ""

ROUND=1
while true; do
    echo "===== 第 ${ROUND} 轮实验 ====="
    claude -p "${PROMPT}

当前最优夏普: $(cat best_sharpe.txt)
请进行一轮实验：分析当前 train.py，选择一个改进方向，修改代码，同步到 Windows 执行训练，根据结果决定 commit 或 revert。" \
        --dangerously-skip-permissions \
        --model sonnet \
        --allowedTools "Bash,Edit,Read,Write" \
        --no-session-persistence \
        2>&1

    echo ""
    echo "第 ${ROUND} 轮完成。当前最优夏普: $(cat best_sharpe.txt)"
    echo ""
    ROUND=$((ROUND + 1))
    sleep 2
done
