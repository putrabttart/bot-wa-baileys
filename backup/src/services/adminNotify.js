import { ENV } from '../config/env.js';

export async function notifyAdmins(client, text) {
  for (const jid of ENV.ADMIN_JIDS) {
    try { await client.sendMessage(jid, text); } catch {}
  }
}