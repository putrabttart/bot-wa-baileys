const ENDPOINT_URL = 'https://bot-pbs.putrabttstorebot.my.id/products/refresh';   // ganti ke domain Cloudflare kamu
const REFRESH_KEY  = 'JANGAN_LUPA_MAKAN';          // sama persis dengan di bot

/*********** CONFIG ***********/
const SHEET_ID   = '1QKZb5BXVqrNyxcrA6mbL1sII2hkZ2MMS1KqRr6pzf-4'; // ID Spreadsheet
const SECRET     = 'rahasia-super-aman';                            // == GAS_SECRET di server
const BOT_URL    = 'https://bot-pbs.putrabttstorebot.my.id';        // Base URL bot (tunnel/railway)
const BOT_SECRET = 'supersecret-bot';                                // == ADMIN_WEBHOOK_SECRET

function pingBotRefresh() {
  var opts = {
    method: 'post',
    headers: { 'x-refresh-key': REFRESH_KEY },
    muteHttpExceptions: true
  };
  var res = UrlFetchApp.fetch(ENDPOINT_URL, opts);
  console.log('refresh', res.getResponseCode(), res.getContentText());
}

// Trigger “On change” (disarankan) agar kena semua perubahan (edit/paste/import/insert/delete)
// function onChange(e) {
//   try { pingBotRefresh(); } catch (err) { console.error(err); }
// }

function listFilesInFolder() {
  const folderId = '1xh20J-jL1KEzHEqbw0vidjnmNEB51YK5'; // Ganti dengan folder ID dari URL folder Drive
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const rows = [];
  while (files.hasNext()) {
    const f = files.next();
    rows.push([
      'capcut_1b',           // kode_produk
      f.getId(),             // file_id
      f.getName(),           // file_name
      'available',           // status
      '', '', '', '', 0, ''  // kolom sisanya
    ]);
  }
  const sh = SpreadsheetApp.getActive().getSheetByName('Inventory');
  sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  Logger.log(`Selesai. ${rows.length} file ditambahkan.`);
}

// stok per sheet (prefix→sheet) + default
const DEFAULT_STOCK_SHEET = 'stok_lain';
const SHEET_MAP = {
  ytb: 'stok_youtube',
  netf: 'stok_netflix',
  gpt1bf: 'stok_gpt1bf',
  spo: 'stok_lain',
  viu: 'stok_lain',
  gone: 'stok_lain',
  vidprime: 'stok_lain',
  zoom: 'stok_lain',
  iqiyi: 'stok_lain',
  disney: 'stok_lain',
  canva: 'stok_lain',
  capcutpro: 'stok_capcut',
  vidtv: 'stok_lain',
  vidhp: 'stok_lain',
  expvpn: 'stok_lain',
  perplex: 'stok_lain',
  alight: 'stok_alight',
};

// Nama tab
const ORDERLOG_NAME = 'OrderLog';
const PRODUK_NAME   = 'Produk';

// TTL hold (menit) dan threshold low-stock
const HOLD_TTL_MIN        = 10;
const LOW_STOCK_THRESHOLD = 3;

/*********** TEMPLATE CONFIG ***********/
// Mapping prefix/kode → nama sheet template (kolom A diisi baris-baris template)
const TEMPLATE_SHEETS = {
  netf: 'template_netflix',
  ytb:  'template_youtube',
  capcutpro: 'template_capcut',
  cc1b: 'template_capcut',
  capcut: 'template_capcut',
  alight: 'template_alight',
  gpt1bf: 'template_gpt1bf',
  default: 'template_default' // opsional fallback
};

