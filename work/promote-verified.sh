#!/usr/bin/env bash
# Promote the 11 newly verified cases following the receipt-chain protocol:
# finalize manifest (verified + receipts + pinned verified_at) -> biome format
# -> regenerate build receipt -> rerun the real experiment with --verified-at
# -> write the final ledger into fixtures/receipts/ledger/.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/c/Users/wmy/AppData/Local/rp-tools/node_modules/.bin:$PATH"

CASES="DEV-PATH-002 DEV-PATH-003 DEV-RUNTIME-001 DEV-RUNTIME-002 DEV-RUNTIME-003 DEV-CONFIG-001 DEV-CONFIG-002 DEV-CONFIG-003 DEV-NATIVE-001 DEV-NATIVE-002 DEV-NATIVE-003"
RECEIPT="receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json"

for CASE in $CASES; do
  echo "=== promoting $CASE ==="
  EP=$(node -e "console.log(JSON.parse(require('fs').readFileSync('fixtures/receipts/build/$CASE.json','utf8')).entrypoint.path)")
  V=$(node -e "console.log(new Date().toISOString().replace(/\.\d+Z$/,'Z'))")
  node -e "
const fs = require('fs');
const p = 'fixtures/development/cases/$CASE.json';
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
m.fixture_status = 'verified';
m.implementation.receipts.backend_qualification = '$RECEIPT';
m.implementation.receipts.verification_ledger = 'receipts/ledger/$CASE.json';
m.implementation.verified_at = '$V';
fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
" || { echo "$CASE manifest update FAILED"; exit 1; }
  pnpm exec biome format --write "fixtures/development/cases/$CASE.json" >/dev/null 2>&1
  node work/generate-build-receipt.mjs "$CASE" "$EP" >/dev/null 2>&1 || { echo "$CASE receipt FAILED"; exit 1; }
  node ./node_modules/tsx/dist/cli.mjs src/fixtures-cli.ts case run --case "$CASE" \
    --config work/vm/backend-config.json --receipt "fixtures/$RECEIPT" \
    --out "fixtures/receipts/ledger/$CASE.json" --verified-at "$V" 2>&1 | grep -o '"verdict": "[A-Z_]*"' | sed "s/^/  $CASE /"
done
echo "=== validator ==="
node fixtures/validate.mjs 2>&1 | tail -2
