@echo off
set PYTHONUNBUFFERED=1
cd C:\Users\root.harleyhomePC\cuda-2\autoresearch

:loop
echo [%date% %time%] Starting Optuna timing optimization...
C:\Users\root.harleyhomePC\miniconda3\envs\quant\python.exe -u -W ignore optuna_timing.py
echo [%date% %time%] Process exited, restarting in 5 seconds...
timeout /t 5 >nul
goto loop
