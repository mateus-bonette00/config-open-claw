#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute com sudo:"
  echo "  sudo bash $0 [--reboot]"
  exit 1
fi

DO_REBOOT="false"
if [[ "${1:-}" == "--reboot" ]]; then
  DO_REBOOT="true"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/fix-rx580-ubuntu24-${TIMESTAMP}"
LOG_FILE="/var/log/fix-rx580-ubuntu24.log"
mkdir -p "${BACKUP_DIR}"
touch "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

step() {
  echo
  echo "============================================================"
  echo "[${1}] ${2}"
  echo "============================================================"
}

backup_if_exists() {
  local target="$1"
  if [[ -e "${target}" ]]; then
    mkdir -p "${BACKUP_DIR}/$(dirname "${target}")"
    cp -a "${target}" "${BACKUP_DIR}/${target}"
    echo "Backup: ${target} -> ${BACKUP_DIR}/${target}"
  fi
}

cleanup_kernel_cmdline() {
  local current cleaned
  current="$(sed -n 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/\1/p' /etc/default/grub || true)"
  if [[ -z "${current}" ]]; then
    echo "Nao foi possivel ler GRUB_CMDLINE_LINUX_DEFAULT; mantendo arquivo como esta."
    return 0
  fi

  cleaned="$(echo "${current}" \
    | sed -E 's/(^| )nomodeset( |$)/ /g' \
    | sed -E 's/(^| )(amdgpu|radeon|nouveau|nvidia)\.[^ ]+( |$)/ /g' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"

  awk -v newval="${cleaned}" '
    BEGIN {done=0}
    /^GRUB_CMDLINE_LINUX_DEFAULT=/ {
      print "GRUB_CMDLINE_LINUX_DEFAULT=\"" newval "\""
      done=1
      next
    }
    {print}
    END {
      if (!done) {
        print "GRUB_CMDLINE_LINUX_DEFAULT=\"" newval "\""
      }
    }
  ' /etc/default/grub > /etc/default/grub.new

  mv /etc/default/grub.new /etc/default/grub
  echo "Kernel cmdline anterior: ${current}"
  echo "Kernel cmdline novo    : ${cleaned}"
}

step "INFO" "Inicio do reparo RX 580 no Ubuntu 24 (log: ${LOG_FILE})"
cat /etc/os-release | sed -n '1,6p' || true
uname -a || true

step "1/10" "Coletando estado atual da GPU"
lspci -nn | grep -Ei 'vga|display|3d' || true
lspci -nnk | grep -A3 -Ei 'vga|display|3d' || true
lsmod | grep -E 'amdgpu|radeon|nouveau|nvidia' || true

step "2/10" "Backups de arquivos sensiveis"
backup_if_exists /etc/default/grub
backup_if_exists /etc/modprobe.d
backup_if_exists /etc/X11/xorg.conf
backup_if_exists /etc/X11/xorg.conf.d
backup_if_exists /etc/apt/sources.list.d
backup_if_exists /etc/apt/preferences.d

step "3/10" "Parando servicos de display manager (evita conflito na limpeza)"
for dm in gdm3 sddm lightdm; do
  if systemctl is-active --quiet "${dm}"; then
    echo "Parando ${dm}..."
    systemctl stop "${dm}" || true
  fi
done

step "4/10" "Removendo repositorios/sobras de drivers antigos (AMDGPU PRO/NVIDIA)"
rm -f /etc/apt/sources.list.d/amdgpu*.list \
      /etc/apt/sources.list.d/rocm*.list \
      /etc/apt/sources.list.d/nvidia*.list || true
rm -f /etc/apt/preferences.d/amdgpu* \
      /etc/apt/preferences.d/rocm* \
      /etc/apt/preferences.d/nvidia* || true

step "5/10" "Limpando configuracoes Xorg antigas"
if [[ -f /etc/X11/xorg.conf ]]; then
  mv /etc/X11/xorg.conf "${BACKUP_DIR}/etc/X11/xorg.conf.removido"
  echo "Movido /etc/X11/xorg.conf para backup."
