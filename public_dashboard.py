#!/usr/bin/env python3
"""Read-only public status dashboard for the two Comunito casetas."""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template_string


app = Flask(__name__)
POLL_SECONDS = max(1, int(os.getenv("POLL_SECONDS", "2")))
NODES = {
    "Real Navarra acceso 1": os.getenv("PRIMARY_URL", "http://127.0.0.1:5000"),
    "Real Navarra acceso 2": os.getenv("SECONDARY_URL", "http://100.112.144.53:5000"),
}
cache_lock = threading.Lock()
cache = {name: {"name": name, "online": False, "error": "Inicializando"} for name in NODES}
history_lock = threading.Lock()
history_path = Path(os.getenv("STATE_FILE", "/var/lib/comunito-public-dashboard/history.json"))
history = []
last_seen = {}


def load_history() -> None:
    global history
    try:
        with history_path.open(encoding="utf-8") as fh:
            loaded = json.load(fh)
        history = loaded[:50] if isinstance(loaded, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        history = []


def save_history() -> None:
    history_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = history_path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(history[:50], fh, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, history_path)


def remember_readings(nodes: dict) -> None:
    changed = False
    with history_lock:
        for name, node in nodes.items():
            for cam in node.get("cameras", []):
                plate = (cam.get("plate") or "").strip()
                ts = float(cam.get("detected_ts") or 0)
                key = f"{name}|cam{cam.get('cam')}"
                previous = last_seen.get(key, (0.0, ""))
                if plate and plate != "Sin lectura" and (ts > previous[0] or plate != previous[1]):
                    history.insert(0, {
                        "ts": ts or time.time(), "source": name, "cam": cam.get("cam"),
                        "plate": plate, "confidence": cam.get("confidence"),
                        "authorized": bool(cam.get("authorized")),
                    })
                    history[:] = history[:50]
                    last_seen[key] = (ts, plate)
                    changed = True
        if changed:
            save_history()


def get_json(base: str, path: str) -> dict:
    response = requests.get(f"{base}{path}", timeout=2.5)
    response.raise_for_status()
    return response.json()


def public_node_status(name: str, base: str) -> dict:
    result = {"name": name, "online": False, "cameras": [], "whitelist": [], "error": ""}
    try:
        health = requests.get(f"{base}/healthz", timeout=2.5)
        result["online"] = health.ok
        result["health"] = health.text.strip()
        net = get_json(base, "/api/net")
        sys = get_json(base, "/api/sys")
        motion = get_json(base, "/api/motion")
        wl = get_json(base, "/api/whitelist_status")
        result["temperature_c"] = sys.get("temp_c")
        result["cpu_pct"] = sys.get("cpu_pct")
        result["gate_connected"] = bool((motion.get("gate_serial") or {}).get("connected"))
        for cam in (1, 2):
            status = get_json(base, f"/api/status?cam={cam}")
            motion_cam = motion.get(f"cam{cam}") or {}
            current_plate = (status.get("plate") or "").strip()
            with history_lock:
                previous = next((item for item in history if item.get("source") == name and item.get("cam") == cam), None)
            showing_previous = not bool(current_plate) and bool(previous)
            result["cameras"].append({
                "cam": cam,
                "connected": f"CAM{cam}:OK" in result.get("health", ""),
                "plate": current_plate or (previous or {}).get("plate") or "Sin lectura",
                "confidence": status.get("conf") if current_plate else (previous or {}).get("confidence"),
                "detected_ts": status.get("ts") if current_plate else (previous or {}).get("ts"),
                "authorized": bool(status.get("auth")) if current_plate else bool((previous or {}).get("authorized")),
                "showing_previous": showing_previous,
                "motion": bool(motion_cam.get("active")),
                "last_sent": motion_cam.get("queue", {}).get("sent", 0),
            })
            w = wl.get("cameras", {}).get(f"cam{cam}") or {}
            result["whitelist"].append({
                "cam": cam,
                "last_refresh_ts": w.get("last_refresh_ts"),
                "refresh_min": max(w.get("owners_refresh_min", 0), w.get("visitors_refresh_min", 0)),
            })
        result["updated_at"] = time.time()
    except Exception as exc:
        result["error"] = type(exc).__name__
        result["updated_at"] = time.time()
    return result


def poll_loop() -> None:
    global cache
    while True:
        fresh = {name: public_node_status(name, base) for name, base in NODES.items()}
        with cache_lock:
            cache = fresh
        remember_readings(fresh)
        time.sleep(POLL_SECONDS)


@app.get("/api/public-status")
def public_status():
    with cache_lock:
        nodes = list(cache.values())
    with history_lock:
        recent = list(history[:50])
    return jsonify({"updated_at": time.time(), "nodes": nodes, "history": recent})


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True, "service": "comunito-public-dashboard"})


