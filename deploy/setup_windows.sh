#!/bin/bash
# Windows 环境一键配置（通过 SSH 执行）
pip install -r requirements-gpu.txt
python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
npm install -g @anthropic-ai/claude-code
cd ~/cuda-2 && git init
echo "环境配置完成"
