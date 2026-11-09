@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-tests.ps1"
set "test_exit=%errorlevel%"
echo.
pause
exit /b %test_exit%
