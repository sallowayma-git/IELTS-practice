@echo off
echo Running Integration Tests...
echo.

echo Test 1: Multi-Suite Submission Flow
node developer\tests\js\integration\multiSuiteSubmission.test.js
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Multi-Suite Submission Test
    exit /b 1
)
echo.

echo Test 2: Spelling Error Collection Flow
node developer\tests\js\integration\spellingErrorCollection.test.js
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Spelling Error Collection Test
    exit /b 1
)
echo.

echo Test 3: Vocab List Switching Flow
node developer\tests\js\integration\vocabListSwitching.test.js
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: Vocab List Switching Test
    exit /b 1
)
echo.

echo All integration tests passed!
echo.

echo Running Performance Benchmarks...
echo.
node developer\tests\js\integration\performance.benchmark.js
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Performance benchmark failed
    echo Continuing anyway...
)
echo.

echo All tests completed!
exit /b 0
