@echo off
REM 运行所有单元测试
REM 用法: run-unit-tests.bat

echo ========================================
echo 运行 IELTS 练习系统单元测试
echo ========================================
echo.

set FAILED=0

echo [1/2] 运行 SpellingErrorCollector 测试...
echo ----------------------------------------
node js\spellingErrorCollector.test.js
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: SpellingErrorCollector 测试失败
    set FAILED=1
) else (
    echo PASSED: SpellingErrorCollector 测试通过
)
echo.

echo [2/2] 运行 BrowseController 测试...
echo ----------------------------------------
node js\browseController.test.js
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: BrowseController 测试失败
    set FAILED=1
) else (
    echo PASSED: BrowseController 测试通过
)
echo.

echo ========================================
if %FAILED% EQU 0 (
    echo 所有测试通过! ✅
    echo.
    echo 提示: 在浏览器中打开以下文件运行 VocabListSwitcher 测试:
    echo   developer/tests/vocabListSwitcher.test.html
    exit /b 0
) else (
    echo 部分测试失败! ❌
    exit /b 1
)
