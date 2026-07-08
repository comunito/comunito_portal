/**** CONFIG ****/
const FOLDER_ID = '1cjciqwmqv7Y8a5_vaFZO1li1KjzRpjoh';  // Carpeta de Drive para snapshots
const SHEET_NAME = SpreadsheetApp.getActive().getActiveSheet().getName();
const TIMEZONE = 'America/Mexico_City';

/**** ORDEN/ETIQUETAS BASE ****/
const BASE_ORDER = [
  'cam',
  'usuario',
  'dispositivo',
  'valor',
  'disp_col_1',
  'disp_col_2',
  'disp_col_3'
];

const LABELS = {
  'cam': 'Cam',
  'usuario': 'Usuario',
  'dispositivo': 'Dispositivo',
  'valor': 'Valor',
  'disp_col_1': 'Disp col 1',
  'disp_col_2': 'Disp col 2',
  'disp_col_3': 'Disp col 3',
  '_snapshot_view': 'Snapshot View',
  '_snapshot_direct': 'Snapshot Direct'
};

const EXCLUDE_KEYS = new Set([
  'snapshot_b64', 'tz', 'iso_dt', 'fields', 'sheet_hint'
]);

/**** UTIL ****/
function todayParts_() {
  const now = new Date();
  const fecha = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  const hora  = Utilities.formatDate(now, TIMEZONE, 'HH:mm:ss');
  return {fecha, hora};
}

function driveLinksFor_(file) {
  const id = file.getId();
  const viewLink = file.getUrl();
  const contentLink = 'https://drive.google.com/uc?export=download&id=' + id;
  return {viewLink, contentLink};
}

function insertAtRow2_(sh, rowArray) {
  sh.insertRows(2, 1);
  sh.getRange(2, 1, 1, rowArray.length).setValues([rowArray]);
}

function prettyLabel_(k) {
  if (LABELS[k]) return LABELS[k];
  return k.split('_')
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ');
}

function syncHeaders_(sh, orderedKeys) {
  const baseHeaders = ['Fecha','Hora']
    .concat(BASE_ORDER.map(k => prettyLabel_(k)))
    .concat([LABELS['_snapshot_view'], LABELS['_snapshot_direct']]);

  const extras = [];
  for (const k of orderedKeys) {
    if (BASE_ORDER.includes(k)) continue;
    if (EXCLUDE_KEYS.has(k)) continue;
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
    if (BASE_ORDER.includes(k)) continue;
    if (EXCLUDE_KEYS.has(k)) continue;
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    const label = prettyLabel_(k);
    if (!(label in extrasMap)) {
      extrasMap[label] = s;
    }
  }
  return { orderedKeys, baseMap, extrasMap };
}

/**** HANDLER ****/
function doPost(e) {
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);

    let file = null;
    let obj = {};
    let orderedKeys = [];

    // --- Caso A: JSON (application/json) ---
    if (e.postData && e.postData.type &&
        e.postData.type.toLowerCase().indexOf('application/json') !== -1) {

      obj = JSON.parse(e.postData.contents || '{}');

      // *** FIX CRÍTICO: Drive en try-catch AISLADO ***
      // Si DriveApp falla (permisos, carpeta inaccesible, cuota),
      // file queda null y la fila SE REGISTRA IGUAL sin imagen.
      if (obj.snapshot_b64) {
        try {
          const bytes = Utilities.base64Decode(obj.snapshot_b64);
          const blob = Utilities.newBlob(bytes, 'image/jpeg', 'snap_' + Date.now() + '.jpg');
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(blob);
          // Descomentar para compartir públicamente:
          // file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (driveErr) {
          // Error de Drive no interrumpe el registro de la fila
          console.error('Drive snapshot error: ' + String(driveErr));
          file = null;
        }
      }

      orderedKeys = Object.keys(obj);

    } else {
      // --- Caso B: multipart/form-data ---
      const p = e.parameters || {};
      const tmp = {};
      Object.keys(p).forEach(k => tmp[k] = Array.isArray(p[k]) ? p[k][0] : p[k]);

      orderedKeys = BASE_ORDER.slice();
      Object.keys(tmp).sort().forEach(k => {
        if (!orderedKeys.includes(k)) orderedKeys.push(k);
      });

      // *** FIX CRÍTICO: mismo patrón para multipart ***
      if (e.files && e.files.snapshot) {
        try {
          const snapBlob = e.files.snapshot;
          const folder = DriveApp.getFolderById(FOLDER_ID);
          file = folder.createFile(snapBlob);
        } catch (driveErr) {
          console.error('Drive snapshot error (multipart): ' + String(driveErr));
          file = null;
        }
      }

      obj = tmp;
    }

    // Separa base/extras
    const { baseMap, extrasMap } = splitBaseAndExtras_(obj);

    const headerOrderForSync = BASE_ORDER.concat(['_snapshot_view','_snapshot_direct'])
      .concat(orderedKeys.filter(k => !BASE_ORDER.includes(k) && !EXCLUDE_KEYS.has(k)));
    const header = syncHeaders_(sh, headerOrderForSync);

    // Links de snapshot (vacíos si Drive falló o no había snapshot)
    const links = file ? driveLinksFor_(file) : {viewLink:'', contentLink:''};

    const row = buildRowByHeader_(header, baseMap, extrasMap, links);

    // Inserta en fila 2 (más reciente primero)
    insertAtRow2_(sh, row);

    return ContentService
      .createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost global error: ' + String(err));
    return ContentService
      .createTextOutput(JSON.stringify({ok: false, error: String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function testAuth() {
  // Ejecutar manualmente UNA VEZ para autorizar permisos de Drive y Sheets
  DriveApp.getRootFolder();
  SpreadsheetApp.getActive().getSheets();
  Logger.log('Auth OK - permisos de Drive y Sheets autorizados');
}
