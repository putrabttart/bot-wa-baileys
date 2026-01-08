import { norm } from '../utils/index.js';
import { getTokens } from '../data/products.js';
import { ENV } from '../config/env.js';

const STOPWORDS = new Set([
  'stok','stock','harga','beli','order','pesan','list','kategori','produk','product',
  'minta','tolong','dong','kak','bang','min','gan','bro','sist','sista','admin',
  'gaada','nggak','tidak','iya','halo','hai','terimakasih','makasih','makasi','assalamualaikum','salam','p',
  'test','coba','udah','sudah','lagi','banget','lol','wkwk'
]);

export function tokenizeClean(s='') { return norm(s).split(/[^a-z0-9]+/i).filter(Boolean); }
export function cleanQuery(s='') {
  const x = norm(s).replace(/^#/, '').replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ');
  const parts = x.split(/\s+/).filter(Boolean).filter(w => !STOPWORDS.has(w));
  return (parts.join(' ') || norm(s)).trim();
}
export function isLikelyQuery(text='') {
  if (ENV.QUIET_MODE) return false;
  if (!text) return false;
  if (text.trim().startsWith('#')) return false;
  if (text.includes('?')) return false;
  if (/(https?:\/\/)/i.test(text)) return false;
  const tokens = tokenizeClean(text).filter(t => !STOPWORDS.has(t));
  if (!tokens.length) return false;
  let hasSignal = false;
  const PRODUCT_TOKENS = getTokens();
  for (const t of tokens) { if (t.length >= 3 && PRODUCT_TOKENS.has(t)) { hasSignal = true; break; } }
  if (!hasSignal) return false;
  if (tokens.length >= 8 && !/\d/.test(text)) return false;
  return true;
}