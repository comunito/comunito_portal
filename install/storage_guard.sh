#!/usr/bin/env bash
# Detecta condiciones de almacenamiento peligrosas sin reiniciar ni detener ALPR.
# Si la raíz quedó en solo lectura, el portal que ya está en memoria sigue vivo;
# detenerlo haría perder el servicio local. El objetivo es dejar evidencia en RAM
# y evitar reinicios automáticos que agraven un medio dañado.
set -eu

root_options="$(findmnt -no OPTIONS / 2>/dev/null || true)"
if printf '%s' "$root_options" | grep -Eq '(^|,)ro(,|$)|emergency_ro'; then
  logger -p daemon.alert -t comunito-storage-guard -- \
    "ALERTA: raíz no escribible ($root_options). No se reinicia el portal; sustituye el medio de almacenamiento."
  exit 0
fi

root_use="$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [ -n "$root_use" ] && [ "$root_use" -ge 85 ]; then
  logger -p daemon.warning -t comunito-storage-guard -- \
    "ALERTA: partición raíz al ${root_use}% de uso; revisar almacenamiento."
fi

# No guarda resultados: la comprobación debe ser de lectura para no desgastar SD.
if ! systemctl is-active --quiet comunito-portal; then
  logger -p daemon.warning -t comunito-storage-guard -- "Portal inactivo; watchdog de red gestionará su recuperación."
fi
