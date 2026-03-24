# Copies built APK to frontend/public/downloads/android/Pingy_{version}.apk
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Rel = Join-Path $Root "android\app\build\outputs\apk\release\app-release.apk"
$Dbg = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $Rel) { $Src = $Rel }
elseif (Test-Path $Dbg) { $Src = $Dbg }
else {
    Write-Error "No release/debug APK found. Build first: scripts\build-android.ps1 or android\gradlew.bat assembleDebug"
}
$Pkg = Get-Content (Join-Path $Root "frontend\package.json") -Raw | ConvertFrom-Json
$Ver = $Pkg.version -replace '\.', '_'
$DestDir = Join-Path $Root "frontend\public\downloads\android"
$Dest = Join-Path $DestDir "Pingy_$Ver.apk"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
Copy-Item $Src $Dest -Force
Write-Host "Copied to: $Dest"
Write-Host "Next: cd frontend; npm run build; deploy static assets"
