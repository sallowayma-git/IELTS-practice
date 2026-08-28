@echo off
echo Running Integration Tests...
echo.

echo Test 1: Spelling Error Collection Flow
node "%~dp0js\integration\spellingErrorCollection.test.js"
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Spelling Error Collection Test
    exit /b 1
)
echo.

echo Test 2: Vocab List Switching Flow
node "%~dp0js\integration\vocabListSwitching.test.js"
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Vocab List Switching Test
    exit /b 1
)
echo.

echo Test 3: Vocab Session View Flow
node "%~dp0js\integration\vocabSessionView.test.js"
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Vocab Session View Test
    exit /b 1
)
echo.

echo All integration tests passed!
exit /b 0
