import { parse } from 'csv-parse/sync';
import { ENV } from '../config/env.js';
import { norm } from '../utils/index.js';

let PROMOS = []; let LAST_PROMO = 0; const TTL_PROMO = 1000*60*5;

const lowerify = (r) => {
  const o = {}; for (const k of Object.keys(r)) o[k.trim().toLowerCase()] = (r[k] ?? '').toString().trim();
  return o;
};

export function rowToPromo(r) {
  const o = lowerify(r);
  const appliesRaw = o.applies_to || o.applies || '';
  const applies = appliesRaw ? appliesRaw.split(/[,|]/).map(s=>norm(s)).filter(Boolean) : ['all'];
  return {
    code: (o.code || o.kode || '').toUpperCase(),
    type: (o.type || o.jenis || '').toLowerCase(), // percent|nominal
    value: Number(o.value || o.nilai || 0) || 0,
    applies_to: applies.length ? applies : ['all'],
    min_qty: Number(o.min_qty || o.minqty || 0) || 0,
    min_amount: Number(o.min_amount || o.min || 0) || 0,
    quota: Number(o.quota || 0) || 0,
    used: Number(o.used || 0) || 0,
    expires_at: o.expires_at || o.expired || '',
    active: ((o.active || o.aktif || 'true').toString().toLowerCase()) === 'true',
    label: o.label || ''
  };
}

export function isPromoValidFor(promo, { kode, qty, total }) {
  if (!promo?.active) return { ok:false, reason:'non-active' };
  if (promo.expires_at) {
    const now = Date.now();
    const exp = new Date(promo.expires_at).getTime();
    if (!isNaN(exp) && now > exp) return { ok:false, reason:'expired' };
  }
  if (promo.quota && promo.used && promo.used >= promo.quota) return { ok:false, reason:'quota' };
  if (promo.min_qty && qty < promo.min_qty) return { ok:false, reason:'min_qty' };
  if (promo.min_amount && total < promo.min_amount) return { ok:false, reason:'min_amount' };
  const applies = promo.applies_to || ['all'];
  if (!applies.includes('all') && !applies.includes(norm(kode))) return { ok:false, reason:'applies' };
  if (!['percent','nominal'].includes(promo.type)) return { ok:false, reason:'type' };
  if (!(promo.value > 0)) return { ok:false, reason:'value' };
  return { ok:true };
}
export function applyPromo(promo, { total }) {
  if (promo.type === 'percent') {
    const disc = Math.floor((promo.value/100) * total);
    return Math.min(disc, total);
  }
  return Math.min(Math.floor(promo.value), total);
}

export async function loadPromos(force=false) {
  if (!ENV.SHEET_URL_PROMO) { PROMOS = []; LAST_PROMO = Date.now(); return; }
  if (!force && PROMOS.length && Date.now() - LAST_PROMO < TTL_PROMO) return;
  const r = await fetch(ENV.SHEET_URL_PROMO);
  if (!r.ok) throw new Error('Fetch promos failed: '+r.status);
  const csv = await r.text();
  const rows = parse(csv, { columns:true, skip_empty_lines:true });
  PROMOS = rows.map(rowToPromo).filter(p=>p.code);
  LAST_PROMO = Date.now();
}
export const getPromos = () => PROMOS;
export const setPromosStale = () => { LAST_PROMO = 0; };