#!/usr/bin/env bash
# Registro compacto para reconstruir cortes, reinicios y pérdida de servicios.
# Se ejecuta una vez por minuto; nunca interviene en cámaras, relé o red.
set -u

STATE_DIR="/var/lib/comunito-diagnostics"
EVENTS="$STATE_DIR/events.log"
STATE="$STATE_DIR/state.env"
MAX_LOG_BYTES=2097152

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

rotate() {
    local size
    size="$(stat -c%s "$EVENTS" 2>/dev/null || echo 0)"
    if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
        mv -f "$EVENTS" "${EVENTS}.1"
    fi
}

emit() {
    rotate
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$*" >> "$EVENTS"
    logger -t comunito-diagnostics -- "$*" 2>/dev/null || true
}

boot_id="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
uptime_s="$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)"
wall_s="$(date +%s)"
load="$(awk '{print $1,$2,$3}' /proc/loadavg 2>/dev/null || echo unknown)"
mem="$(free -m 2>/dev/null | awk '/^Mem:/{print "used=" $3 "MB total=" $2 "MB available=" $7 "MB"}' || echo unknown)"
disk="$(df -P / 2>/dev/null | awk 'NR==2{print "used=" $5 " avail=" $4 "KB"}' || echo unknown)"
temp="$(for f in /sys/class/thermal/thermal_zone*/temp; do [ -r "$f" ] || continue; awk '{printf "%.1fC", $1/1000}' "$f"; break; done)"
[ -n "$temp" ] || temp=unknown

if [ -r "$STATE" ]; then
    # shellcheck disable=SC1090
    . "$STATE"
    if [ "${LAST_BOOT_ID:-}" != "$boot_id" ]; then
        emit "BOOT_CHANGE previous=${LAST_BOOT_ID:-unknown} current=$boot_id uptime=${uptime_s}s"
    elif [ -n "${LAST_UPTIME_S:-}" ] && [ "$uptime_s" -lt "$LAST_UPTIME_S" ]; then
        emit "UPTIME_REGRESSION previous=${LAST_UPTIME_S}s current=${uptime_s}s"
    fi
    if [ -n "${LAST_WALL_S:-}" ] && [ -n "${LAST_UPTIME_S:-}" ]; then
        wall_delta=$((wall_s - LAST_WALL_S))
        up_delta=$((uptime_s - LAST_UPTIME_S))
        if [ "$wall_delta" -gt 180 ] && [ "$up_delta" -ge 0 ] && [ $((wall_delta - up_delta)) -gt 120 ]; then
            emit "SLEEP_OR_TIME_JUMP wall_delta=${wall_delta}s uptime_delta=${up_delta}s gap=$((wall_delta-up_delta))s"
        fi
    fi
fi

throttled="unknown"
if command -v vcgencmd >/dev/null 2>&1; then
    throttled="$(vcgencmd get_throttled 2>/dev/null || echo error)"
fi

ts="unknown"
if command -v tailscale >/dev/null 2>&1; then
    ts="$(timeout 8 tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("Self") or {}; print("state=%s ip=%s online=%s relay=%s" % (d.get("BackendState","?"),(s.get("TailscaleIPs") or [""])[0],s.get("Online","?"),s.get("Relay","?")))' 2>/dev/null || echo state=error)"
fi

route="$(ip route get 1.1.1.1 2>/dev/null | head -1 || echo no-route)"
services="tailscaled=$(systemctl is-active tailscaled 2>/dev/null || echo unknown),portal=$(systemctl is-active comunito-portal 2>/dev/null || echo unknown),ssh=$(systemctl is-active ssh 2>/dev/null || echo unknown)"
errors="$(journalctl -b 0 -p warning..alert --since '2 minutes ago' --no-pager -o cat 2>/dev/null | tr '\n' ' ' | cut -c1-600)"

emit "SNAPSHOT boot=$boot_id uptime=${uptime_s}s load=[$load] mem=[$mem] disk=[$disk] temp=$temp throttled=$throttled $services ts=[$ts] route=[$route]"
[ -n "$errors" ] && emit "RECENT_ERRORS $errors"

printf 'LAST_BOOT_ID=%q\nLAST_UPTIME_S=%q\nLAST_WALL_S=%q\n' "$boot_id" "$uptime_s" "$wall_s" > "$STATE"
chmod 600 "$STATE" "$EVENTS"
