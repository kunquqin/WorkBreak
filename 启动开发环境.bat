@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting MeowBreak 喵息 dev...
echo.
npm run dev
pause
