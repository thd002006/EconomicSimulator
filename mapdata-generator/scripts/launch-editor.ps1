#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$GeneratorRoot = Split-Path -Parent $PSScriptRoot
Set-Location $GeneratorRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host ">> $Message" -ForegroundColor Cyan
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 24 或更高版本: https://nodejs.org/" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

$pnpmCmd = "npm exec --yes --package=pnpm@11.19.0 -- pnpm"

if (-not (Test-Path "node_modules")) {
    Write-Step "首次运行，正在安装依赖（只需一次）..."
    Invoke-Expression "$pnpmCmd install"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 依赖安装失败。" -ForegroundColor Red
        Read-Host "按 Enter 退出"
        exit 1
    }
}

$Port = 5177
Write-Step "正在启动地图编辑器..."
Write-Host "地址: http://127.0.0.1:$Port/"
Write-Host "关闭此窗口即可停止编辑器。"
Write-Host ""

$browserJob = Start-Job -ScriptBlock {
    param($Port)
    function Test-PortOpen([int]$Port) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $client.Connect("127.0.0.1", $Port)
            $client.Close()
            return $true
        } catch {
            return $false
        }
    }
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortOpen $Port) {
            Start-Process "http://127.0.0.1:$Port/"
            return
        }
        Start-Sleep -Milliseconds 500
    }
} -ArgumentList $Port

try {
    Invoke-Expression "$pnpmCmd editor"
} finally {
    if ($browserJob.State -eq "Running") {
        Stop-Job $browserJob -ErrorAction SilentlyContinue
    }
    Remove-Job $browserJob -Force -ErrorAction SilentlyContinue
}
