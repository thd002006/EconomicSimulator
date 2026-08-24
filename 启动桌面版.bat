@echo off
chcp 65001 >nul
title Economic Simulator - Desktop
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 24+：https://nodejs.org/
  pause
  exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Rust/Cargo。桌面版需要安装 Rust：https://rustup.rs/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 首次运行，正在安装依赖...
  call npm exec --yes --package=pnpm@11.19.0 -- pnpm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
)

echo.
echo 正在启动桌面客户端...
echo 关闭此窗口即可退出。
echo.

npm exec --yes --package=pnpm@11.19.0 -- pnpm tauri:dev
pause