/*********** UTIL ***********/
function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function getSS(){ return SpreadsheetApp.openById(SHEET_ID); }
function getSheetByNameCI(ss, wanted) {
  return ss.getSheets().find(sh => (sh.getName()+'').trim().toLowerCase() === (wanted+'').trim().toLowerCase()) || null;
}
function listStockSheets(ss){
  return ss.getSheets().filter(sh => (sh.getName()+'').toLowerCase().startsWith('stok_'));
}
function findHeaderRow(values){
  for (let r=0; r<Math.min(values.length,10); r++){
    const row = values[r].map(x => (x+'').trim().toLowerCase());
    if (row.includes('kode') && row.includes('status')) return r;
  }
  return 0;
}
function headerIndex(header){
  const h = header.map(x => (x+'').trim().toLowerCase());
  const idx = {};
  ['kode','data','status','order_id','buyer_jid','created_at','updated_at','hold_until'].forEach(k=> idx[k]=h.indexOf(k));
  // tolerate alternative column spellings seen in sheets
  if (idx.created_at < 0) idx.created_at = h.indexOf('created') >= 0 ? h.indexOf('created') : h.indexOf('created_ev');
  if (idx.updated_at < 0) idx.updated_at = h.indexOf('updated') >= 0 ? h.indexOf('updated') : h.indexOf('updated_ev');
  return idx;
}
function getPrefix(kode){ const m=(kode||'').match(/^[a-z]+/i); return (m?m[0]:'').toLowerCase(); }
function getStockSheetNameForKode(kode){
  const ss = getSS();
  const k = (kode || '').toLowerCase().trim();
  const pref = getPrefix(k); // misal kode 'ytb1bf' → pref 'ytb'

  // --- 1) Cari stok_ sheet yang cocok otomatis ---
  const sheets = ss.getSheets();
  const stokSheets = sheets
    .map(sh => sh.getName())
    .filter(name => /^stok_/i.test(name)); // semua yang diawali 'stok_'

  let bestMatch = null;

  // Kita pakai suffix setelah "stok_"
  // lalu cari yang suffix-nya adalah prefix dari kode atau prefix
  const bases = [k, pref].filter(Boolean); // misal ['ytb1bf','ytb']

  stokSheets.forEach(name => {
    const lower = name.toLowerCase();
    const suffix = lower.replace(/^stok_/, ''); // stok_youtube → 'youtube'
    if (!suffix) return;

    for (const base of bases){
      // Contoh:
      // base = 'capcutpro1', suffix = 'capcutpro' → match
      // base = 'ytb1bf' , suffix = 'ytb' → match
      if (base.startsWith(suffix)){
        if (!bestMatch || suffix.length > bestMatch.suffix.length){
          bestMatch = { suffix, name };
        }
      }
    }
  });

  if (bestMatch) {
    return bestMatch.name; // nama sheet asli (case sensitive)
  }

  // --- 2) Kalau mau tetap pakai mapping manual sebagai override ---
  if (SHEET_MAP[k])    return SHEET_MAP[k];
  if (SHEET_MAP[pref]) return SHEET_MAP[pref];

  // --- 3) Fallback terakhir ke default ---
  return DEFAULT_STOCK_SHEET;
}

function readTable(sh){
  const vals = sh.getDataRange().getValues();
  if (vals.length<1) return { header:[], rows:[], headerRow:0 };
  const headerRow = findHeaderRow(vals);
  const header    = vals[headerRow];
  const rows      = vals.slice(headerRow+1);
  return { header, rows, headerRow };
}
function writeRowsBack(sh, headerRow, headerLen, rows){
  if (!rows.length) return;
  sh.getRange(headerRow+2, 1, rows.length, headerLen).setValues(rows);
}
function postBot(path, body){
  try {
    const url = BOT_URL.replace(/\/+$/,'') + path;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    return { code: res.getResponseCode(), text: res.getContentText() };
  } catch(e){
    return { code: 0, text: String(e) };
  }
}

