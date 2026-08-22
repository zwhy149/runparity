#!/usr/bin/env bash
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
IMG=docker.1ms.run/library/node:22-bookworm-slim
FLAGS="--network none --cap-drop ALL --security-opt no-new-privileges --read-only --userns keep-id:uid=10001,gid=10001 --user 10001:10001 -v /home/rp/probe:/probe:ro"

$SSH "podman rm -f rp-qual-bind" >/dev/null 2>&1
$SSH "podman run -d --name rp-qual-bind $FLAGS $IMG sleep 30" >/dev/null
sleep 2
echo "=== inspect State.Pid ==="
$SSH "podman inspect --format json rp-qual-bind" > vm-bind-inspect.json
python3 - <<'PY'
import json
info = json.load(open('vm-bind-inspect.json'))[0]
print('State.Pid =', info['State']['Pid'], '| Running =', info['State']['Running'])
PY
HPID=$(python3 -c "import json; print(json.load(open('vm-bind-inspect.json'))[0]['State']['Pid'])")
echo "=== host /proc/$HPID/status (kernel truth) ==="
$SSH "grep -E '^(Name|Uid|Gid|CapEff|CapPrm|NoNewPrivs):' /proc/$HPID/status"
echo "=== host /proc/$HPID/uid_map ==="
$SSH "cat /proc/$HPID/uid_map"
$SSH "podman rm -f -t 1 rp-qual-bind" >/dev/null 2>&1
sleep 1
echo "after rm: leftover=$($SSH 'podman ps -a --filter name=rp-qual-bind --format json')"
COUNT=$($SSH 'pgrep -c -u 1000 -x sleep' 2>/dev/null)
echo "surviving_sleep_count=${COUNT:-0}"
echo BIND2_DONE
