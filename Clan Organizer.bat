@echo off
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw launcher.pyw & exit /b)
where pythonw >nul 2>nul && (start "" pythonw launcher.pyw & exit /b)
echo.
echo Python was not found on this computer.
echo 1. Install it from https://www.python.org/downloads/
echo 2. On the first screen, tick "Add python.exe to PATH"
echo 3. Then double-click this file again.
echo.
pause
