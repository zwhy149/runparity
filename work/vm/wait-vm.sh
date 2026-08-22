#!/usr/bin/env bash
# Wait for the backend VM to finish cloud-init, then verify rootless Podman.
set -uo pipefail
cd /root/rp-backend-vm
SSH_OPTS="-i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o BatchMode=yes"
SSH="ssh $SSH_OPTS rp@127.0.0.1"

up=0
for i in $(seq 1 120); do
  sleep 5
  if $SSH 'echo up' >/dev/null 2>&1; then
    echo "SSH_UP after ~$((i*5))s"
    up=1
    break
  fi
done
[ "$up" = 1 ] || { echo "SSH never came up"; tail -40 serial.log; exit 1; }

echo "--- cloud-init (waiting) ---"
$SSH 'sudo cloud-init status --wait' || true
$SSH 'sudo cloud-init status'
echo "--- identity ---"
$SSH 'id && uname -r && cat /etc/os-release | head -2'
echo "--- podman ---"
$SSH 'podman --version'
echo "--- subuid/subgid ---"
$SSH 'grep rp /etc/subuid /etc/subgid'
echo "--- rootless info (key facts) ---"
$SSH 'podman info --format json' > vm-podman-info.json
python3 - <<'PY'
import json
info = json.load(open('vm-podman-info.json'))
host = info.get('host', {})
print('rootless:', host.get('security', {}).get('rootless'))
print('idMappings.uid:', '[' + ', '.join(f"{e['container_uid']}-{e['container_uid']+e['length']} -> {e['host_uid']}-{e['host_uid']+e['length']}" for e in (host.get('idMappings', {}).get('uidMap') or [])) + ']')
print('kernel:', host.get('kernel'), '| os:', host.get('os'))
print('cgroupVersion:', host.get('cgroupVersion'), '| cgroupControllers:', host.get('cgroupControllers'))
print('runtime:', info.get('version', {}))
PY
echo "--- rootless run smoke (pull alpine) ---"
$SSH 'podman run --rm docker.io/library/alpine:3.20 echo ROOTLESS_OK'
echo WAIT_VM_DONE
