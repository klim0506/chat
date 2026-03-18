# Run backend (Django) and/or frontend unit (Vitest) tests.
# E2E (Playwright) requires dev server running; run separately: cd frontend && npm run test:e2e
# Usage: .\run-all-tests.ps1 [-BackendOnly] [-FrontendOnly]

param([switch]$BackendOnly, [switch]$FrontendOnly)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$runBackend = -not $FrontendOnly
$runFrontend = -not $BackendOnly

if ($runBackend) {
    Write-Host "=== Backend (Django) tests ===" -ForegroundColor Cyan
    $backendDir = Join-Path $root "backend"
    $env:USE_SQLITE = "1"
    $python = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) { $python = "python" }
    Push-Location $backendDir
    try {
        & $python manage.py test
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

if ($runFrontend) {
    Write-Host "`n=== Frontend unit (Vitest) tests ===" -ForegroundColor Cyan
    $frontendDir = Join-Path $root "frontend"
    Push-Location $frontendDir
    try {
        npm run test:unit
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

Write-Host "`nAll tests passed." -ForegroundColor Green
