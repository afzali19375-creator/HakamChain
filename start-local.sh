#!/usr/bin/env bash
# HakamChain — one-command local runner (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo "[1/4] Stopping leftovers from previous runs..."
pkill -f "hardhat node" 2>/dev/null || true
(lsof -ti:3000 2>/dev/null || true) | xargs -r kill -9 2>/dev/null || true

if [ ! -d node_modules ]; then
  echo "[2/4] Installing dependencies (2-5 minutes)..."
  npm install
else
  echo "[2/4] Dependencies already installed."
fi

echo "[3/4] Starting local blockchain..."
npx hardhat node > /tmp/hakamchain-node.log 2>&1 &
CHAIN_PID=$!
trap 'kill $CHAIN_PID 2>/dev/null || true' EXIT
sleep 6

echo "[4/4] Deploying contract and syncing .env..."
npx hardhat run scripts/deploy.js --network localhost

echo ""
echo "=================================================="
echo "  DONE! Open your browser at:  http://localhost:3000"
echo "  Stop with Ctrl+C (the blockchain stops too)."
echo "=================================================="
npm start
