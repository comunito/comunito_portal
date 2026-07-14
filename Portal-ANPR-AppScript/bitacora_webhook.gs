/**** CONFIG ****/
const FOLDER_ID = '1cjciqwmqv7Y8a5_vaFZO1li1KjzRpjoh';
const TIMEZONE = 'America/Mexico_City';

const COLUMNS = [
  { key: 'Principal-entrada',  label: 'Principal<br>Entrada'  },
  { key: 'Principal-salida',   label: 'Principal<br>Salida'   },
  { key: 'Secundaria-entrada', label: 'Secundaria<br>Entrada' },
  { key: 'Secundaria-salida',  label: 'Secundaria<br>Salida'  },
];

/**** ORDEN/ETIQUETAS BASE (Mantiene compatibilidad con hoja actual) ****/
const BASE_ORDER = ['cam','usuario','dispositivo','valor','disp_col_1','disp_col_2','disp_col_3'];
const LABELS = {
  'cam': 'Cam', 'usuario': 'Usuario', 'dispositivo': 'Dispositivo', 'valor': 'Valor',
  'disp_col_1': 'Disp col 1', 'disp_col_2': 'Disp col 2', 'disp_col_3': 'Disp col 3',
  '_snapshot_view': 'Snapshot View', '_snapshot_direct': 'Snapshot Direct'
};
const EXCLUDE_KEYS = new Set(['snapshot_b64', 'tz', 'iso_dt', 'fields', 'sheet_hint']);

/**** UTILIDADES ORIGINALES ****/
function todayParts_() {
  const now = new Date();
  return {
    fecha: Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd'),
    hora:  Utilities.formatDate(now, TIMEZONE, 'HH:mm:ss')
  };
}
function driveLinksFor_(file) {
  if (!file) return {viewLink:'', contentLink:''};
  if (file._err) return {viewLink:'ERROR: ' + file._err.slice(0,80), contentLink:''};
  const id = file.getId();
  return { viewLink: file.getUrl(), contentLink: 'https://drive.google.com/uc?export=download&id=' + id };
}
function insertAtRow2_(sh, rowArray) {
  sh.insertRows(2, 1);
  sh.getRange(2, 1, 1, rowArray.length).setValues([rowArray]);
}
function prettyLabel_(k) {
  if (LABELS[k]) return LABELS[k];
  return k.split('_').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}
function syncHeaders_(sh, orderedKeys) {
  const baseHeaders = ['Fecha','Hora'].concat(BASE_ORDER.map(k => prettyLabel_(k)))
    .concat([LABELS['_snapshot_view'], LABELS['_snapshot_direct']]);
  const extras = [];
  for (const k of orderedKeys) {
    if (BASE_ORDER.includes(k) || EXCLUDE_KEYS.has(k)) continue;
    extras.push(prettyLabel_(k));
  }
  const desired = baseHeaders.concat(extras);
  const maxCols = desired.length;
  const r1 = sh.getRange(1, 1, 1, Math.max(maxCols, sh.getMaxColumns())).getValues()[0];
  const isEmpty = r1.every(v => v === '' || v == null);
  if (isEmpty) {
    sh.getRange(1, 1, 1, desired.length).setValues([desired]);
    return desired;
  }
  const current = r1.slice(0, r1.findLastIndex(v => v !== '' && v != null) + 1);
  const toAdd = desired.filter(h => !current.includes(h) && h && h !== '');
  if (toAdd.length > 0) {
    const newHeader = current.concat(toAdd);
    sh.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
    return newHeader;
  }
  return current;
}
function buildRowByHeader_(header, baseMap, extrasMap, snapshotLinks) {
  const { viewLink, contentLink } = snapshotLinks || {viewLink:'', contentLink:''};
  const dataMap = Object.assign({}, extrasMap, baseMap);
  dataMap[LABELS['_snapshot_view']] = viewLink;
  dataMap[LABELS['_snapshot_direct']] = contentLink;
  const {fecha, hora} = todayParts_();
  const row = new Array(header.length).fill('');
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h === 'Fecha') { row[i] = fecha; continue; }
    if (h === 'Hora')  { row[i] = hora;  continue; }
    const invBase = {};
    for (const k of BASE_ORDER) invBase[prettyLabel_(k)] = k;
    if (invBase[h]) {
      const k = invBase[h];
      row[i] = baseMap[h] != null ? baseMap[h] : (dataMap[k] != null ? String(dataMap[k]) : '');
      continue;
    }
    if (h === LABELS['_snapshot_view'])  { row[i] = viewLink; continue; }
    if (h === LABELS['_snapshot_direct']){ row[i] = contentLink; continue; }
    row[i] = extrasMap[h] != null ? String(extrasMap[h]) : '';
  }
  return row;
}
function splitBaseAndExtras_(obj) {
  const orderedKeys = Object.keys(obj || {});
  const baseMap = {};
  const extrasMap = {};
  for (const k of BASE_ORDER) {
    const label = prettyLabel_(k);
    baseMap[label] = (obj && obj[k] != null) ? String(obj[k]) : '';
  }
  for (const k of orderedKeys) {
    if (BASE_ORDER.includes(k) || EXCLUDE_KEYS.has(k)) continue;
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    const label = prettyLabel_(k);
    if (!(label in extrasMap)) { extrasMap[label] = s; }
  }
  return { orderedKeys, baseMap, extrasMap };
}

