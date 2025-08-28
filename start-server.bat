@echo off
echo 正在启动考试总览系统...
echo.
echo 请选择启动方式:
echo 1. Python HTTP服务器 (推荐)
echo 2. Node.js HTTP服务器
echo 3. 直接在浏览器中打开
echo.
set /p choice=请输入选择 (1-3): 

if "%choice%"=="1" (
    echo 启动Python HTTP服务器...
    python -m http.server 8000
    if errorlevel 1 (
        echo Python 3未找到，尝试Python 2...
        python -m SimpleHTTPServer 8000
    )
) else if "%choice%"=="2" (
    echo 启动Node.js HTTP服务器...
    npx http-server -p 8000 -c-1
) else if "%choice%"=="3" (
    echo 在浏览器中打开...
    start index.html
) else (
    echo 无效选择，使用默认Python服务器...
    python -m http.server 8000
)

pause