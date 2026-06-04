@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto failed
)

echo Starting app...
call npm run dev
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Failed to start. Please check the messages above.
pause
exit /b 1