fi

if [[ -d /etc/X11/xorg.conf.d ]]; then
  shopt -s nullglob
  for f in /etc/X11/xorg.conf.d/*.conf; do
    if grep -Eiq 'nvidia|amdgpu|radeon|fglrx|ati' "${f}"; then
      mkdir -p "${BACKUP_DIR}/etc/X11/xorg.conf.d"
      mv "${f}" "${BACKUP_DIR}/etc/X11/xorg.conf.d/"
      echo "Movido ${f} para backup."
    fi
  done
  shopt -u nullglob
fi

step "6/10" "Limpando regras modprobe antigas que podem quebrar a RX 580"
if [[ -d /etc/modprobe.d ]]; then
  shopt -s nullglob
  for f in /etc/modprobe.d/*.conf; do
    if grep -Eiq 'blacklist[[:space:]]+(amdgpu|radeon|nouveau|nvidia)|options[[:space:]]+(amdgpu|radeon|nouveau|nvidia)' "${f}"; then
      cp -a "${f}" "${BACKUP_DIR}${f}"
      sed -E '/blacklist[[:space:]]+(amdgpu|radeon|nouveau|nvidia)/Id; /options[[:space:]]+(amdgpu|radeon|nouveau|nvidia)/Id' "${f}" > "${f}.tmp"
      if [[ -s "${f}.tmp" ]]; then
        mv "${f}.tmp" "${f}"
        echo "Linhas de blacklist/options removidas de ${f}."
      else
        rm -f "${f}.tmp"
        rm -f "${f}"
        echo "Arquivo ${f} removido (ficou vazio apos limpeza)."
      fi
    fi
  done
  shopt -u nullglob
fi

step "7/10" "Purgando pacotes de driver legado/conflitante"
apt-get update

# Purga por regex (nvidia/fglrx) sem falhar se nao existir
apt-get purge -y '^nvidia-.*' '^fglrx-.*' || true

# Purga pacotes AMD legados apenas se estiverem instalados
mapfile -t AMD_OLD_PKGS < <(dpkg -l | awk '/^ii/ {print $2}' | grep -E '^(amdgpu-install|amdgpu-dkms|amdgpu-pro|rocm)' || true)
if [[ "${#AMD_OLD_PKGS[@]}" -gt 0 ]]; then
  apt-get purge -y "${AMD_OLD_PKGS[@]}" || true
else
  echo "Nenhum pacote AMD legado (amdgpu-pro/rocm) instalado."
fi

apt-get autoremove -y --purge

step "8/10" "Reinstalando stack correta para RX 580 (amdgpu + mesa + firmware)"
apt-get install -y --reinstall \
  linux-firmware \
  libdrm-amdgpu1 \
  libgl1-mesa-dri \
  mesa-vulkan-drivers \
  xserver-xorg-video-amdgpu \
  mesa-utils \
  vulkan-tools \
  pciutils

step "9/10" "Ajustando GRUB (remove nomodeset e opcoes antigas de GPU)"
cleanup_kernel_cmdline
update-initramfs -u -k all
update-grub

step "10/10" "Validacao pre-reboot"
lspci -nnk | grep -A3 -Ei 'vga|display|3d' || true
lsmod | grep amdgpu || true

echo
echo "Concluido com sucesso."
echo "Backup completo em: ${BACKUP_DIR}"
echo "Log completo em   : ${LOG_FILE}"
echo
echo "Depois do reboot, valide com:"
echo "  lspci -nnk | grep -A3 -Ei 'vga|display|3d'"
echo "  lsmod | grep amdgpu"
echo "  glxinfo -B | grep -E 'OpenGL vendor|OpenGL renderer'"
echo "  journalctl -k -b | grep -Ei 'amdgpu|ring|timeout|gpu reset|pcie|mce'"
echo

if [[ "${DO_REBOOT}" == "true" ]]; then
  echo "Reiniciando em 8 segundos..."
  sleep 8
  reboot
fi
