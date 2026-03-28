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
