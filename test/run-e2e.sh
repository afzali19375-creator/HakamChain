#!/usr/bin/env bash
# HakamChain — full local E2E run:
#   local Hardhat chain → deploy → API server → E2E suite → cleanup
set -u
cd "$(dirname "$0")/.." || exit 1

rm -f data/e2e-test.sqlite

echo "[1/5] Starting local Hardhat chain (chainId 31337)…"
npx hardhat node > /tmp/hh-node.log 2>&1 &
HH_PID=$!
for _ in $(seq 1 60); do
  if curl -s --max-time 2 -X POST http://127.0.0.1:8545 \
       -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo "      chain is up."

echo "[2/5] Deploying IslamicEscrow…"
if ! npx hardhat run scripts/deploy.js --network localhost > /tmp/deploy.log 2>&1; then
  echo "      DEPLOY FAILED:"; tail -20 /tmp/deploy.log
  kill $HH_PID 2>/dev/null
  exit 1
fi
ADDR=$(node -e "console.log(require('./deployments/localhost.json').address)")
echo "      contract at $ADDR"

echo "[3/5] Pointing .env at the local deployment…"
sed -i '/^CONTRACT_ADDRESS=/d' .env
echo "CONTRACT_ADDRESS=$ADDR" >> .env

echo "[4/5] Starting API server on :3000…"
node src/server.js > /tmp/server.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 30); do
  if curl -s --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -s --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "      SERVER FAILED:"; tail -20 /tmp/server.log
  kill $SRV_PID $HH_PID 2>/dev/null
  exit 1
fi
echo "      server is up."

echo "[5/5] Running the E2E suite…"
node test/e2e.local.js
RESULT=$?

kill $SRV_PID $HH_PID 2>/dev/null
wait $SRV_PID 2>/dev/null
echo
if [ $RESULT -eq 0 ]; then echo "✅ E2E PASSED"; else echo "❌ E2E FAILED — see output above (server log: /tmp/server.log)"; fi
exit $RESULT
