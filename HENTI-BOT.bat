@echo off
cd /d "%~dp0"
if not exist standalone.lock (echo Bot tidak berjalan.& pause & exit /b)
for /f %%p in (standalone.lock) do taskkill /PID %%p /T /F
echo Bot sudah dihentikan.
pause
