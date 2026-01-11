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
  
  // Only treat as query if QUIET_MODE is explicitly false AND message looks intentional
  // Reject very short messages that might be casual chat
  if (text.trim().length < 3) return false;
  
  // Reject messages that look like casual conversation
  // (e.g., "iya", "ok", "thanks", "hi there", etc.)
  const shortCasualText = text.trim().split(/\s+/).length <= 2 && text.trim().length <= 15;
  if (shortCasualText && /^(iya|ok|thanks|ok\s|hi\s|halo|hei|yes|no|yep|nope|lol|wkwk)/i.test(text.trim())) return false;
  
  const tokens = tokenizeClean(text).filter(t => !STOPWORDS.has(t));
  if (!tokens.length) return false;
  let hasSignal = false;
  const PRODUCT_TOKENS = getTokens();
  for (const t of tokens) { if (t.length >= 3 && PRODUCT_TOKENS.has(t)) { hasSignal = true; break; } }
  if (!hasSignal) return false;
  // Reject very long messages without numbers (likely not a product query)
  if (tokens.length >= 8 && !/\d/.test(text)) return false;
  return true;
}