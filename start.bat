@echo off
echo ================================================
echo Super LLM Proxy Server
echo ================================================
echo.

if not exist node_modules (
    echo Installing dependencies...
    bun install
    echo.
)

echo Starting server...
echo.

bun run dev

pause
