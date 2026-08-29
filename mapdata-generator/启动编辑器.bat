@echo off
chcp 65001 >nul
title Economic Simulator - Map Editor
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-editor.ps1"
if errorlevel 1 pause
