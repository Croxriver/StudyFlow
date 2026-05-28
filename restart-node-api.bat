@echo off
setlocal

set "APP_DIR=%~dp0"
set "OUT_LOG=%APP_DIR%server.log"
set "ERR_LOG=%APP_DIR%server-error.log"
set "HEALTH_URL=http://127.0.0.1:5188/api/health"

echo Stopping StudyFlow Node API...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'server[/\\]index\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

timeout /t 1 /nobreak >nul

echo Starting StudyFlow Node API...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory '%APP_DIR%' -RedirectStandardOutput '%OUT_LOG%' -RedirectStandardError '%ERR_LOG%' -WindowStyle Hidden"

timeout /t 2 /nobreak >nul

echo Checking API health...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 5).Content; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }"

if errorlevel 1 (
  echo.
  echo API health check failed. See:
  echo %OUT_LOG%
  echo %ERR_LOG%
  exit /b 1
)

echo.
echo StudyFlow Node API restarted.
endlocal