PAGE = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comunito · Estado de casetas</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f4f6f8;color:#18202a}
header{background:#17212b;color:#fff;padding:22px 5vw}h1{margin:0 0 5px;font-size:clamp(22px,4vw,34px)}
main{max-width:1180px;margin:24px auto;padding:0 18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
.card{background:#fff;border:1px solid #dce2e8;border-radius:14px;padding:18px;box-shadow:0 2px 10px #1220330d}
.title{display:flex;justify-content:space-between;gap:10px;align-items:center}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c43d3d;margin-right:7px}.on{background:#218739}
.muted{color:#647180;font-size:13px}.metrics{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}.metric b{display:block;font-size:20px}.cam{border-top:1px solid #e8edf1;padding:13px 0}.cam:first-of-type{border-top:0}
.plate{font-size:25px;font-weight:750;letter-spacing:.06em}.ok{color:#218739}.bad{color:#b42318}.small{font-size:12px;color:#647180}.wl{margin-top:14px;background:#f7f9fa;border-radius:9px;padding:10px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px 8px;border-top:1px solid #e8edf1;text-align:left;white-space:nowrap}th{font-size:12px;color:#647180;background:#f7f9fa}
footer{max-width:1180px;margin:20px auto;padding:0 18px;color:#647180;font-size:12px}
</style></head><body><header><h1>Comunito · Estado de casetas</h1><div>Lecturas automáticas y estado operativo · actualización continua</div></header>
<main><div id="app" class="grid"><div class="card">Cargando estado…</div></div><section class="card" style="margin-top:18px"><div class="title"><h2>Últimas 50 lecturas</h2><span class="muted">Historial por cámara</span></div><div style="overflow:auto"><table><thead><tr><th>Hora</th><th>Acceso 1 · Entrada</th><th>Acceso 1 · Salida</th><th>Acceso 2 · Entrada</th><th>Acceso 2 · Salida</th></tr></thead><tbody id="history"><tr><td colspan="5" class="muted">Cargando…</td></tr></tbody></table></div></section></main><footer>Vista pública de solo lectura. Los portales de administración permanecen protegidos.</footer>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function time(ts){return ts?new Date(ts*1000).toLocaleString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Pendiente';}
function render(d){document.querySelector('#app').innerHTML=d.nodes.map(n=>`<section class="card">
<div class="title"><h2>${esc(n.name)}</h2><span class="${n.online?'ok':'bad'}"><i class="dot ${n.online?'on':''}"></i>${n.online?'En línea':'Sin conexión'}</span></div>
<div class="metrics"><div class="metric"><span class="muted">Temperatura</span><b>${n.temperature_c==null?'—':esc(Number(n.temperature_c).toFixed(1))}°C</b></div><div class="metric"><span class="muted">CPU</span><b>${n.cpu_pct==null?'—':esc(Number(n.cpu_pct).toFixed(0))}%</b></div><div class="metric"><span class="muted">Pluma</span><b>${n.gate_connected?'Conectada':'—'}</b></div></div>
${(n.cameras||[]).map(c=>`<div class="cam"><div class="muted">Cam ${c.cam} · ${c.connected?'Conectada':'Sin conexión'} ${c.motion?'· Movimiento':''}</div><div class="plate">${esc(c.plate)}</div><div class="small">${c.authorized?'Autorizada':'Sin autorización'} · Confianza ${c.confidence==null?'—':esc((Number(c.confidence)*100).toFixed(0))}% · ${c.detected_ts?'Leída '+time(c.detected_ts):'Sin lectura registrada'}</div></div>`).join('')}
<div class="wl"><b>Whitelist</b><br>${(n.whitelist||[]).map(w=>`Cam ${w.cam}: última actualización ${time(w.last_refresh_ts)}${w.refresh_min?' · cada '+w.refresh_min+' min':''}`).join('<br>')}</div>
<div class="small">Última consulta: ${time(n.updated_at)}${n.error?' · '+esc(n.error):''}</div></section>`).join('');
const cols=['Real Navarra acceso 1|1','Real Navarra acceso 1|2','Real Navarra acceso 2|1','Real Navarra acceso 2|2'];
document.querySelector('#history').innerHTML=(d.history||[]).map(e=>`<tr><td>${time(e.ts)}</td>${cols.map(k=>`<td>${k===e.source+'|'+e.cam?'<b>'+esc(e.plate)+'</b>':'—'}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="5" class="muted">Aún no hay lecturas registradas.</td></tr>';
}
async function refresh(){try{const r=await fetch('/api/public-status',{cache:'no-store'});render(await r.json())}catch(e){document.querySelector('#app').innerHTML='<div class="card">No se pudo consultar el estado.</div>'}}
refresh();setInterval(refresh,2000);
</script></body></html>"""


@app.get("/")
def index():
    return render_template_string(PAGE)


load_history()
threading.Thread(target=poll_loop, daemon=True, name="status-poller").start()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5100")), threaded=True)
