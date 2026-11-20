@echo off
setlocal
cd /d "%~dp0"

set REPO_URL=https://github.com/Wayzz01/Aelcis-v3.git

echo ==========================================
echo  Uploading this folder to %REPO_URL%
echo  Folder: %CD%
echo ==========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo Git is not installed. Installing it now, click Yes if Windows asks.
    where winget >nul 2>&1
    if errorlevel 1 (
        echo winget was not found. Opening the Git download page instead.
        echo Install Git there, then run this file again.
        start https://git-scm.com/download/win
        pause
        exit /b 1
    )
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    set "PATH=%PATH%;C:\Program Files\Git\cmd"
    where git >nul 2>&1
    if errorlevel 1 (
        echo Git was installed but is not visible yet. Close this window and run the file again.
        pause
        exit /b 1
    )
)

REM Create a .gitignore if there isn't one, so secrets and junk stay out
if not exist .gitignore (
    echo Creating .gitignore...
    echo node_modules/>> .gitignore
    echo .env>> .gitignore
    echo .env.*>> .gitignore
    echo __pycache__/>> .gitignore
    echo venv/>> .gitignore
    echo .venv/>> .gitignore
    echo *.log>> .gitignore
    echo .DS_Store>> .gitignore
)

REM Git needs a name and email to create a commit (one time only)
set "GIT_EMAIL="
for /f "delims=" %%i in ('git config --global user.email 2^>nul') do set "GIT_EMAIL=%%i"
if defined GIT_EMAIL goto have_identity
echo.
echo Git needs to know who you are, this is asked only once.
set /p GIT_EMAIL=Enter your GitHub email: 
set /p GIT_NAME=Enter your name: 
git config --global user.email "%GIT_EMAIL%"
git config --global user.name "%GIT_NAME%"
:have_identity

git init
git add .
git commit -m "Initial commit"

REM Stop here if there is still no commit, otherwise nothing would be uploaded
git rev-parse HEAD >nul 2>&1
if errorlevel 1 (
    echo.
    echo The commit failed, so there is nothing to upload. Check the messages above.
    pause
    exit /b 1
)

git branch -M main

REM Set the remote (replace it if it already exists)
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo.
echo Pushing to GitHub... (a login window may pop up, sign in there)
git push -u origin main

if errorlevel 1 (
    echo.
    echo Push was rejected. The repo probably already has files, like a README.
    echo Merging them in and trying again...
    git pull origin main --allow-unrelated-histories --no-edit
    git push -u origin main
)

echo.
if errorlevel 1 (
    echo Something went wrong. Check the messages above.
) else (
    echo Done! Check https://github.com/Wayzz01/Aelcis-v3
)
pause
