@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File make_shortcut.ps1
echo.
echo Done. Look for "Clan Organizer" on your Desktop.
pause