/*********** TEMPLATE HELPERS ***********/
function getTemplateForKode(ss, kode){
  const k    = (kode || '').toLowerCase().trim();
  const pref = getPrefix(k);

  // --- 1) Override manual tetap jalan dulu kalau kamu mau ---
  let wanted =
    TEMPLATE_SHEETS[k] ||
    TEMPLATE_SHEETS[pref] ||
    null;

  // --- 2) Kalau belum ketemu, coba cari otomatis dari sheet "template_*" ---
  if (!wanted){
    const sheets = ss.getSheets();
    const tplSheets = sheets
      .map(sh => sh.getName())
      .filter(name => /^template_/i.test(name)); // semua template_*

    let bestMatch = null;
    const bases = [k, pref].filter(Boolean); // misal ['netf1b','netf']

    tplSheets.forEach(name => {
      const lower  = name.toLowerCase();
      const suffix = lower.replace(/^template_/, ''); // template_netflix → 'netflix'
      if (!suffix) return;

      for (const base of bases){
        if (base.startsWith(suffix)){
          if (!bestMatch || suffix.length > bestMatch.suffix.length){
            bestMatch = { suffix, name };
          }
        }
      }
    });

    if (bestMatch){
      wanted = bestMatch.name; // nama sheet asli
    }
  }

  // --- 3) Fallback default manual kalau masih belum ketemu ---
  if (!wanted && TEMPLATE_SHEETS.default){
    wanted = TEMPLATE_SHEETS.default;
  }

  if (!wanted) return ''; // benar-benar tidak ada template

  const sh = getSheetByNameCI(ss, wanted);
  if (!sh) return '';

  const last = sh.getLastRow();
  if (!last) return '';

  const vals = sh.getRange(1, 1, last, 1).getValues().map(r => r[0]);
  return vals.map(v => (v == null ? '' : String(v))).join('\n').trim();
}


// Render placeholder {{key}} atau {{key|default}}
function renderTemplate(body, ctx){
  if (!body) return '';
  return body.replace(/\{\{\s*([^}|]+)\s*(?:\|\s*([^}]+)\s*)?\}\}/g, function(_all, key, defv){
    key = String(key||'').trim().toLowerCase();
    const val = (ctx[key] != null && ctx[key] !== '') ? ctx[key] : (defv || '');
    return String(val);
  });
}

// Parse key-value dari kolom data (dipisah "||", key:value atau key=value)
function parseDataToKV_(dataStr){
  const kv = {};
  const parts = String(dataStr||'').split('||').map(s=>s.trim()).filter(Boolean);
  parts.forEach(p=>{
    const m = p.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (m){
      const k = (m[1]||'').trim().toLowerCase();
      const v = (m[2]||'').trim();
      kv[k] = v;
    }
  });
  return kv;
}

