#!/usr/bin/env bash
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
IMG=docker.1ms.run/library/node:22-bookworm-slim
FLAGS="--network none --cap-drop ALL --security-opt no-new-privileges --read-only --userns keep-id:uid=10001,gid=10001 --user 10001:10001 -v /home/rp/probe:/probe:ro"

$SSH "podman rm -f rp-qual-bind" >/dev/null 2>&1
$SSH "podman run -d --name rp-qual-bind $FLAGS $IMG sleep 30" >/dev/null
sleep 2
echo "=== podman top (user,huser,gid,hgid,pid,hpid) ==="
$SSH "podman top rp-qual-bind user,huser,gid,hgid,pid,hpid"
echo "=== host /proc/<hpid>/status Uid/Gid lines ==="
HPID=$($SSH "podman top rp-qual-bind hpid -n" | tail -1 | tr -d ' ')
echo "hpid=$HPID"
if [ -n "$HPID" ] && [ "$HPID" != "hpid" ]; then
  $SSH "grep -E '^(Uid|Gid|CapEff|NoNewPrivs):' /proc/$HPID/status"
fi
$SSH "podman rm -f rp-qual-bind" >/dev/null 2>&1
echo BIND_TEST_DONE
