import { ENV } from '../config/env.js';
import { postJSON } from '../utils/index.js';

export async function reserveStock({ kode, qty, order_id, buyer_jid }) {
  if (!ENV.GAS_URL) return { ok:false, msg:'GAS_URL missing' };
  return postJSON(ENV.GAS_URL, { secret:ENV.GAS_SECRET, action:'reserve', kode, qty, order_id, buyer_jid });
}
export async function finalizeStock({ order_id, total }) {
  if (!ENV.GAS_URL) return { ok:false, msg:'GAS_URL missing' };
  return postJSON(ENV.GAS_URL, { secret:ENV.GAS_SECRET, action:'finalize', order_id, total });
}
export async function releaseStock({ order_id }) {
  if (!ENV.GAS_URL) return { ok:false, msg:'GAS_URL missing' };
  return postJSON(ENV.GAS_URL, { secret:ENV.GAS_SECRET, action:'release', order_id });
}