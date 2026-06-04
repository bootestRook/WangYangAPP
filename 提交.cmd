@echo off
setlocal
cd /d "%~dp0"

set "REMOTE_URL=https://github.com/bootestRook/WangYangAPP.git"
set "BRANCH=main"
set "MESSAGE=%~1"
if "%MESSAGE%"=="" set "MESSAGE=Initial commit"

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git is not installed or not in PATH.
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  git init
  if errorlevel 1 exit /b 1
)

git lfs install
if errorlevel 1 exit /b 1

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)
if errorlevel 1 exit /b 1

git branch -M %BRANCH%
if errorlevel 1 exit /b 1

git add -A
if errorlevel 1 exit /b 1

git diff --cached --quiet
if not errorlevel 1 (
  echo No staged changes to commit.
  exit /b 0
)

git commit -m "%MESSAGE%"
exit /b %ERRORLEVEL%
