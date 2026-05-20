@echo off
setlocal

set "ROOT=%~dp0"
set "ANDROID_DIR=%ROOT%android"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk"
set "APP_ID=kr.csid.studyflow"

if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
  set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)

set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  if exist "%LOCALAPPDATA%\nvm\v22.13.0\node.exe" (
    set "PATH=%LOCALAPPDATA%\nvm\v22.13.0;%PATH%"
  )
)

set "NODE_MAJOR=0"
for /f %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  echo NodeJS 22 or newer is required for Capacitor CLI.
  echo Current node:
  node -v
  echo.
  echo Install NodeJS 22 LTS or run: nvm use 22.13.0
  pause
  exit /b 1
)

set "ADB=adb"
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
) else if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
  set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
) else if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" (
  set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
)

echo [1/5] Syncing Capacitor Android project...
pushd "%ROOT%" || exit /b 1
call npx cap sync android
set "SYNC_RESULT=%ERRORLEVEL%"
popd

if not "%SYNC_RESULT%"=="0" (
  echo.
  echo Capacitor sync failed.
  pause
  exit /b %SYNC_RESULT%
)

echo.
echo [2/5] Building debug APK...
pushd "%ANDROID_DIR%" || exit /b 1
call gradlew.bat :app:assembleDebug
set "BUILD_RESULT=%ERRORLEVEL%"
popd

if not "%BUILD_RESULT%"=="0" (
  echo.
  echo APK build failed.
  pause
  exit /b %BUILD_RESULT%
)

if not exist "%APK_PATH%" (
  echo.
  echo Built APK was not found:
  echo %APK_PATH%
  pause
  exit /b 1
)

echo.
echo Built APK:
echo %APK_PATH%

echo.
echo [3/5] Checking connected Android device...
"%ADB%" devices
if errorlevel 1 (
  echo.
  echo adb was not found. Check Android SDK platform-tools or PATH.
  pause
  exit /b 1
)

echo.
echo [4/5] Installing debug APK...
"%ADB%" install -r "%APK_PATH%"
set "INSTALL_RESULT=%ERRORLEVEL%"

if not "%INSTALL_RESULT%"=="0" (
  echo.
  echo APK install failed. Check USB debugging permission on the phone.
  pause
  exit /b %INSTALL_RESULT%
)

echo.
echo [5/5] Launching StudyFlow...
"%ADB%" shell monkey -p %APP_ID% -c android.intent.category.LAUNCHER 1
if errorlevel 1 (
  echo.
  echo App launch failed.
  pause
  exit /b 1
)

echo.
echo Done.
pause
