@echo off
setlocal
cd /d "%~dp0"

set "REMOTE_URL=https://github.com/bootestRook/WangYangAPP.git"
set "BRANCH=main"

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git is not installed or not in PATH.
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo ERROR: this folder is not a git repository. Run git_commit.cmd first.
  exit /b 1
)

git lfs install
if errorlevel 1 exit /b 1

git config lfs.concurrenttransfers 1
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

git push -u origin %BRANCH%
exit /b %ERRORLEVEL%
