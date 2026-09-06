@echo off
setlocal
REM Run the canonical JavaScript unit/regression entry from any working directory.
pushd "%~dp0.."
call npm test
set "TEST_EXIT=%ERRORLEVEL%"
popd
exit /b %TEST_EXIT%
