#!/usr/bin/env bash
# comunito-network-watchdog — supervisión conservadora de acceso remoto.
# Una caída externa jamás debe reiniciar el Pi ni bajar sus interfaces.

set -u

# Estado efímero: nunca convertir una comprobación de red en escrituras a la SD.
STATE_DIR="/run/comunito"
LOG="$STATE_DIR/network-watchdog.log"
LOCK="$STATE_DIR/network-watchdog.lock"
MAX_LOG_BYTES=1048576

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
exec 9>"$LOCK"
flock -n 9 || exit 0

rotate_log() {
    local size
    size="$(stat -c%s "$LOG" 2>/dev/null || echo 0)"
    if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
        mv -f "$LOG" "${LOG}.1"
    fi
}

log() {
    local message="$*"
    rotate_log
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$message" >> "$LOG"
    logger -t comunito-network-watchdog -- "$message" 2>/dev/null || true
}

last_state_file="$STATE_DIR/tailscale-last-state"
record_state() {
    local current="$1"
    local previous=""
    previous="$(cat "$last_state_file" 2>/dev/null || true)"
    if [ "$current" != "$previous" ]; then
        log "[TAILSCALE] Estado: ${previous:-desconocido} -> $current"
        printf '%s' "$current" > "$last_state_file"
    fi
}

# No se prueba Internet con terceros ni se altera eth0/wlan0. NetworkManager y
# tailscaled se recuperan solos; intervenir puede aislar el único acceso remoto.
if ! systemctl is-active --quiet tailscaled; then
    log "[TAILSCALE] tailscaled inactivo; solicitando reinicio del servicio"
    systemctl restart tailscaled || log "[TAILSCALE] No fue posible reiniciar tailscaled"
    sleep 3
fi

if command -v tailscale >/dev/null 2>&1; then
    ts_state="$(timeout 8 tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState", "Unknown"))' 2>/dev/null || echo 'Unknown')"
    record_state "$ts_state"
    if [ "$ts_state" = "NeedsLogin" ]; then
        log "[TAILSCALE] Requiere autenticación manual; no se reinicia el Pi"
    fi
else
    record_state "NotInstalled"
fi

if systemctl is-enabled --quiet comunito-portal 2>/dev/null && ! systemctl is-active --quiet comunito-portal; then
    log "[PORTAL] Servicio inactivo; solicitando reinicio"
    systemctl restart comunito-portal || log "[PORTAL] No fue posible reiniciar el portal"
fi
