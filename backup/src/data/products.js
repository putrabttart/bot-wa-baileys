import { parse } from 'csv-parse/sync';
import QR from 'qrcode';
import { ENV } from '../config/env.js';
import { norm, normCode, pipesToComma } from '../utils/index.js';

let PRODUCTS = []; let LAST = 0; const TTL = 1000*60*5;
let PRODUCT_TOKENS = new Set();

const lowerify = (r) => {
  const o = {}; for (const k of Object.keys(r)) o[k.trim().toLowerCase()] = (r[k] ?? '').toString().trim();
  return o;
};
export function rowToProduct(r) {
  const o = lowerify(r);
  return {
    nama:o.nama||'', harga:o.harga||'', ikon:o.ikon||'',
    deskripsi:o.deskripsi||'', kategori:o.kategori||'', wa:o.wa||'',
    harga_lama:o.harga_lama||'', stok:o.stok||'', kode:o.kode||'',
    alias:o.alias||'', terjual:o.terjual||'', total:o.total||''
  };
}
export function splitAliases(s='') {
  return String(s)
    .split(/[\n,;|/]+/g)
    .map(t=>t.trim())
    .filter(Boolean);
}
export function buildProductTokens() {
  const tokens = new Set();
  for (const p of PRODUCTS) {
    if (p.kode) tokens.add(norm(p.kode));
    String(p.nama||'').toLowerCase().split(/[^a-z0-9]+/i)
      .map(s=>s.trim()).filter(w=>w && w.length>=3).forEach(w=>tokens.add(w));
    splitAliases(p.alias).forEach(w=>{
      w.split(/[^a-z0-9]+/i).filter(x=>x && x.length>=3).forEach(x=>tokens.add(x.toLowerCase()));
    });
  }
  PRODUCT_TOKENS = tokens;
}
export async function loadProducts(force=false) {
  if (!force && PRODUCTS.length && Date.now()-LAST < TTL) return;
  if (!ENV.SHEET_URL) {
    PRODUCTS=[{nama:'Contoh',harga:'10000',kode:'contoh',alias:'sample, demo',wa:ENV.ADMIN_CONTACT}]; LAST=Date.now(); buildProductTokens(); return;
  }
  const r = await fetch(ENV.SHEET_URL);
  if (!r.ok) throw new Error('Fetch sheet failed: '+r.status);
  const csv = await r.text();
  const rows = parse(csv, { columns:true, skip_empty_lines:true });
  PRODUCTS = rows.map(rowToProduct).filter(p=>p.nama && p.kode);
  LAST = Date.now();
  buildProductTokens();
}
export const categories = () => [...new Set(PRODUCTS.map(p=>p.kategori).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
export const searchProducts = (q) => {
  const s=norm(q);
  return PRODUCTS.filter(p => [p.nama,p.deskripsi,p.kode,p.kategori,p.alias].some(v=>norm(v).includes(s)));
};
export const byKode = (code) => {
  const c = normCode(code);
  return PRODUCTS.find(p => {
    if (normCode(p.kode) === c) return true;
    const aliases = splitAliases(p.alias);
    return aliases.some(a => normCode(a) === c);
  });
};
export const getTokens = () => PRODUCT_TOKENS;
export const getAll = () => PRODUCTS;