/**** doPost (IDÉNTICO AL ORIGINAL PARA NO ROMPER LA HOJA) ****/
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheets()[0]; // Usa la primera hoja automáticamente (Hoja 1)
    let file = null, obj = {}, orderedKeys = [];

    if (e.postData && e.postData.type && e.postData.type.toLowerCase().indexOf('application/json') !== -1) {
      obj = JSON.parse(e.postData.contents || '{}');
      if (obj.snapshot_b64) {
        try {
          const bytes = Utilities.base64Decode(obj.snapshot_b64);
          const blob = Utilities.newBlob(bytes, 'image/jpeg', 'snap_' + Date.now() + '.jpg');
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (driveErr) { file = { _err: String(driveErr) }; }
      }
      orderedKeys = Object.keys(obj);
    } else {
      const p = e.parameters || {};
      const tmp = {};
      Object.keys(p).forEach(k => tmp[k] = Array.isArray(p[k]) ? p[k][0] : p[k]);
      orderedKeys = BASE_ORDER.slice();
      Object.keys(tmp).sort().forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
      if (e.files && e.files.snapshot) {
        try {
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(e.files.snapshot);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (driveErr) { file = null; }
      }
      obj = tmp;
    }

    const { baseMap, extrasMap } = splitBaseAndExtras_(obj);
    const headerOrderForSync = BASE_ORDER.concat(['_snapshot_view','_snapshot_direct'])
      .concat(orderedKeys.filter(k => !BASE_ORDER.includes(k) && !EXCLUDE_KEYS.has(k)));
    const header = syncHeaders_(sh, headerOrderForSync);
    const links = file ? driveLinksFor_(file) : {viewLink:'', contentLink:''};
    const row = buildRowByHeader_(header, baseMap, extrasMap, links);
    insertAtRow2_(sh, row);

    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

/**** doGet (NUEVO DASHBOARD) ****/
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'feed') return feedJson_();
  return HtmlService.createHtmlOutput(buildHtml_()).setTitle('Bitácora Comunito').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getFeedData() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheets()[0];
  if (!sh) return {};
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return {};

  const hdr = data[0];
  const iDate=hdr.indexOf('Fecha'), iTime=hdr.indexOf('Hora'),
        iCam=hdr.indexOf('Cam'), iPlaca=hdr.indexOf('Valor'),
        iUser=hdr.indexOf('Disp col 2'), iCat=hdr.indexOf('Usuario'),
        iView=hdr.indexOf('Snapshot View');

  const grouped = {};
  COLUMNS.forEach(c => grouped[c.key] = []);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Convertir de "1 - Principal-salida" a "Principal-salida"
    let rawCam = String(row[iCam]||'').trim();
    if(rawCam.includes('-')) {
      rawCam = rawCam.substring(rawCam.indexOf('-')+1).trim();
    }
    
    const col = COLUMNS.find(c => c.key.toLowerCase() === rawCam.toLowerCase());
    if (!col || grouped[col.key].length >= 30) continue;
    
    // Extraer ID de Drive del Snapshot View link para crear el thumbnail
    let imgUrl = '';
    const viewLink = String(row[iView]||'');
    const match = viewLink.match(/id=([a-zA-Z0-9_-]+)/) || viewLink.match(/d\/([a-zA-Z0-9_-]+)/);
    if(match && match[1]) {
      imgUrl = 'https://drive.google.com/thumbnail?sz=w400&id=' + match[1];
    }
    
    grouped[col.key].push({
      fecha: String(row[iDate]||''), hora: String(row[iTime]||''),
      placa: String(row[iPlaca]||''), usuario: String(row[iUser]||''),
      cat:   String(row[iCat]||''),  img: imgUrl,
      view:  viewLink
    });
  }
  return grouped;
}

function feedJson_() {
  return ContentService.createTextOutput(JSON.stringify(getFeedData())).setMimeType(ContentService.MimeType.JSON);
}