/*********** API: reserve/finalize/release ***********/
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.secret !== SECRET) return json({ ok:false, error:'forbidden' });

    const ss = getSS();
    const logSh = getSheetByNameCI(ss, ORDERLOG_NAME) || ss.insertSheet(ORDERLOG_NAME);
    const action = (body.action||'').toLowerCase();

    if (action === 'reserve'){
      const kode = (body.kode||'').trim();
      const qty  = Math.max(1, parseInt(body.qty,10)||1);
      const order_id  = (body.order_id||'').trim() || `ORD-${Date.now()}`;
      const buyer_jid = (body.buyer_jid||body.userRef||'').trim(); // userRef dari bot

      // Prefer explicit sheet_hint from the bot, else infer automatically
      let sheetName = (body.sheet_hint || '').toString().trim();
      let stokSh = null;
      if (sheetName) {
        stokSh = getSheetByNameCI(ss, sheetName);
        if (!stokSh) return json({ ok:false, error:'stok_sheet_not_found', sheet: sheetName });
      } else {
        sheetName = getStockSheetNameForKode(kode);
        stokSh = getSheetByNameCI(ss, sheetName);
        if (!stokSh) return json({ ok:false, error:'stok_sheet_not_found', sheet: sheetName });
      }

      const { header, rows, headerRow } = readTable(stokSh);
      const idx = headerIndex(header);
      if (idx.kode<0 || idx.status<0) return json({ ok:false, error:'bad_header', sheet: sheetName, header });

      // count available
      let available = 0;
      for (const r of rows){
        const okKode = (r[idx.kode]+ '').trim().toLowerCase() === kode.toLowerCase();
        const okStat = (r[idx.status]+ '').trim().toLowerCase() === 'ready';
        if (okKode && okStat) available++;
      }
      if (available < qty) return json({ ok:false, msg:'stok kurang', available, needed: qty, sheet: sheetName });

      // pick & hold
      let picked=0; const now=new Date(); const holdUntil = new Date(now.getTime()+HOLD_TTL_MIN*60000);
      for (let i=0; i<rows.length && picked<qty; i++){
        const okKode = (rows[i][idx.kode]+ '').trim().toLowerCase() === kode.toLowerCase();
        const okStat = (rows[i][idx.status]+ '').trim().toLowerCase() === 'ready';
        if (okKode && okStat){
          rows[i][idx.status]     = 'hold';
          if (idx.order_id>=0)   rows[i][idx.order_id]   = order_id;
          if (idx.buyer_jid>=0)  rows[i][idx.buyer_jid]  = buyer_jid;
          if (idx.created_at>=0 && !rows[i][idx.created_at]) rows[i][idx.created_at] = now;
          if (idx.updated_at>=0) rows[i][idx.updated_at] = now;
          if (idx.hold_until>=0) rows[i][idx.hold_until] = holdUntil;
          picked++;
        }
      }
      writeRowsBack(stokSh, headerRow, header.length, rows);

      // log
      logSh.appendRow([order_id, kode, qty, '', 'pending', buyer_jid, sheetName, new Date(), '']);

      // push reload produk (non-blocking)
      try { postBot('/admin/reload', { secret: BOT_SECRET, what:'produk', note:`reserve ${kode} x${qty}` }); } catch(_){}

      return json({ ok:true, reserved: qty, sheet: sheetName, order_id });
    }

    if (action === 'finalize'){
    const order_id = (body.order_id||'').trim();
    const total    = body.total || '';

    // cari log order
    const lgVals = logSh.getDataRange().getValues();
    let sheetName='', kode='', buyer_jid='', logRowIdx=-1;
    for (let r=1; r<lgVals.length; r++){
      if ((lgVals[r][0]+'') === order_id){
        logRowIdx = r;
        sheetName = lgVals[r][6]+'';
        kode      = lgVals[r][1]+'';
        buyer_jid = (lgVals[r][5]||'')+'';
        break;
      }
    }
    if (logRowIdx < 0) return json({ ok:false, msg:'order_not_found_in_log' });

    const stokSh = getSheetByNameCI(getSS(), sheetName);
    if (!stokSh) return json({ ok:false, msg:'stok_sheet_not_found', sheet: sheetName });

    const { header, rows, headerRow } = readTable(stokSh);
    const idx = headerIndex(header);
    const now = new Date();
    const items=[];
    for (let i=0; i<rows.length; i++){
      const isHold = (rows[i][idx.order_id]+ '') === order_id &&
                    (rows[i][idx.status]+ '').toLowerCase() === 'hold';
      if (isHold){
        rows[i][idx.status]     = 'sold';
        if (idx.updated_at>=0) rows[i][idx.updated_at] = now;
        items.push({ kode: rows[i][idx.kode], data: rows[i][idx.data] });
      }
    }
    writeRowsBack(stokSh, headerRow, header.length, rows);

    // update log (qty sudah ada di kolom 3)
    const lg2 = logSh.getDataRange().getValues();
    let orderRow = lg2[logRowIdx]; // baris yang sama (1-based di sheet)
    if (total) orderRow[3] = total;       // total (kolom D, index 3)
    orderRow[4] = 'paid';                 // status (kolom E)
    orderRow[8] = new Date();             // paid_at (kolom I)
    logSh.getRange(logRowIdx+1,1,1,orderRow.length).setValues([orderRow]);

    // update summary stok Produk biar display langsung ikut
    try { syncProduk(); } catch(_){}

    // optional, kalau mau bot refresh cache produk
    try { postBot('/admin/reload', { secret: BOT_SECRET, what:'produk', note:`finalize ${kode}` }); } catch(_){}
    try { pingBotRefresh(); } catch(_){}



    // ---------- TEMPLATE ----------
    const ss2 = getSS();
    const ctx = {
      order_id: order_id,
      kode: kode,
      qty: items.length || (orderRow[2]||1),
      total_idr: orderRow[3] || total || '',
      product_name: getProdukNameByKode_(kode),
      pay_method: 'QRIS (auto)',
      time: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy HH:mm')
    };
    if (items.length){
      const firstKV = parseDataToKV_(items[0].data);
      Object.assign(ctx, firstKV);
    }
    const tplBody = getTemplateForKode(ss2, kode);
    const after_msg = tplBody ? renderTemplate(tplBody, ctx) : '';

    // ---------- build order object for response ----------
    const order = {
      order_id: orderRow[0],
      kode:     orderRow[1],
      qty:      Number(orderRow[2]) || items.length || 1,
      total:    Number(orderRow[3]) || Number(total) || 0,
      status:   orderRow[4],
      buyer_id: orderRow[5],
      sheet:    orderRow[6],
      created_at: orderRow[7],
      paid_at:    orderRow[8],
      product_name: ctx.product_name
    };

    return json({ ok:true, order, items, sheet: sheetName, after_msg, buyer_jid, kode });
  }


    if (action === 'release'){
      const order_id = (body.order_id||'').trim();

      const lgVals = logSh.getDataRange().getValues();
      let sheetName=''; let kode='';
      for (let r=1; r<lgVals.length; r++){
        if ((lgVals[r][0]+'') === order_id){ sheetName = lgVals[r][6]+''; kode = lgVals[r][1]+''; break; }
      }
      if (!sheetName) return json({ ok:false, error:'order_not_found_in_log' });

      const stokSh = getSheetByNameCI(ss, sheetName);
      if (!stokSh) return json({ ok:false, error:'stok_sheet_not_found', sheet: sheetName });

      const { header, rows, headerRow } = readTable(stokSh);
      const idx = headerIndex(header);
      const now = new Date();
      for (let i=0; i<rows.length; i++){
        const isHold = (rows[i][idx.order_id]+ '') === order_id &&
                       (rows[i][idx.status]+ '').toLowerCase() === 'hold';
        if (isHold){
          rows[i][idx.status]     = 'ready';
          if (idx.order_id>=0)   rows[i][idx.order_id]   = '';
          if (idx.buyer_jid>=0)  rows[i][idx.buyer_jid]  = '';
          if (idx.updated_at>=0) rows[i][idx.updated_at] = now;
          if (idx.hold_until>=0) rows[i][idx.hold_until] = '';
        }
      }
      writeRowsBack(stokSh, headerRow, header.length, rows);

      // update log
      const lg2 = logSh.getDataRange().getValues();
      for (let r=1; r<lg2.length; r++){
        if ((lg2[r][0]+'') === order_id){
          lg2[r][4] = 'canceled';
          lg2[r][8] = new Date();
          logSh.getRange(r+1,1,1,lg2[r].length).setValues([lg2[r]]);
          break;
        }
      }

      try { syncProduk(); } catch(_){}
      try { postBot('/admin/reload', { secret: BOT_SECRET, what:'produk', note:`release ${kode}` }); } catch(_){}

      return json({ ok:true, sheet: sheetName });
    }

    return json({ ok:false, error:'unknown action' });

  }catch(err){
    return json({ ok:false, error:String(err) });
  }
}

