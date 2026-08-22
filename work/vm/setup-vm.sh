#!/usr/bin/env bash
# RunParity Stage B: build the dedicated Linux backend VM inside WSL2 (KVM).
# This VM is a full Ubuntu cloud-image VM with its own kernel and systemd,
# a non-root user, and rootless Podman. It is NOT the WSL2 distro itself.
set -euo pipefail
cd /root/rp-backend-vm

qemu-img create -f qcow2 -F qcow2 -b noble.img rpvm.qcow2 40G

[ -f rp_vm_key ] || ssh-keygen -t ed25519 -N '' -f rp_vm_key -C rp-backend-vm -q
PUB="$(cat rp_vm_key.pub)"

cat > user-data <<EOF
#cloud-config
hostname: rpvm
users:
  - default
  - name: rp
    groups: [adm, sudo]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $PUB
package_update: true
packages: [podman, uidmap]
runcmd:
  - usermod --add-subuids 100000-165535 --add-subgids 100000-165535 rp
EOF

printf 'instance-id: rpvm-001\nlocal-hostname: rpvm\n' > meta-data
cloud-localds seed.iso user-data meta-data

rm -f qemu.pid serial.log
qemu-system-x86_64 \
  -enable-kvm -cpu host -smp 4 -m 3800 \
  -drive file=rpvm.qcow2,if=virtio,format=qcow2 \
  -drive file=seed.iso,if=virtio,media=cdrom,format=raw,readonly=on \
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:2222-:22 \
  -device virtio-net-pci,netdev=n0 \
  -display none -serial file:serial.log \
  -pidfile qemu.pid -daemonize
echo "QEMU_PID=$(cat qemu.pid)"
