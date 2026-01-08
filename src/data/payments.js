// data/payments.js
import { parse } from "csv-parse/sync";

const cache = { ts: 0, data: [] };
const TTL_MS = 60 * 1000; // cache 1 menit

export async function loadPaymentLines(csvUrl) {
  if (!csvUrl) throw new Error("SHEET_URL_PAYMENT belum di-set");

  const now = Date.now();
  if (cache.data.length && now - cache.ts < TTL_MS) return cache.data;

  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Gagal ambil CSV payment: ${res.status}`);
  const text = await res.text();

  // Tab Anda kebanyakan 1 kolom (kolom A). Kita parse CSV lalu flatten.
  const rows = parse(text, { skip_empty_lines: false });
  // rows: [ [cellA], [cellA], ... ] atau [ [A,B,...], ... ]
  const lines = rows
    .map(r => (Array.isArray(r) ? r[0] : r))       // ambil kolom A
    .map(s => (s ?? "").toString().trim())         // trim
    // pertahankan header/emoji/URL, buang baris kosong beruntun
    .filter((s, i, arr) => s !== "" || (i > 0 && arr[i-1] !== "")); 

  cache.ts = now;
  cache.data = lines;
  return lines;
}
