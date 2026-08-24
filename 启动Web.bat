@echo off
chcp 65001 >nul
title Economic Simulator - Web
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-web.ps1"
if errorlevel 1 pause
