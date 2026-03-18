# Kill processes on dev ports 8000 and 5173
$ports = @(8000, 5173)
foreach ($port in $ports) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($conn) {
    $pid = $conn.OwningProcess | Select-Object -First 1
    Write-Host "Stopping process $pid on port $port"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
