@echo off
echo Starting OmniModel with Golang backend + Frontend...
echo.
echo Backend (Go): http://localhost:5002
echo Frontend: http://localhost:5080
echo Admin UI: http://localhost:5080/admin/
echo.

REM Create local bin directory
if not exist "%USERPROFILE%\.local\bin" (
    mkdir "%USERPROFILE%\.local\bin"
)

REM Build the Go backend if it doesn't exist
set BINARY_PATH=%USERPROFILE%\.local\bin\omnimodel.exe
if not exist "%BINARY_PATH%" (
    echo Building Golang backend to %USERPROFILE%\.local\bin\...
    go build -o "%BINARY_PATH%" main.go
    if errorlevel 1 (
        echo Failed to build Go backend
        pause
        exit /b 1
    )
    echo Go backend built successfully
)

REM Start both services
echo Starting services...
bun run dev:go

pause