#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Decky Streamer Release Builder ===${NC}"

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo -e "${YELLOW}Building version: ${VERSION}${NC}"

# Step 1: Build backend (GStreamer libraries)
echo -e "\n${GREEN}[1/4] Building backend (GStreamer libraries)...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
    exit 1
fi

cd backend
docker build -t decky-streamer-backend .
docker run --rm -v "$(pwd)":/backend -v "$(pwd)/out":/backend/out --entrypoint /backend/entrypoint.sh decky-streamer-backend
cd "$SCRIPT_DIR"
echo -e "${GREEN}Backend build complete!${NC}"

# Step 2: Install dependencies
echo -e "\n${GREEN}[2/4] Installing dependencies...${NC}"
if command -v pnpm &> /dev/null; then
    pnpm install
elif command -v npm &> /dev/null; then
    npm install
else
    echo -e "${RED}Error: Neither pnpm nor npm found${NC}"
    exit 1
fi

# Step 3: Build frontend
echo -e "\n${GREEN}[3/4] Building frontend...${NC}"
if command -v pnpm &> /dev/null; then
    pnpm run build
else
    npm run build
fi
echo -e "${GREEN}Frontend build complete!${NC}"

# Step 4: Package plugin
echo -e "\n${GREEN}[4/4] Packaging plugin...${NC}"
rm -rf tmp/
mkdir -p tmp/decky-streamer

cp -r dist tmp/decky-streamer/
cp -r backend/out tmp/decky-streamer/bin
cp main.py settings.py plugin.json package.json tmp/decky-streamer/

cd tmp
zip -r ../decky-streamer.zip decky-streamer
cd "$SCRIPT_DIR"

# Clean up
rm -rf tmp/

# Show result
ZIP_SIZE=$(du -h decky-streamer.zip | cut -f1)
echo -e "\n${GREEN}=== Build Complete! ===${NC}"
echo -e "Output: ${YELLOW}decky-streamer.zip${NC} (${ZIP_SIZE})"
echo -e "Version: ${YELLOW}${VERSION}${NC}"
echo -e "\nTo install on Steam Deck:"
echo "  1. Copy decky-streamer.zip to your Steam Deck"
echo "  2. Extract and copy the 'decky-streamer' folder to ~/homebrew/plugins/"
echo "  3. Restart Decky Loader or reboot"
