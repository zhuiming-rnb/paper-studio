@echo off
setlocal
title Paper Studio Launcher
cd /d "E:\workplace\paper-studio"

echo [论文阅读站] 正在检查服务状态...

curl -s -o nul -m 2 http://127.0.0.1:3000/api/papers
if %errorlevel% equ 0 goto open

echo [论文阅读站] 服务未运行，正在启动（独立最小化窗口，关闭该窗口即停止服务）...
start "Paper Studio Server" /min cmd /k "cd /d E:\workplace\paper-studio && npm start"

set tries=0
:wait
timeout /t 1 /nobreak > nul
curl -s -o nul -m 2 http://127.0.0.1:3000/api/papers
if %errorlevel% equ 0 goto open
set /a tries+=1
if %tries% lss 30 goto wait

echo.
echo [论文阅读站] 启动失败：30 秒内服务未就绪。
echo 请到 E:\workplace\paper-studio 目录手动运行 npm start 查看报错。
pause
exit /b 1

:open
echo [论文阅读站] 服务已就绪，正在打开浏览器...
start "" "http://127.0.0.1:3000"
exit /b 0