/**** HTML DASHBOARD ****/
function buildHtml_() {
  const colsJson = JSON.stringify(COLUMNS);
  const colHeaders = COLUMNS.map(c =>
    `<div class="col" id="col-${c.key.replace(/[^a-z0-9]/gi,'_')}">
      <div class="col-header">
        <h2>${c.label}</h2>
        <div class="count" id="count-${c.key.replace(/[^a-z0-9]/gi,'_')}">—</div>
      </div>
      <div class="items" id="items-${c.key.replace(/[^a-z0-9]/gi,'_')}"><div class="loading">Cargando...</div></div>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bitácora Comunito</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
header{background:linear-gradient(135deg,#1a1f35,#0f1117);border-bottom:1px solid #2d3748;
  padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
header h1{font-size:1.2rem;font-weight:700}
.badge{background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;font-size:.68rem;
  font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:.8px;text-transform:uppercase}
.auto-badge{margin-left:auto;font-size:.73rem;color:#64748b;display:flex;align-items:center;gap:6px}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.grid{display:grid;grid-template-columns:repeat(4,1fr);height:calc(100vh - 57px)}
.col{border-right:1px solid #1e293b;display:flex;flex-direction:column;overflow:hidden}
.col:last-child{border-right:none}
.col-header{background:#1a2235;padding:13px 12px 11px;text-align:center;
  border-bottom:2px solid #6366f1;flex-shrink:0}
.col-header h2{font-size:.88rem;font-weight:700;color:#c7d2fe;line-height:1.35}
.count{font-size:.7rem;color:#64748b;margin-top:2px}
.items{overflow-y:auto;flex:1;padding:8px 7px;display:flex;flex-direction:column;gap:7px}
.items::-webkit-scrollbar{width:3px}
.items::-webkit-scrollbar-thumb{background:#2d3748;border-radius:3px}
.loading{color:#475569;font-size:.78rem;text-align:center;padding:30px 0}
.card{background:#1e293b;border:1px solid #2d3748;border-radius:9px;overflow:hidden;
  transition:transform .12s,border-color .12s}
.card:hover{transform:scale(1.013);border-color:#6366f1}
.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#0f1117}
.no-img{width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;
  background:#1a2235;color:#334155;font-size:.72rem}
.meta{padding:7px 9px 8px}
.plate{font-size:1rem;font-weight:700;letter-spacing:2px;color:#fff;background:#1a2235;
  border-radius:5px;padding:3px 8px;display:inline-block;margin-bottom:4px;border:1px solid #334155}
.plate.auth{background:linear-gradient(90deg,#14532d,#166534);border-color:#22c55e;color:#86efac}
.plate.notfound{background:linear-gradient(90deg,#7f1d1d,#991b1b);border-color:#ef4444;color:#fca5a5}
.plate.visitor{background:linear-gradient(90deg,#1e3a5f,#1e40af);border-color:#60a5fa;color:#bfdbfe}
.info-row{display:flex;justify-content:space-between;align-items:center;margin-top:2px}
.user{font-size:.7rem;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%}
.ts{font-size:.66rem;color:#475569}
.view-link{font-size:.63rem;color:#6366f1;text-decoration:none;display:block;
  margin-top:3px;text-align:right}
.view-link:hover{color:#818cf8}
.empty{color:#334155;font-size:.78rem;text-align:center;padding:40px 10px}
@media(max-width:860px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:460px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <span style="font-size:1.4rem">🔍</span>
  <h1>Bitácora de Ingresos</h1>
  <span class="badge">Comunito ALPR</span>
  <div class="auto-badge">
    <span class="dot"></span>
    <span id="lastUpdate">Cargando...</span>
  </div>
</header>
<div class="grid">${colHeaders}</div>
<script>
const COLS = ${colsJson};

function catClass(cat){
  const c=(cat||'').toLowerCase();
  if(c==='authorized'||c==='auth'||c==='activo'||c==='propietario') return 'auth';
  if(c==='visitor'||c==='visitante') return 'visitor';
  if(c==='notfound'||c==='not_found'||c==='inactivo') return 'notfound';
  return '';
}

function renderCol(key, items){
  const sk = key.replace(/[^a-z0-9]/gi,'_');
  const el = document.getElementById('items-'+sk);
  const cnt = document.getElementById('count-'+sk);
  if(!el) return;
  cnt.textContent = items.length + ' registro' + (items.length!==1?'s':'');
  if(!items.length){ el.innerHTML='<div class="empty">Sin registros</div>'; return; }
  el.innerHTML = items.map(r => {
    const cls = catClass(r.cat);
    const imgHtml = r.img
      ? '<img src="'+r.img+'" alt="snap" loading="lazy" onerror="this.parentNode.innerHTML=\'<div class=no-img>Sin imagen</div>\'">'
      : '<div class="no-img">Sin imagen</div>';
    const plate = r.placa||'—';
    const user  = r.usuario && r.usuario!=='-' ? r.usuario : '';
    const ts    = (r.fecha||'').slice(5)+' '+(r.hora||'').slice(0,5);
    const link  = r.view ? '<a class="view-link" href="'+r.view+'" target="_blank">↗ Ver original</a>' : '';
    return '<div class="card">'+imgHtml+'<div class="meta"><div class="plate '+cls+'">'+plate+'</div><div class="info-row"><span class="user">'+user+'</span><span class="ts">'+ts+'</span></div>'+link+'</div></div>';
  }).join('');
}

function loadFeed(){
  google.script.run
    .withSuccessHandler(function(data) {
      COLS.forEach(c => renderCol(c.key, data[c.key]||[]));
      document.getElementById('lastUpdate').textContent='Actualizado '+new Date().toLocaleTimeString('es-MX');
    })
    .withFailureHandler(function(err) {
      document.getElementById('lastUpdate').textContent='Error al cargar';
      console.error(err);
    })
    .getFeedData();
}
loadFeed();
setInterval(loadFeed, 30000);
</script>
</body>
</html>`;
}
