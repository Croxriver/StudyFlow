@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%" || exit /b 1

echo Building dist-iis...
call npm run build:iis
set "BUILD_RESULT=%ERRORLEVEL%"

popd

if not "%BUILD_RESULT%"=="0" (
  echo.
  echo dist-iis build failed.
  pause
  exit /b %BUILD_RESULT%
)

echo.
echo dist-iis build completed.
pause
