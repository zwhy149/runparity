#!/usr/bin/env bash
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
REPO=/mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2
IMG=docker.1ms.run/library/node:22-bookworm-slim
FLAGS="--network none --cap-drop ALL --security-opt no-new-privileges --read-only --userns keep-id:uid=10001,gid=10001 --user 10001:10001 --pids-limit 64 --memory 536870912 --cpus 1 --tmpfs /tmp:rw,size=16m,mode=1777 -v /home/rp/probe:/probe:ro"

tar -C "$REPO/src/backend/probes" -cf - . | $SSH 'tar -C /home/rp/probe -xf -'

echo "=== privilege bundle key lines ==="
$SSH "podman run --rm $FLAGS $IMG node /probe/linux-rootless-privilege-probe.js" > vm-spike-bundle.json 2>/dev/null
python3 - <<'PY'
import json
b = json.load(open('vm-spike-bundle.json'))
text = b['procSelfStatus']['text']
for key in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs'):
    for line in text.split('\n'):
        if line.startswith(key + ':'):
            print(line)
print('uid_map:', b['procSelfUidMap']['text'].strip().replace('\n', ' | '))
print('gid_map:', b['procSelfGidMap']['text'].strip().replace('\n', ' | '))
print('overflowuid:', b['overflowUid']['text'].strip(), 'overflowgid:', b['overflowGid']['text'].strip())
PY

echo "=== residue write (arm1) ==="
$SSH 'rm -rf /home/rp/arms/spike1 && mkdir -p /home/rp/arms/spike1'
$SSH "podman run --rm $FLAGS -v /home/rp/arms/spike1:/home/arm:rw $IMG node /probe/residue-probe.mjs --write"
echo "=== residue check (fresh arm2) ==="
$SSH 'rm -rf /home/rp/arms/spike2 && mkdir -p /home/rp/arms/spike2'
$SSH "podman run --rm $FLAGS -v /home/rp/arms/spike2:/home/arm:rw $IMG node /probe/residue-probe.mjs --check"

echo "=== network probe ==="
$SSH "podman run --rm $FLAGS $IMG node /probe/network-probe.mjs"

echo "=== readonly/write probe ==="
$SSH 'rm -rf /home/rp/arms/spike3 && mkdir -p /home/rp/arms/spike3'
$SSH "podman run --rm $FLAGS -v /home/rp/arms/spike3:/home/arm:rw $IMG node /probe/readonly-write-probe.mjs"

echo "=== credential probe ==="
$SSH "podman run --rm $FLAGS -v /home/rp/arms/spike3:/home/arm:rw $IMG node /probe/credential-probe.mjs"

echo "=== limit probe ==="
$SSH "podman run --rm $FLAGS -v /home/rp/arms/spike3:/home/arm:rw $IMG node /probe/limit-probe.mjs"

echo "=== detached destroy with proper count ==="
$SSH "podman run --rm --name rp-spike-det --network none --cap-drop ALL $IMG node /probe/detached-spawner-probe.mjs"
sleep 2
echo "leftover=$($SSH 'podman ps -a --filter name=rp-spike-det --format json')"
COUNT=$($SSH 'pgrep -c -u 1000 -x sleep' 2>/dev/null)
echo "surviving_sleep_count=${COUNT:-pgrep_exit_1_meaning_zero}"
echo SPIKE3_DONE
