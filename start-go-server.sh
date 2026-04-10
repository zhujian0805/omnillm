#!/bin/bash
# Comprehensive OmniModel Development Launcher
# Start both Golang backend and frontend development servers

echo "🚀 Starting OmniModel Development Environment with Golang Backend"
echo ""
echo "Services will be available at:"
echo "  🔥 Golang Backend: http://localhost:5002"
echo "  🌐 Frontend: http://localhost:5080"
echo "  📱 Admin UI: http://localhost:5080/admin/"
echo ""

# Set Go path
export PATH="/c/Program Files/Go/bin:$PATH"
BINARY_PATH="$HOME/.local/bin/omnimodel"

# Build Go backend if it doesn't exist or is outdated
if [ ! -f "$BINARY_PATH" ] || [ main.go -nt "$BINARY_PATH" ]; then
    echo "🔨 Building Golang backend to ~/.local/bin..."
    mkdir -p ~/.local/bin
    go build -o "$BINARY_PATH" main.go
    if [ $? -ne 0 ]; then
        echo "❌ Failed to build Go backend"
        exit 1
    fi
    echo "✅ Go backend built successfully at $BINARY_PATH"
fi

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Please install Bun first: https://bun.sh"
    exit 1
fi

echo "🚀 Starting development environment..."
echo "📝 Press Ctrl+C to stop both servers"
echo ""

# Start both frontend and backend
exec bun run dev:go