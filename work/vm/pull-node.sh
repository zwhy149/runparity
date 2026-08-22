#!/usr/bin/env bash
set -uo pipefail
SSH="ssh -i /root/rp-backend-vm/rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"

$SSH 'pkill -f "podman pull" || true; sleep 1' 2>/dev/null

start=$(date +%s)
if timeout 240 $SSH 'podman pull docker.1ms.run/library/node:22-bookworm-slim' 2>&1 | tail -3; then
  echo "1MS_PULL_OK in $(( $(date +%s) - start ))s"
else
  echo "1MS_PULL_FAIL after $(( $(date +%s) - start ))s"
fi

GW=$(ip route | awk '/default/ {print $3}')
echo "WSL_GW=$GW"
curl -sS -m 8 -o /dev/null -w "proxy_via_gw_http=%{http_code}\n" -x "http://${GW}:7897" https://github.com || echo "proxy_via_gw_UNREACHABLE"

$SSH 'podman images' 2>/dev/null | head -5
echo PULLNODE_DONE
