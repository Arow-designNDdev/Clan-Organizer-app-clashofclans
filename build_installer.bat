@echo off
cd /d "%~dp0"
echo Building Clan Organizer installer. This takes a few minutes the first time.
echo.
where python >nul 2>nul || (echo Python was not found. Install it from python.org and tick "Add python.exe to PATH". & pause & exit /b 1)
python -m pip install -r requirements.txt pyinstaller || (echo Could not install the build tools. & pause & exit /b 1)
python -m PyInstaller ClanOrganizer.spec --noconfirm || (echo Build failed. & pause & exit /b 1)

set ISCC=
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe
if "%ISCC%"=="" (
  echo.
  echo The app is built, but the installer maker is missing.
  echo Install the free "Inno Setup" from https://jrsoftware.org/isdl.php then run this file again.
  pause & exit /b 1
)
"%ISCC%" ClanOrganizer.iss || (echo Installer step failed. & pause & exit /b 1)
echo.
echo Done. Your installer is: installer\ClanOrganizer-Setup.exe
pause
