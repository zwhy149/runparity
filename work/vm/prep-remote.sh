#!/usr/bin/env bash
# Prepare VM-side directories and fixture assets (explicit cache-seeding step).
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
REPO=/mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2

$SSH 'mkdir -p /home/rp/probe /home/rp/assets /home/rp/arms'

echo "=== transfer probes + DEV-PATH-001 assets ==="
tar -C "$REPO/src/backend/probes" -cf - . | $SSH 'tar -C /home/rp/probe -xf -'
tar -C "$REPO/fixtures/development/assets" -cf - DEV-PATH-001 | $SSH 'tar -C /home/rp/assets -xf -'
$SSH 'chmod 755 /home/rp/assets/DEV-PATH-001/wrong-node/bin/node /home/rp/assets/DEV-PATH-001/intended-node/bin/node; ls -la /home/rp/assets/DEV-PATH-001/*/bin/'

echo "=== verify arm digest refs resolve ==="
$SSH 'podman image inspect --format json docker.1ms.run/library/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066' >/dev/null 2>&1 && echo DIGEST_A_OK || echo DIGEST_A_FAIL
$SSH 'podman image inspect --format json docker.1ms.run/library/node@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436' >/dev/null 2>&1 && echo DIGEST_B_OK || echo DIGEST_B_FAIL

echo "=== export Windows ssh identity + host key ==="
cp -f rp_vm_key /mnt/c/Users/wmy/.ssh/rp_backend_vm_key
cp -f rp_vm_key.pub /mnt/c/Users/wmy/.ssh/rp_backend_vm_key.pub
ssh-keyscan -p 2222 127.0.0.1 2>/dev/null > /mnt/c/Users/wmy/.ssh/rp_backend_vm_known_hosts
wc -l /mnt/c/Users/wmy/.ssh/rp_backend_vm_known_hosts
echo PREP_DONE
