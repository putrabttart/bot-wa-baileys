// src/payments/midtrans.js
import crypto from 'crypto';
import fs from 'fs';
import { ENV } from '../config/env.js';

/* =========================
   Helper: Env & Logging
   ========================= */
function isProd() {
  // Terima boolean, "true"/"1", 1
  return ENV.MID_PROD === true
      || ENV.MID_PROD === 'true'
      || ENV.MID_PROD === 1
      || ENV.MID_PROD === '1';
}

function midtransBase() {
  const API_BASE  = isProd() ? 'https://api.midtrans.com'  : 'https://api.sandbox.midtrans.com';
  const SNAP_BASE = isProd() ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  const auth = Buffer.from(String(ENV.MID_SKEY || '') + ':').toString('base64');
  return { API_BASE, SNAP_BASE, auth };
}

function logLine(...args) {
  // Selalu log ke console
  console.log(...args);
  // Optional: log ke file jika mau (set ENV.MID_LOG_FILE, misal "midtrans.log")
  if (ENV.MID_LOG_FILE) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    try { fs.appendFileSync(ENV.MID_LOG_FILE, `[${new Date().toISOString()}] ${line}`); } catch {}
  }
}

/* =========================
   Helper: Ekstrak pointer QR
   ========================= */
function extractQrisPointers(json) {
  const actions = Array.isArray(json?.actions) ? json.actions : [];
  const qrV2 = actions.find(a => a?.name === 'generate-qr-code-v2')?.url;
  const qrV1 = actions.find(a => a?.name === 'generate-qr-code')?.url
            || actions.find(a => a?.name === 'qr-code')?.url;
  const qr_url = qrV2 || qrV1 || json?.qr_url || null;
  const qr_string = json?.qr_string || null;
  return { qr_url, qr_string };
}

/* =========================
   SNAP (Invoice)
   ========================= */
export async function createMidtransInvoice({ order_id, gross_amount, customer_phone, product_name }) {
  const { SNAP_BASE, auth } = midtransBase();

  const payload = {
    transaction_details: { order_id, gross_amount: Math.round(gross_amount) },
    item_details: [{ id: order_id, price: Math.round(gross_amount), quantity: 1, name: product_name }],
    customer_details: { phone: customer_phone },
    callbacks: ENV.PUBLIC_BASE_URL ? { finish: ENV.PUBLIC_BASE_URL + '/pay/finish' } : undefined,
    credit_card: { secure: true }
  };

  const url = `${SNAP_BASE}/snap/v1/transactions`;
  logLine('=== Midtrans SNAP Request ===');
  logLine('Endpoint :', url);
  logLine('Payload  :', payload);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  logLine('HTTP Status :', res.status, res.statusText);
  logLine('Response    :', text);

  if (!res.ok) throw new Error('Midtrans create error: ' + res.status + ' ' + text);
  return JSON.parse(text);
}

/* =========================
   Core API: Status
   ========================= */
export async function midtransStatus(order_id) {
  const { API_BASE, auth } = midtransBase();
  const url = `${API_BASE}/v2/${encodeURIComponent(order_id)}/status`;

  logLine('=== Midtrans Status Request ===');
  logLine('Endpoint :', url);

  const res = await fetch(url, { headers: { 'accept': 'application/json', Authorization: `Basic ${auth}` } });
  const text = await res.text();

  logLine('HTTP Status :', res.status, res.statusText);
  logLine('Response    :', text);

  if (!res.ok) throw new Error('Midtrans status error: ' + res.status + ' ' + text);
  return JSON.parse(text);
}

/* =========================
   Core API: QRIS Charge
   ========================= */
export async function createMidtransQRISCharge({ order_id, gross_amount }) {
  const { API_BASE, auth } = midtransBase();

  const payload = {
    payment_type: 'qris',
    transaction_details: { order_id, gross_amount: Math.round(gross_amount) }
  };

  const url = `${API_BASE}/v2/charge`;
  logLine('=== Midtrans QRIS Request ===');
  logLine('Endpoint :', url);
  logLine('Payload  :', payload);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  logLine('HTTP Status :', res.status, res.statusText);
  logLine('Response    :', text);

  if (!res.ok) throw new Error('QRIS charge error: ' + res.status + ' ' + text);

  const json = JSON.parse(text);
  const { qr_url, qr_string } = extractQrisPointers(json);
  return { ...json, qr_url, qr_string };
}

/* =========================
   Signature Verification
   ========================= */
export function verifyMidtransSignature({ order_id, status_code, gross_amount, signature_key }) {
  // Gunakan nilai mentah dari webhook (string), jangan diubah tipe
  const raw = String(order_id) + String(status_code) + String(gross_amount) + String(ENV.MID_SKEY || '');
  const calc = crypto.createHash('sha512').update(raw).digest('hex');
  return calc === String(signature_key);
}
