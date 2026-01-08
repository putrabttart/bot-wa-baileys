import { IDR, toID } from '../utils/index.js';

function indoDateTime(iso) {
  try {
    const d = new Date(iso);
    const bln = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const tgl = d.getDate();
    const bulan = bln[d.getMonth()];
    const th = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${tgl} ${bulan} ${th} pukul ${hh}.${mm}`;
  } catch { return iso; }
}
function mapPaymentType(ev) {
  const t = (ev?.payment_type || '').toLowerCase();
  if (t==='qris') return 'QRIS';
  if (t==='bank_transfer') {
    if (ev?.va_numbers?.[0]?.bank) return `Virtual Account ${ev.va_numbers[0].bank.toUpperCase()}`;
    if (ev?.permata_va_number) return 'Virtual Account PERMATA';
    return 'Virtual Account';
  }
  if (t==='echannel') return 'Mandiri Bill';
  if (t==='gopay') return 'GoPay';
  if (t==='credit_card') return 'Kartu Kredit';
  if (t==='shopeepay') return 'ShopeePay';
  if (t==='alfamart' || t==='indomaret') return t.charAt(0).toUpperCase()+t.slice(1);
  return t || '-';
}
function simpleBuyerId(chatId) {
  if (!chatId) return '-';
  const only = toID(chatId);
  if (!only) return '-';
  return only.slice(-5);
}
export function formatTransaksiSuksesBox({ ev, meta, gross }) {
  const payId   = ev?.transaction_id || '-';
  const orderId = ev?.order_id || '-';
  const product = meta?.product_name || meta?.kode || '-';
  const idBuyer = simpleBuyerId(meta?.chatId);
  const noBuyer = toID(meta?.chatId||'');
  const qty     = Number(meta?.qty||0);
  const akun    = Number(qty);
  const harga   = Number(meta?.unit_price||0) || (Number(gross||0) / (qty||1));
  const total   = Number(gross||0);
  const payM    = mapPaymentType(ev) || '-';
  const timeISO = ev?.settlement_time || ev?.transaction_time || new Date().toISOString();
  const waktu   = indoDateTime(timeISO);
  return [
    '╭───〔 TRANSAKSI SUKSES 〕─',
    `: Pay ID : ${payId}`,
    `: Kode Unik : ${orderId}`,
    `: Nama Produk : ${product}`,
    `: ID Buyer : ${idBuyer}`,
    `: Nomor Buyer : ${noBuyer}`,
    `: Jumlah Beli : ${qty}`,
    `: Jumlah Akun didapat : ${akun}`,
    `: Harga : ${IDR(harga)}`,
    `: Total Dibayar : ${IDR(total)}`,
    `: Methode Pay : ${payM}`,
    `: Tanggal/Jam Transaksi : ${waktu}`,
    '╰────────────────────────'
  ].join('\n');
}

export function formatAccountDetailsStacked(items=[]) {
  const lines = ['( ACCOUNT DETAIL )'];
  items.forEach((it, idx) => {
    const raw = String(it?.data || '').trim();
    if (!raw) return;
    const single = detectSingleToken(raw);
    const n = idx + 1;
    if (single) { lines.push(`${n}. ${single}`); return; }
    const kv = parseKV(raw);
    if (kv.info && Object.keys(kv).length === 1) { lines.push(`${n}. ${kv.info}`); return; }
    if (kv.email) lines.push(`${n}. Email: ${kv.email}`); else lines.push(`${n}. -`);
    if (kv.password) lines.push(`- Password: ${kv.password}`);
    if (kv.profile)  lines.push(`- Profile: ${kv.profile}`);
    if (kv.pin)      lines.push(`- Pin: ${kv.pin}`);
    if (kv.redeem)   lines.push(`- Redeem: ${kv.redeem}`);
    if (kv.duration) lines.push(`- Durasi: ${kv.duration}`);
    const shown = new Set(['email','password','profile','pin','redeem','duration','info']);
    for (const [k,v] of Object.entries(kv)) if (!shown.has(k)) lines.push(`- ${k[0].toUpperCase()+k.slice(1)}: ${v}`);
    if (kv.info) lines.push(`- Info: ${kv.info}`);
  });
  return lines.join('\n');
}

function normalizeKey(k='') {
  const s = k.toString().trim().toLowerCase();
  if (/^e(-)?mail$|^email$|^user(name)?$/.test(s)) return 'email';
  if (/^pass(word)?$|^pw$|^sandi$/.test(s)) return 'password';
  if (/^profil(e)?$/.test(s)) return 'profile';
  if (/^pin$/.test(s)) return 'pin';
  if (/^redeem(code)?$|^kode ?redeem$/.test(s)) return 'redeem';
  if (/^durasi$|^masa ?aktif$|^valid$/.test(s)) return 'duration';
  return s;
}
function parseKV(raw='') {
  const kv = {};
  const parts = String(raw).split(/\|\||\||,/).map(s=>s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (m) kv[normalizeKey(m[1])] = m[2].trim();
    else kv.info = kv.info ? (kv.info + ' | ' + p) : p;
  }
  return kv;
}
function detectSingleToken(raw='') {
  const s = String(raw).trim();
  if (!s) return null;
  if (/[=:]/.test(s)) return null;
  const parts = s.split(/\|\||\||,/).map(t=>t.trim()).filter(Boolean);
  if (parts.length === 1) return parts[0];
  return null;
}