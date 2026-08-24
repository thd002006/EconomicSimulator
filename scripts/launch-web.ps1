#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host ">> $Message" -ForegroundColor Cyan
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 24 或更高版本: https://nodejs.org/" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

$nodeVersion = node -p "process.versions.node.split('.')[0]"
if ([int]$nodeVersion -lt 24) {
    Write-Host "[警告] 当前 Node.js 版本较低 (v$(node -v))，建议使用 v24 或更高版本。" -ForegroundColor Yellow
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

Write-Step "正在启动 Web 开发服务器..."
Write-Host "地址: http://127.0.0.1:1420/"
Write-Host "关闭此窗口即可停止服务器。"
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
} -ArgumentList 1420

try {
    Invoke-Expression "$pnpmCmd dev"
} finally {
    if ($browserJob.State -eq "Running") {
        Stop-Job $browserJob -ErrorAction SilentlyContinue
    }
    Remove-Job $browserJob -Force -ErrorAction SilentlyContinue
}
