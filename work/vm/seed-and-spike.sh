#!/usr/bin/env bash
# Stage B cache-seeding + empirical flag-set spike (explicit network step).
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
REPO=/mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2
IMG=docker.m.daocloud.io/library/node:22-bookworm-slim

echo "=== pull images (mirror) ==="
$SSH "podman pull docker.m.daocloud.io/library/node:22-bookworm-slim" || exit 1
$SSH "podman pull docker.m.daocloud.io/library/alpine:3.20" || exit 1

echo "=== record image facts ==="
$SSH "podman image inspect --format json $IMG" > vm-node-image.json
python3 - <<'PY'
import json
img = json.load(open('vm-node-image.json'))[0]
print('Id:', img['Id'])
print('Os/Arch:', img['Os'], img['Architecture'])
print('RepoDigests:', img['RepoDigests'])
print('Version:', img.get('Config', {}).get('Labels', {}))
PY

echo "=== transfer privilege probe ==="
$SSH 'mkdir -p /home/rp/probe /home/rp/assets /home/rp/arms'
tar -C "$REPO/dist" -cf - linux-rootless-privilege-probe.js | $SSH 'tar -C /home/rp/probe -xf -'
$SSH 'ls -la /home/rp/probe'

echo "=== spike: full arm flag set + probe ==="
$SSH "podman run --rm --network none --cap-drop ALL --security-opt no-new-privileges --read-only --userns keep-id:uid=10001,gid=10001 --user 10001:10001 --pids-limit 64 --memory 536870912 --cpus 1 --tmpfs /tmp:rw,size=16m,mode=1777 -v /home/rp/probe:/probe:ro $IMG node /probe/linux-rootless-privilege-probe.js" > vm-spike-bundle.json 2> vm-spike-stderr.txt
echo "probe exit=$?"
head -c 600 vm-spike-bundle.json; echo
cat vm-spike-stderr.txt

echo "=== spike: node identity inside arm ==="
$SSH "podman run --rm --network none --cap-drop ALL --security-opt no-new-privileges --read-only --userns keep-id:uid=10001,gid=10001 --user 10001:10001 $IMG node -p process.version" || echo "node -p exit=$?"

echo "=== spike: podman --timeout behavior ==="
start=$(date +%s)
$SSH "podman run --rm --network none --cap-drop ALL --timeout 4 $IMG sleep 30"; rc=$?
echo "sleep-30-with-timeout-4 exit=$rc after $(( $(date +%s) - start ))s"

echo "=== spike: detached descendant + post-destroy liveness ==="
$SSH "podman run --rm --name rp-spike-det --network none --cap-drop ALL sh -c 'sleep 300 & echo spawned; exit 0'" >/dev/null 2>&1
echo "detached container exit=$?"
sleep 2
$SSH "podman ps -a --filter name=rp-spike-det --format {{.Names}}:{{.Status}}" | grep . && echo "LEFTOVER_FOUND" || echo "NO_LEFTOVER"

echo SPIKE_DONE
