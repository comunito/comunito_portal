/**** CONFIG ****/
const FOLDER_ID  = '1cjciqwmqv7Y8a5_vaFZO1li1KjzRpjoh';
const LOG_SHEET  = 'Bitácora';
const TIMEZONE   = 'America/Mexico_City';
const MAX_ITEMS  = 30;

const COLUMNS = [
  { key: 'Principal-entrada',  label: 'Principal<br>Entrada'  },
  { key: 'Principal-salida',   label: 'Principal<br>Salida'   },
  { key: 'Secundaria-entrada', label: 'Secundaria<br>Entrada' },
  { key: 'Secundaria-salida',  label: 'Secundaria<br>Salida'  },
];

/**** doPost ****/
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(LOG_SHEET);
      sh.getRange(1,1,1,9).setValues([['Fecha','Hora','camera_name','cam','placa','usuario','categoria','snapshot_url','snapshot_direct']]);
      sh.setFrozenRows(1);
    }

    let obj = {}, file = null;

    if (e.postData && e.postData.type &&
        e.postData.type.toLowerCase().includes('application/json')) {
      obj = JSON.parse(e.postData.contents || '{}');
      if (obj.snapshot_b64) {
        try {
          const bytes  = Utilities.base64Decode(obj.snapshot_b64);
          const blob   = Utilities.newBlob(bytes, 'image/jpeg', 'snap_' + Date.now() + '.jpg');
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch(driveErr) { console.error('Drive error: ' + driveErr); }
      }
    } else {
      const p = e.parameters || {};
      Object.keys(p).forEach(k => obj[k] = Array.isArray(p[k]) ? p[k][0] : p[k]);
      if (e.files && e.files.snapshot) {
        try {
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(e.files.snapshot);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch(driveErr) { console.error('Drive multipart error: ' + driveErr); }
      }
    }

    const now   = new Date();
    const fecha = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    const hora  = Utilities.formatDate(now, TIMEZONE, 'HH:mm:ss');

    const camName = String(obj.camera_name || obj.dispositivo || '').trim();
    const placa   = String(obj.valor || obj.placa || '').trim();
    const usuario = String(obj.usuario || '').trim();
    const cat     = String(obj.category || obj.cat || obj.categoria || '').trim();
    const imgUrl  = file ? ('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400') : '';
    const viewUrl = file ? file.getUrl() : '';

    sh.insertRows(2, 1);
    sh.getRange(2,1,1,9).setValues([[fecha, hora, camName, String(obj.cam||''), placa, usuario, cat, imgUrl, viewUrl]]);

    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    console.error('doPost error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

/**** doGet ****/
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'feed') return feedJson_();
  return HtmlService.createHtmlOutput(buildHtml_()).setTitle('Bitácora Comunito').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function feedJson_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) return json_({});
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return json_({});

  const hdr = data[0];
  const iDate=hdr.indexOf('Fecha'), iTime=hdr.indexOf('Hora'),
        iCam=hdr.indexOf('camera_name'), iPlaca=hdr.indexOf('placa'),
        iUser=hdr.indexOf('usuario'), iCat=hdr.indexOf('categoria'),
        iImg=hdr.indexOf('snapshot_url'), iView=hdr.indexOf('snapshot_direct');

  const grouped = {};
  COLUMNS.forEach(c => grouped[c.key] = []);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cname = String(row[iCam]||'').trim();
    const col = COLUMNS.find(c => c.key.toLowerCase() === cname.toLowerCase());
    if (!col || grouped[col.key].length >= MAX_ITEMS) continue;
    grouped[col.key].push({
      fecha: String(row[iDate]||''), hora: String(row[iTime]||''),
      placa: String(row[iPlaca]||''), usuario: String(row[iUser]||''),
      cat:   String(row[iCat]||''),  img: String(row[iImg]||''),
      view:  String(row[iView]||''),
    });
  }
  return json_(grouped);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**** HTML de la bitácora ****/
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
const BASE_URL = window.location.href.split('?')[0];

function catClass(cat){
  const c=(cat||'').toLowerCase();
  if(c==='authorized'||c==='auth'||c==='activo') return 'auth';
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

async function loadFeed(){
  try{
    const r = await fetch(BASE_URL+'?action=feed&t='+Date.now());
    const data = await r.json();
    COLS.forEach(c => renderCol(c.key, data[c.key]||[]));
    document.getElementById('lastUpdate').textContent='Actualizado '+new Date().toLocaleTimeString('es-MX');
  } catch(err){
    document.getElementById('lastUpdate').textContent='Error al cargar';
  }
}
loadFeed();
setInterval(loadFeed, 30000);
</script>
</body>
</html>`;
}

function testAuth() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActive().getSheets();
  Logger.log('Auth OK');
}

function testDriveFolder() {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    Logger.log('Folder: ' + folder.getName());
    const f = folder.createFile(Utilities.newBlob('test','text/plain','test.txt'));
    f.setTrashed(true);
    Logger.log('Drive OK');
  } catch(e) { Logger.log('ERROR: ' + e); }
}
