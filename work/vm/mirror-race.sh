#!/usr/bin/env bash
# Kill stalled pulls, then race small alpine pulls across mirrors.
set -uo pipefail
SSH="ssh -i /root/rp-backend-vm/rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"

$SSH 'pkill -f "podman pull" || true; sleep 1; pgrep -a podman || echo no-podman-running'

for m in docker.1ms.run docker.xuanyuan.me docker.1panel.live docker.m.daocloud.io; do
  start=$(date +%s)
  if $SSH "timeout 90 podman pull $m/library/alpine:3.20" >/dev/null 2>&1; then
    echo "$m ALPINE_OK in $(( $(date +%s) - start ))s"
  else
    echo "$m ALPINE_FAIL after $(( $(date +%s) - start ))s"
  fi
done
$SSH 'podman images --format json' | python3 -c 'import json,sys
try:
  imgs=json.load(sys.stdin)
  [print("HAVE", i["repository"]+":"+i["tag"]) for i in imgs]
except Exception as e:
  print("ERR", e)'
echo RACE_DONE
