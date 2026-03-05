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
  python3-full python3-venv python3-pip \
  libglib2.0-0 libxext6 libsm6 libxrender1 libgl1 \
  build-essential curl ca-certificates git unzip \
  network-manager tzdata iproute2 net-tools \
  gstreamer1.0-tools gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good

sudo systemctl enable NetworkManager --now || true

echo "==> 2) Clonar/actualizar repo"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull --rebase
else
  sudo rm -rf "$APP_DIR"
  git clone https://github.com/comunito/comunito_portal.git "$APP_DIR"
fi

echo "==> 3) Crear venv e instalar requirements"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --upgrade pip wheel
pip install -r "$APP_DIR/requirements.txt"

echo "==> 4) Instalar systemd service"
sudo cp "$APP_DIR/systemd/comunito-portal.service" "$SVC"
sudo sed -i "s|^User=.*|User=$ME|g" "$SVC"
sudo sed -i "s|/home/pi|/home/$ME|g" "$SVC"

echo "==> 5) Habilitar servicio"
sudo systemctl daemon-reload
sudo systemctl enable comunito-portal.service --now

IP_NOW="$(hostname -I | awk '{print $1}')"
echo
echo "==> Listo:"
echo "    http://$IP_NOW"
echo "    Settings: http://$IP_NOW/settings"
