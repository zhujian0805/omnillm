#!/usr/bin/env bash

# UI Test Runner for Open LLM Proxy
#
# This script helps run the UI tests for the Provider Management functionality
#
# Usage:
#   ./run-ui-tests.sh                    # Run all UI tests
#   ./run-ui-tests.sh --basic           # Run only basic provider tests
#   ./run-ui-tests.sh --workflows       # Run only workflow tests
#   ./run-ui-tests.sh --help            # Show help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_help() {
    echo "UI Test Runner for Open LLM Proxy"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --basic      Run only basic provider management tests"
    echo "  --workflows  Run only workflow tests"
    echo "  --help       Show this help message"
    echo ""
    echo "UI tests start their own isolated proxy server automatically."
}

run_tests() {
    local test_type="$1"

    case "$test_type" in
        "basic")
            echo -e "${BLUE}Running basic provider management tests...${NC}"
            cd "$SCRIPT_DIR"
            bun test tests/provider-management-ui.test.ts
            ;;
        "workflows")
            echo -e "${BLUE}Running workflow tests...${NC}"
            cd "$SCRIPT_DIR"
            bun test tests/provider-ui-workflows.test.ts
            ;;
        "all"|*)
            echo -e "${BLUE}Running all UI tests...${NC}"
            cd "$SCRIPT_DIR"
            bun test tests/provider-management-ui.test.ts
            echo ""
            bun test tests/provider-ui-workflows.test.ts
            ;;
    esac
}

cleanup() {
    echo -e "${YELLOW}Cleaning up test data...${NC}"
    # The tests have their own cleanup, but we can add global cleanup here if needed
}

# Trap cleanup on exit
trap cleanup EXIT

# Parse arguments
TEST_TYPE="all"
while [[ $# -gt 0 ]]; do
    case $1 in
        --basic)
            TEST_TYPE="basic"
            shift
            ;;
        --workflows)
            TEST_TYPE="workflows"
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo "================================================="
echo "  UI Test Runner for Open LLM Proxy"
echo "================================================="
echo "Test Type: $TEST_TYPE"
echo "Server Mode: isolated temporary instance"
echo "================================================="
echo ""

# Run tests
if run_tests "$TEST_TYPE"; then
    echo ""
    echo -e "${GREEN}✓ All tests completed successfully!${NC}"
else
    echo ""
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
