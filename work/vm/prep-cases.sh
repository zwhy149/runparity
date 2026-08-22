#!/usr/bin/env bash
# Prepare external runtimes + full asset sync for the 12-case experiment set.
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
REPO=/mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2
IMG=docker.1ms.run/library/node:22-bookworm-slim

echo "=== node 24.15.0 runtime (from verified WSL cache) ==="
$SSH 'mkdir -p /home/rp/assets-external/node-24.15.0/bin'
tar -C /root/.cache/runparity-node-v24.15.0/node-v24.15.0-linux-x64 --strip-components=2 -cf - node-v24.15.0-linux-x64/bin/node | $SSH 'tar -C /home/rp/assets-external/node-24.15.0/bin -xf -'
$SSH 'chmod 755 /home/rp/assets-external/node-24.15.0/bin/node && /home/rp/assets-external/node-24.15.0/bin/node --version'

echo "=== node 22.23.2 runtime (exported from the pinned image) ==="
$SSH 'mkdir -p /home/rp/assets-external/node-22.23.2/bin'
$SSH "podman run --rm --network none --cap-drop ALL -v /home/rp/assets-external/node-22.23.2/bin:/out:rw,U $IMG cp /usr/local/bin/node /out/node"
$SSH 'chmod 755 /home/rp/assets-external/node-22.23.2/bin/node && /home/rp/assets-external/node-22.23.2/bin/node --version'

echo "=== digests (fill into case-plans RUNTIME_001) ==="
$SSH 'sha256sum /home/rp/assets-external/node-24.15.0/bin/node /home/rp/assets-external/node-22.23.2/bin/node'

echo "=== full asset sync (all 12 cases) ==="
for c in DEV-PATH-001 DEV-PATH-002 DEV-PATH-003 DEV-RUNTIME-001 DEV-RUNTIME-002 DEV-RUNTIME-003 DEV-CONFIG-001 DEV-CONFIG-002 DEV-CONFIG-003 DEV-NATIVE-001 DEV-NATIVE-002 DEV-NATIVE-003; do
  $SSH "rm -rf /home/rp/assets/$c"
  tar -C "$REPO/fixtures/development/assets" -cf - "$c" | $SSH 'tar -C /home/rp/assets -xf -'
done
$SSH 'chmod 755 /home/rp/assets/DEV-PATH-001/wrong-node/bin/node /home/rp/assets/DEV-PATH-001/intended-node/bin/node /home/rp/assets/DEV-PATH-002/stale-pnpm/bin/pnpm /home/rp/assets/DEV-PATH-002/approved-pnpm/bin/pnpm /home/rp/assets/DEV-PATH-003/repository-fixture/bin/node /home/rp/assets/DEV-PATH-003/unintended-toolchain/bin/node-target /home/rp/assets/DEV-RUNTIME-002/approved-pnpm/bin/pnpm /home/rp/assets/DEV-RUNTIME-002/wrong-version-pnpm/bin/pnpm /home/rp/assets/DEV-RUNTIME-003/pnpm-launcher/bin/pnpm /home/rp/assets/DEV-RUNTIME-003/pnpm-launcher-approved/bin/pnpm /home/rp/assets/DEV-RUNTIME-003/runtime-manager/approved/bin/node /home/rp/assets/DEV-RUNTIME-003/runtime-manager/unintended/bin/node'
$SSH 'ls /home/rp/assets/; echo ---; ls /home/rp/assets/DEV-RUNTIME-003/'
echo PREP_CASES_DONE
