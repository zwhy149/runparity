#!/usr/bin/env bash
set -uxo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
$SSH 'ls -la /home/rp/assets-external/ /home/rp/assets-external/node-24.15.0/ 2>&1' || true
tar -C /root/.cache/runparity-node-v24.15.0/node-v24.15.0-linux-x64 -cf - bin/node | $SSH 'cat > /tmp/node24.tar'
echo "PIPE_RC=$?"
$SSH 'ls -la /tmp/node24.tar; mkdir -p /home/rp/assets-external/node-24.15.0/bin; tar -C /home/rp/assets-external/node-24.15.0/bin -xvf /tmp/node24.tar; ls -la /home/rp/assets-external/node-24.15.0/bin/'
echo DEBUG_DONE
