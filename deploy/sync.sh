#!/bin/bash
# Mac→Windows 代码同步
REMOTE_USER=${REMOTE_USER:-user}
REMOTE_HOST=${REMOTE_HOST:-windows-ip}
REMOTE_DIR=${REMOTE_DIR:-~/cuda-2}

rsync -avz --exclude='data/cache' --exclude='.venv' --exclude='__pycache__' \
  --exclude='.git' \
  ./ ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/
echo "同步完成"
