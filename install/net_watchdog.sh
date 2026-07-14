#!/bin/bash
# net_watchdog.sh — Comunito Pi Network & Tailscale Watchdog
# Ejecutado cada 3 min por cron. Restaura conectividad y acceso remoto.

LOG=/var/log/net_watchdog.log
FAIL_COUNT_FILE=/tmp/net_watchdog_fails
MAX_LOG=50000  # bytes máx antes de rotar

if [ -f "$LOG" ] && [ $(stat -c%s "$LOG" 2>/dev/null || echo 0) -gt $MAX_LOG ]; then
    mv "$LOG" "${LOG}.1"
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# 1. Verificar red (ping a 8.8.8.8 y 1.1.1.1)
NET_OK=false
ping -c2 -W3 8.8.8.8 &>/dev/null && NET_OK=true
$NET_OK || ping -c2 -W3 1.1.1.1 &>/dev/null && NET_OK=true

if ! $NET_OK; then
    FAILS=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)
    FAILS=$((FAILS+1))
    echo "$FAILS" > "$FAIL_COUNT_FILE"

    log "[NET] Sin conectividad (falla $FAILS/4) — reiniciando interfaces"
    
    if [ "$FAILS" -ge 4 ]; then
        log "[FATAL] Sin red por más de 12 minutos. El driver WiFi pudo haber colapsado. FORZANDO REBOOT."
        sleep 2
        /sbin/reboot
        exit 1
    fi

    for IFACE in eth0 wlan0; do
        if ip link show "$IFACE" &>/dev/null; then
            ip link set "$IFACE" down
            sleep 2
            ip link set "$IFACE" up
            sleep 3
        fi
    done
    systemctl is-active --quiet wpa_supplicant && systemctl restart wpa_supplicant
    sleep 5
    ping -c2 -W5 8.8.8.8 &>/dev/null && { log "[NET] Recuperada"; echo 0 > "$FAIL_COUNT_FILE"; } || log "[NET] Sin red tras intento"
else
    # Red bien, resetear contador
    echo 0 > "$FAIL_COUNT_FILE"
fi

# 2. Verificar Tailscale
if ! tailscale status &>/dev/null; then
    log "[TS] Tailscale caído — reiniciando tailscaled"
    systemctl restart tailscaled
    sleep 5
fi

# 3. Verificar portal ALPR
if systemctl is-enabled --quiet comunito-portal 2>/dev/null; then
    if ! systemctl is-active --quiet comunito-portal; then
        log "[PORTAL] Servicio caído — reiniciando"
        systemctl restart comunito-portal
    fi
fi
