#!/usr/bin/env python3
"""Read-only public status dashboard for the two Comunito casetas."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

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
            result["cameras"].append({
                "cam": cam,
                "connected": f"CAM{cam}:OK" in result.get("health", ""),
                "plate": status.get("plate") or "Sin lectura",
                "confidence": status.get("conf"),
                "authorized": bool(status.get("auth")),
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
        time.sleep(POLL_SECONDS)


@app.get("/api/public-status")
def public_status():
    with cache_lock:
        nodes = list(cache.values())
    return jsonify({"updated_at": time.time(), "nodes": nodes})


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
footer{max-width:1180px;margin:20px auto;padding:0 18px;color:#647180;font-size:12px}
</style></head><body><header><h1>Comunito · Estado de casetas</h1><div>Lecturas automáticas y estado operativo · actualización continua</div></header>
<main><div id="app" class="grid"><div class="card">Cargando estado…</div></div></main><footer>Vista pública de solo lectura. Los portales de administración permanecen protegidos.</footer>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function time(ts){return ts?new Date(ts*1000).toLocaleString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Pendiente';}
function render(d){document.querySelector('#app').innerHTML=d.nodes.map(n=>`<section class="card">
<div class="title"><h2>${esc(n.name)}</h2><span class="${n.online?'ok':'bad'}"><i class="dot ${n.online?'on':''}"></i>${n.online?'En línea':'Sin conexión'}</span></div>
<div class="metrics"><div class="metric"><span class="muted">Temperatura</span><b>${n.temperature_c==null?'—':esc(Number(n.temperature_c).toFixed(1))}°C</b></div><div class="metric"><span class="muted">CPU</span><b>${n.cpu_pct==null?'—':esc(Number(n.cpu_pct).toFixed(0))}%</b></div><div class="metric"><span class="muted">Pluma</span><b>${n.gate_connected?'Conectada':'—'}</b></div></div>
${(n.cameras||[]).map(c=>`<div class="cam"><div class="muted">Cam ${c.cam} · ${c.connected?'Conectada':'Sin conexión'} ${c.motion?'· Movimiento':''}</div><div class="plate">${esc(c.plate)}</div><div class="small">${c.authorized?'Autorizada':'Sin autorización'} · Confianza ${c.confidence==null?'—':esc((Number(c.confidence)*100).toFixed(0))}%</div></div>`).join('')}
<div class="wl"><b>Whitelist</b><br>${(n.whitelist||[]).map(w=>`Cam ${w.cam}: última actualización ${time(w.last_refresh_ts)}${w.refresh_min?' · cada '+w.refresh_min+' min':''}`).join('<br>')}</div>
<div class="small">Última consulta: ${time(n.updated_at)}${n.error?' · '+esc(n.error):''}</div></section>`).join('');}
async function refresh(){try{const r=await fetch('/api/public-status',{cache:'no-store'});render(await r.json())}catch(e){document.querySelector('#app').innerHTML='<div class="card">No se pudo consultar el estado.</div>'}}
refresh();setInterval(refresh,2000);
</script></body></html>"""


@app.get("/")
def index():
    return render_template_string(PAGE)


threading.Thread(target=poll_loop, daemon=True, name="status-poller").start()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5100")), threaded=True)
