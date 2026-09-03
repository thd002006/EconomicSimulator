@echo off
title Province Pic Generator - %DATE% %TIME%
cd /d "%~dp0"
set /p BATCH_COUNT=Enter batch count (default 200): 
if not defined BATCH_COUNT set BATCH_COUNT=200
set BATCH_COUNT=%BATCH_COUNT%
python scripts\generate-province-pics.py
echo.
echo ============================
echo Batch complete. Press any key to exit...
pause >nul
