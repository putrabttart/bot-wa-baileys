export const ORDERS = new Map();      // order_id -> meta
export const SENT_ORDERS = new Set(); // prevent double-send via webhook retry
export const LAST_QR = new Map();     // cache QR per chat (opsional)
export const LAST_SEEN = new Map();   // anti-spam cooldown: jid -> timestamp