/*********** PUSH dari Sheets (onChange) ***********/
// Pasang trigger: Edit → Triggers → Add → From spreadsheet: On change
function onChange(e){
  try{
    const ss = getSS();
    const sh = ss.getActiveSheet();
    if (!sh) return;
    const name = (sh.getName()+'').toLowerCase();

    if (name.startsWith('stok_') || name === PRODUK_NAME.toLowerCase()){
      // 1) sinkronkan summary stok Produk
      try { syncProduk(); } catch(err){}

      // 2) beri tahu bot
      try {
        postBot('/admin/reload', {
          secret: BOT_SECRET,
          what: 'produk',
          note: `sheet "${name}" changed`
        });
      } catch(err){}

      // 3) optional: refresh cache produk di bot
      try { pingBotRefresh(); } catch(err){}
    }
  }catch(err){}
}


/*********** CRON: Auto-release hold expired ***********/
// Pasang trigger: Time-driven → Every 5 minutes
function autoReleaseExpiredHolds(){
  const ss = getSS();
  const now = new Date();
  const sheets = listStockSheets(ss);

  for (const sh of sheets){
    const { header, rows, headerRow } = readTable(sh);
    const idx = headerIndex(header);
    if (idx.status<0) continue;

    let changed = false;
    for (let i=0; i<rows.length; i++){
      const isHold = (rows[i][idx.status]+ '').toLowerCase() === 'hold';
      if (!isHold) continue;

      let expired = false;
      if (idx.hold_until>=0 && rows[i][idx.hold_until]){
        expired = (now - new Date(rows[i][idx.hold_until])) > 0;
      } else if (idx.updated_at>=0 && rows[i][idx.updated_at]){
        expired = (now - new Date(rows[i][idx.updated_at])) > HOLD_TTL_MIN*60000;
      }

      if (expired){
        rows[i][idx.status] = 'ready';
        if (idx.order_id>=0)   rows[i][idx.order_id]   = '';
        if (idx.buyer_jid>=0)  rows[i][idx.buyer_jid]  = '';
        if (idx.hold_until>=0) rows[i][idx.hold_until] = '';
        if (idx.updated_at>=0) rows[i][idx.updated_at] = now;
        changed = true;
      }
    }
    if (changed) writeRowsBack(sh, headerRow, header.length, rows);
  }

  try { syncProduk(); } catch(e){}
  postBot('/admin/reload', { secret: BOT_SECRET, what:'produk', note:`auto-release expired holds` });
}

