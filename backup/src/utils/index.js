export const norm = (s='') => s.toString().toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
export const normCode = (s='') => norm(s).replace(/[^\p{L}\p{N}]+/gu, '');
export const toID = (s='') => s.replace(/\D/g, '');
export const isHttp = (u='') => /^https?:\/\//i.test(u || '');
export const IDR = (n) => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n||0));
export const paginate = (arr, page=1, per=8) => {
  const total = Math.max(1, Math.ceil(arr.length/per));
  const p = Math.min(Math.max(1, page), total);
  const start = (p-1)*per;
  return { items: arr.slice(start, start+per), page: p, total };
};
export const pipesToComma = (text='') => String(text).split('||').map(s=>s.trim()).filter(Boolean).join(', ');

export async function postJSON(url, body) {
  const res = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.json();
}