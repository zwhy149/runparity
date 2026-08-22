#!/usr/bin/env bash
set -uo pipefail
cd /root/rp-backend-vm
SSH="ssh -i rp_vm_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes rp@127.0.0.1"
tar -C /root/.cache/runparity-node-v24.15.0/node-v24.15.0-linux-x64 -cf - bin/node | $SSH 'tar -C /home/rp/assets-external/node-24.15.0/bin -xf -'
$SSH 'chmod 755 /home/rp/assets-external/node-24.15.0/bin/node'
$SSH '/home/rp/assets-external/node-24.15.0/bin/node --version'
$SSH 'sha256sum /home/rp/assets-external/node-24.15.0/bin/node /home/rp/assets-external/node-22.23.2/bin/node'
echo NODE24_DONE
