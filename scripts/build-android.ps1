# Сборка debug APK на Windows. Нужны JDK 17+ и Android SDK; задайте ANDROID_HOME.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    Write-Error "Задайте переменную окружения ANDROID_HOME (путь к Android SDK)."
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }

Set-Location (Join-Path $Root "android")
& .\gradlew.bat assembleDebug --no-daemon
Write-Host ""
Write-Host "Готово: android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host "Скопировать для сайта: .\scripts\copy-android-apk-to-public.ps1"
