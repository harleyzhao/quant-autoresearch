@echo off
set ANTHROPIC_API_KEY=YOUR_API_KEY_HERE
set PYTHONUNBUFFERED=1
cd C:\Users\root.harleyhomePC\cuda-2
C:\Users\root.harleyhomePC\miniconda3\envs\quant\python.exe -u -W ignore autoresearch/autorun.py stock_selection
