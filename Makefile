# OmniLLM Makefile
# Wraps common development and build operations.
#
# Windows Note: If 'make' is not in your PATH, add it:
#   set PATH=C:\Program Files (x86)\GnuWin32\bin;%PATH%
# Or install via: winget install GnuWin32.Make

# ── Configuration ─────────────────────────────────────────────────────────────

SERVER_PORT   ?= 5002
FRONTEND_PORT ?= 5080
HOST          ?= 127.0.0.1
REBUILD       ?=

GO            := go
BUN           := bun

INSTALL_DIR   := $(HOME)/.local/bin
BUILD_DIR     := .build/bin

ifeq ($(OS),Windows_NT)
  EXE         := .exe
  INSTALL_DIR := $(USERPROFILE)/.local/bin
else
  EXE         :=
endif

OMNILLM_BIN   := $(INSTALL_DIR)/omnillm$(EXE)
OMNIPROXY_BIN := $(INSTALL_DIR)/omniproxy$(EXE)

# ── Phony targets ─────────────────────────────────────────────────────────────

.PHONY: all install build build-go build-frontend build-all \
        start stop restart restart-rebuild status logs logs-follow \
        dev dev-frontend \
        test test-frontend lint typecheck \
        release-patch release-minor release-major \
        docker-build docker-run \
        help

# ── Default ───────────────────────────────────────────────────────────────────

all: help

# ── Install ───────────────────────────────────────────────────────────────────

## install: Build all Go binaries and install to ~/.local/bin
install:
	@if not exist "$(INSTALL_DIR)" mkdir "$(INSTALL_DIR)"
	$(GO) build -o "$(OMNILLM_BIN)" .
	$(GO) build -o "$(OMNIPROXY_BIN)" ./cmd/omniproxy
	@echo Installed omnillm$(EXE) to $(OMNILLM_BIN)
	@echo Installed omniproxy$(EXE) to $(OMNIPROXY_BIN)

## build: Build the Go backend binary and install to ~/.local/bin
build: build-go

## build-go: Compile the Go backend and install to ~/.local/bin
build-go:
	@if not exist "$(INSTALL_DIR)" mkdir "$(INSTALL_DIR)"
	$(GO) build -o "$(OMNILLM_BIN)" .
	@echo Built omnillm$(EXE) to $(OMNILLM_BIN)

## build-frontend: Build the frontend assets (outputs to pages/)
build-frontend:
	$(BUN) run build

## build-all: Build both the Go backend and the frontend assets
build-all: build-go build-frontend

# ── Dev / Start ───────────────────────────────────────────────────────────────

## start: Build the Go backend and start all services in the background
start:
	$(BUN) run omni start \
	  --server-port $(SERVER_PORT) \
	  --frontend-port $(FRONTEND_PORT) \
	  --host $(HOST)

## stop: Stop all background services
stop:
	$(BUN) run omni stop

## restart: Restart background services (no rebuild)
restart:
	$(BUN) run omni restart $(REBUILD) \
	  --server-port $(SERVER_PORT) \
	  --frontend-port $(FRONTEND_PORT) \
	  --host $(HOST)

## restart-rebuild: Rebuild everything and restart background services
restart-rebuild:
	$(BUN) run omni restart --rebuild \
	  --server-port $(SERVER_PORT) \
	  --frontend-port $(FRONTEND_PORT) \
	  --host $(HOST)

## status: Show running service status and ports
status:
	$(BUN) run omni status

## logs: Print the last 50 lines of service logs
logs:
	$(BUN) run omni logs

## logs-follow: Stream service logs in real time
logs-follow:
	$(BUN) run omni logs --follow

## dev: Start both backend and frontend in the foreground (Ctrl+C to stop)
dev:
	$(BUN) run dev \
	  --server-port $(SERVER_PORT) \
	  --frontend-port $(FRONTEND_PORT) \
	  --host $(HOST)

## dev-frontend: Start only the Vite frontend dev server
dev-frontend:
	$(BUN) run dev:frontend

# ── Test ──────────────────────────────────────────────────────────────────────

## test: Run the full test suite
test:
	$(BUN) run test

## test-frontend: Run frontend tests only
test-frontend:
	$(BUN) run test:frontend

# ── Code Quality ──────────────────────────────────────────────────────────────

## lint: Run ESLint on changed files
lint:
	$(BUN) run lint

## typecheck: Run TypeScript type checking on the frontend
typecheck:
	$(BUN) run typecheck

# ── Release ───────────────────────────────────────────────────────────────────

## release-patch: Bump patch version, commit, tag, and push
release-patch:
	$(BUN) run scripts/release.ts patch

## release-minor: Bump minor version, commit, tag, and push
release-minor:
	$(BUN) run scripts/release.ts minor

## release-major: Bump major version, commit, tag, and push
release-major:
	$(BUN) run scripts/release.ts major

# ── Docker ────────────────────────────────────────────────────────────────────

## docker-build: Build the Docker image tagged as omnillm
docker-build:
	docker build -t omnillm .

## docker-run: Run the Docker image on port 5002
docker-run:
	docker run -p $(SERVER_PORT):5002 omnillm

# ── Help ──────────────────────────────────────────────────────────────────────

## help: List all available targets with descriptions
help:
	@echo ""
	@echo "Usage:   make <target> [VARIABLE=value ...]"
	@echo ""
	@echo "Variables:"
	@echo "  SERVER_PORT=5002        Backend API port (default: 5002)"
	@echo "  FRONTEND_PORT=5080      Frontend dev server port (default: 5080)"
	@echo "  HOST=127.0.0.1          Bind address (default: 127.0.0.1)"
	@echo "  REBUILD=--rebuild       Add --rebuild flag to restart target"
	@echo ""
	@echo "Examples:"
	@echo "  make start"
	@echo "  make restart HOST=localhost"
	@echo "  make restart SERVER_PORT=5000 FRONTEND_PORT=5080 HOST=localhost"
	@echo "  make restart REBUILD=--rebuild"
	@echo ""
	@echo "Targets:"
	@echo "  install         - Build all Go binaries and install to ~/.local/bin"
	@echo "  build           - Build the Go backend binary and install to ~/.local/bin"
	@echo "  build-go        - Compile the Go backend and install to ~/.local/bin"
	@echo "  build-frontend  - Build the frontend assets (outputs to pages/)"
	@echo "  build-all       - Build both the Go backend and the frontend assets"
	@echo "  start           - Build the Go backend and start all services in the background"
	@echo "  stop            - Stop all background services"
	@echo "  restart         - Restart background services (no rebuild)"
	@echo "  restart-rebuild - Rebuild everything and restart background services"
	@echo "  status          - Show running service status and ports"
	@echo "  logs            - Print the last 50 lines of service logs"
	@echo "  logs-follow     - Stream service logs in real time"
	@echo "  dev             - Start both backend and frontend in the foreground"
	@echo "  dev-frontend    - Start only the Vite frontend dev server"
	@echo "  test            - Run the full test suite"
	@echo "  test-frontend   - Run frontend tests only"
	@echo "  lint            - Run ESLint on changed files"
	@echo "  typecheck       - Run TypeScript type checking on the frontend"
	@echo "  release-patch   - Bump patch version, commit, tag, and push"
	@echo "  release-minor   - Bump minor version, commit, tag, and push"
	@echo "  release-major   - Bump major version, commit, tag, and push"
	@echo "  docker-build    - Build the Docker image tagged as omnillm"
	@echo "  docker-run      - Run the Docker image on port 5002"
	@echo ""
