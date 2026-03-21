# Сборка установщика Windows (Tauri NSIS) и копирование в public/downloads/desktop/Pingy-setup.exe
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"

Set-Location $Frontend
npm ci
npx tauri build

$NsisDir = Join-Path $Frontend "src-tauri\target\release\bundle\nsis"
if (-not (Test-Path $NsisDir)) {
    Write-Error "Каталог NSIS не найден: $NsisDir"
}
$Installer = Get-ChildItem -Path $NsisDir -Filter "*.exe" | Select-Object -First 1
if (-not $Installer) {
    Write-Error "В $NsisDir нет .exe установщика"
}

$DestDir = Join-Path $Root "frontend\public\downloads\desktop"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "Pingy-setup.exe"
Copy-Item $Installer.FullName $Dest -Force
Write-Host "Установщик скопирован: $Dest"
Write-Host "Далее: cd frontend; npm run build; деплой статики"
