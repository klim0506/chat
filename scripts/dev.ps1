# Dev script: kill stuck processes, start backend, wait for health, start frontend
# Run from chat-dev root: .\scripts\dev.ps1

$ErrorActionPreference = "Stop"
$BackendPort = 8000
$FrontendPort = 5173

$BackendDir = "$PSScriptRoot\..\backend"
$FrontendDir = "$PSScriptRoot\..\frontend"

function Stop-PortProcess {
  param([int]$Port)
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($conn) {
    $pid = $conn.OwningProcess | Select-Object -First 1
    Write-Host "Stopping process $pid on port $Port..."
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Wait-ForBackend {
  $maxAttempts = 30
  $attempt = 0
  while ($attempt -lt $maxAttempts) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/health/" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    $attempt++
    Write-Host "Waiting for backend... ($attempt/$maxAttempts)"
    Start-Sleep -Seconds 1
  }
  return $false
}

Write-Host "=== PingyChat Dev ===" -ForegroundColor Cyan

# Stop existing processes
Stop-PortProcess -Port $BackendPort
Stop-PortProcess -Port $FrontendPort

# Start backend
Write-Host "`nStarting backend...`n" -ForegroundColor Green
$pythonExe = "python"
if (Test-Path "$BackendDir\.venv\Scripts\python.exe") { $pythonExe = "$BackendDir\.venv\Scripts\python.exe" }
elseif (Test-Path "$BackendDir\.venv\bin\python") { $pythonExe = "$BackendDir\.venv\bin\python" }
elseif (Test-Path "$BackendDir\.venv\bin\python3") { $pythonExe = "$BackendDir\.venv\bin\python3" }
$backendProc = Start-Process -FilePath $pythonExe -ArgumentList "manage.py", "runserver", "127.0.0.1:8000" -WorkingDirectory $BackendDir -PassThru -WindowStyle Hidden

if (-not (Wait-ForBackend)) {
  Write-Host "Backend failed to start. Ensure PostgreSQL is running and run manually:" -ForegroundColor Yellow
  Write-Host "  cd backend && .venv\Scripts\Activate.ps1; python manage.py runserver 127.0.0.1:8000" -ForegroundColor Gray
  Write-Host "`nStarting frontend anyway (API will be unavailable).`n" -ForegroundColor Yellow
  Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "Backend ready.`n" -ForegroundColor Green
}

# Start frontend (foreground)
Write-Host "Starting frontend...`n" -ForegroundColor Green
Push-Location $FrontendDir
try {
  npm run dev
} finally {
  if ($backendProc -and (Get-Process -Id $backendProc.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
