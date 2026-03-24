# Windows desktop installer (Tauri NSIS) -> frontend/public/downloads/desktop/Pingy-setup.exe
#
# If Rust fails with: "Application Control policy has blocked this file (os error 4551)",
# Windows is blocking Cargo build-script executables. Mitigations:
# - Settings -> Privacy & security -> Windows Security -> App & browser control ->
#   Smart App Control: Off (or use Evaluation mode), OR
# - Add exclusions for: %LOCALAPPDATA%\PingyTauriTarget and the repo's frontend\src-tauri
#
# Native tools (node/npx/tauri) write progress to stderr; "Stop" can surface that as terminating errors in PS 5.x.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
    $env:Path = "$cargoBin;$env:Path"
}
# Avoid proc-macro race (yoke / yoke-derive) on parallel cargo builds on Windows MSVC.
$env:CARGO_BUILD_JOBS = "1"

# Keep Cargo "target" outside the repo to reduce AV / WDAC locking on node_modules and build scripts.
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "PingyTauriTarget"
New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null

Set-Location $Frontend
# Same API host as web; Tauri cannot use relative /api (page origin is tauri.localhost).
$env:VITE_CLIENT_TYPE = "desktop"
if (-not $env:VITE_APP_URL) { $env:VITE_APP_URL = "https://web.pingychat.com" }

npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Warning "npm ci failed (exit $LASTEXITCODE), trying npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$tauriOut = & npx tauri build 2>&1
$tauriExit = $LASTEXITCODE
$tauriText = ($tauriOut | Out-String)
if ($tauriExit -ne 0) {
    Write-Host $tauriText
    if ($tauriText -match "4551|Application Control") {
        Write-Host ""
        Write-Host "=== Error 4551: Windows blocked Cargo build-script (.exe in build folder) ===" -ForegroundColor Yellow
        Write-Host "Do one or more of the following, then run this script again:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "A) Windows Security -> Virus & threat protection -> Manage settings -> Exclusions"
        Write-Host "   Add folder: $env:LOCALAPPDATA\PingyTauriTarget"
        Write-Host "   Add folder: $env:USERPROFILE\.cargo"
        Write-Host ""
        Write-Host "B) Windows Security -> App & browser control -> Smart App Control -> Off"
        Write-Host "   (or Evaluation mode while developing)."
        Write-Host ""
        Write-Host "C) Admin PowerShell (optional, adds Defender exclusions only):"
        Write-Host "   Add-MpPreference -ExclusionPath `"$env:LOCALAPPDATA\PingyTauriTarget`""
        Write-Host "   Add-MpPreference -ExclusionPath `"$env:USERPROFILE\.cargo`""
        Write-Host ""
    }
    exit $tauriExit
}

$NsisDir = Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis"
if (-not (Test-Path $NsisDir)) {
    Write-Error "NSIS bundle directory not found: $NsisDir"
    exit 1
}
$Installer = Get-ChildItem -Path $NsisDir -Filter "*.exe" | Select-Object -First 1
if (-not $Installer) {
    Write-Error "No NSIS installer .exe in $NsisDir"
    exit 1
}

$DestDir = Join-Path $Root "frontend\public\downloads\desktop"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "Pingy-setup.exe"
Copy-Item $Installer.FullName $Dest -Force
Write-Host "Installer copied: $Dest"
Write-Host "Next: cd frontend; npm run build; deploy static assets"
