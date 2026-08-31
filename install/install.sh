#!/usr/bin/env bash
set -euo pipefail

echo "==> Comunito Portal: instalador base (GitHub)"

ME="$(whoami)"
APP_DIR="/home/$ME/comunito_portal"
VENV="$APP_DIR/comunito-venv"
SVC="/etc/systemd/system/comunito-portal.service"

echo "==> 1) Paquetes base"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  python3-full python3-venv python3-pip python3-opencv \
  libglib2.0-0 libxext6 libsm6 libxrender1 libgl1 \
  build-essential curl ca-certificates git unzip \
  network-manager tzdata iproute2 net-tools \
  gstreamer1.0-tools gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  dnsmasq

sudo systemctl enable NetworkManager --now || true

echo "==> 2) Clonar/actualizar repo"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull --rebase
else
  sudo rm -rf "$APP_DIR"
  git clone https://github.com/comunito/comunito_portal.git "$APP_DIR"
fi
# Asegurar que todos los archivos del repo pertenecen al usuario actual
sudo chown -R "$ME:$ME" "$APP_DIR"

echo "==> 3) Crear venv e instalar requirements"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --upgrade pip wheel setuptools
pip install -r "$APP_DIR/requirements.txt"

echo "==> 3.1) Validar fast_alpr"
python - <<'PYCHK'
import sys
try:
    from fast_alpr import ALPR
    print("[OK] import fast_alpr")
    alpr = ALPR(
        detector_model="yolo-v9-t-384-license-plate-end2end",
        ocr_model="cct-xs-v1-global-model"
    )
    print("[OK] ALPR engine listo")
except Exception as e:
    print("[ERROR] fast_alpr no quedó operativo:", e)
    sys.exit(1)
PYCHK

echo "==> 4) Configurar LAN de cámaras en eth0"
sudo nmcli connection delete comunito-cam-lan 2>/dev/null || true
sudo nmcli connection add \
  type ethernet \
  ifname eth0 \
  con-name comunito-cam-lan \
  ipv4.method manual \
  ipv4.addresses 192.168.88.1/24 \
  ipv6.method ignore \
  autoconnect yes || true
sudo nmcli connection up comunito-cam-lan || true

echo "==> 5) Configurar DHCP para cámaras"
sudo mkdir -p /etc/dnsmasq.d
sudo cp "$APP_DIR/install/network/cam_eth.conf" /etc/dnsmasq.d/cam_eth.conf
sudo systemctl enable dnsmasq
sudo systemctl restart dnsmasq

echo "==> 6) Instalar Tailscale"
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable tailscaled --now || true
sudo install -d -m 0755 /etc/systemd/system/tailscaled.service.d
sudo cp "$APP_DIR/systemd/tailscaled-recovery.conf" /etc/systemd/system/tailscaled.service.d/comunito-recovery.conf
echo "==> Tailscale instalado. Después ejecuta: sudo tailscale up"

echo "==> 7) Instalar systemd service"
sudo cp "$APP_DIR/systemd/comunito-portal.service" "$SVC"
sudo sed -i "s|^User=.*|User=$ME|g" "$SVC"
sudo sed -i "s|/home/pi|/home/$ME|g" "$SVC"

echo "==> 8) Habilitar servicio"
sudo install -m 0755 "$APP_DIR/install/net_watchdog.sh" /usr/local/sbin/comunito-network-watchdog
sudo cp "$APP_DIR/systemd/comunito-network-watchdog.service" /etc/systemd/system/
sudo cp "$APP_DIR/systemd/comunito-network-watchdog.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable comunito-portal.service --now
sudo systemctl enable --now comunito-network-watchdog.timer

echo "==> 9) Conservar diagnósticos de forma acotada"
sudo install -d -m 2755 -o root -g systemd-journal /var/log/journal
sudo install -d -m 0755 /etc/systemd/journald.conf.d
printf '%s\n' '[Journal]' 'Storage=persistent' 'SystemMaxUse=200M' | sudo tee /etc/systemd/journald.conf.d/comunito.conf >/dev/null
sudo systemctl restart systemd-journald

IP_NOW="$(hostname -I | awk '{print $1}')"
echo
echo "==> Listo:"
echo "    Portal:   http://$IP_NOW:5000"
echo "    Settings: http://$IP_NOW:5000/settings"
echo "    Tailscale: ejecuta sudo tailscale up"