/*********** Sync Produk (stok/terjual/total) ***********/
function syncProduk(){
  const ss = getSS();
  const prodSh = getSheetByNameCI(ss, PRODUK_NAME);
  if (!prodSh) return;

  const sheets = listStockSheets(ss);
  const agg = {}; // kode -> {ready, sold, total}
  for (const sh of sheets){
    const { header, rows } = readTable(sh);
    const idx = headerIndex(header);
    if (idx.kode<0 || idx.status<0) continue;

    for (const r of rows){
      const kode = (r[idx.kode]+ '').trim().toLowerCase();
      if (!kode) continue;
      const st   = (r[idx.status]+ '').trim().toLowerCase();
      if (!agg[kode]) agg[kode] = { ready:0, sold:0, total:0 };
      agg[kode].total++;
      if (st === 'ready') agg[kode].ready++;
      if (st === 'sold')  agg[kode].sold++;
    }
  }

  const vals = prodSh.getDataRange().getValues();
  if (vals.length < 2) return;
  const header = vals[0].map(h=>(h+'').trim().toLowerCase());
  const iKode = header.indexOf('kode');
  const iStok = header.indexOf('stok');
  const iTerj = header.indexOf('terjual');
  const iTot  = header.indexOf('total');

  for (let r=1; r<vals.length; r++){
    const kode = (vals[r][iKode]+ '').trim().toLowerCase();
    if (!kode) continue;
    const a = agg[kode] || { ready:0, sold: (vals[r][iTerj]||0), total: (vals[r][iTot]||0) };
    if (iStok>=0) vals[r][iStok] = a.ready;
    if (iTerj>=0) vals[r][iTerj] = a.sold;
    if (iTot>=0)  vals[r][iTot]  = a.total;
  }
  prodSh.getRange(1,1,vals.length,vals[0].length).setValues(vals);

  const low = [];
  for (const [kode, a] of Object.entries(agg)){
    if (a.ready < LOW_STOCK_THRESHOLD) low.push({ kode, ready: a.ready });
  }
  if (low.length){
    postBot('/admin/lowstock', { secret: BOT_SECRET, items: low });
  }
}

/*********** Helper: nama produk untuk template ***********/
function getProdukNameByKode_(kode){
  const ss = getSS();
  const sh = getSheetByNameCI(ss, PRODUK_NAME);
  if (!sh) return kode;
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(s=>(s+'').trim().toLowerCase());
  const iKode = h.indexOf('kode'), iNama = h.indexOf('nama');
  if (iKode<0||iNama<0) return kode;
  for (let r=1;r<vals.length;r++){
    if ((vals[r][iKode]+'').trim().toLowerCase() === (kode||'').toLowerCase()){
      return (vals[r][iNama] || kode) + '';
    }
  }
  return kode;
}

