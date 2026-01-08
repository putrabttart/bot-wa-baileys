import fs from 'node:fs';
import path from 'node:path';
import qrcodeTerminal from 'qrcode-terminal';
import QR from 'qrcode';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import { ENV } from '../config/env.js';

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

const toDigits = (s='') => s.replace(/\D/g, '');
const normalizeJid = (jid='') => {
  let v = (jid || '').trim();
  if (!v) return '';
  // Baileys user JID bisa berbentuk "628xx:device@s.whatsapp.net" — buang suffix device
  if (v.includes('@s.whatsapp.net')) {
    v = v.replace(/:[^@]+@s\.whatsapp\.net$/i, '@s.whatsapp.net');
    return v;
  }
  if (v.endsWith('@g.us')) return v;
  if (v.includes('@')) return v;
  const digits = toDigits(v);
  return digits ? `${digits}@s.whatsapp.net` : '';
};

const serializeKey = (key={}) => {
  const jid = key.remoteJid || '';
  const id = key.id || '';
  return `${jid}:${id}`;
};

export class MessageMedia {
  constructor(mimetype, data, filename='file', url='') {
    this.mimetype = mimetype;
    this.data = data; // base64 string
    this.filename = filename;
    this.url = url;
  }

  static async fromUrl(url) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const filename = url.split('/').pop().split('?')[0] || 'file';
    return new MessageMedia(mime, buf.toString('base64'), filename, url);
  }
}

/* -------------------------------------------------------------------------- */
/* Baileys adapter                                                            */
/* -------------------------------------------------------------------------- */

class GroupChat {
  constructor(client, meta) {
    this.client = client;
    this.id = { _serialized: meta?.id || '' };
    this.name = meta?.subject || '';
    this.isGroup = true;
    this.participants = (meta?.participants || []).map(p => ({
      id: { _serialized: normalizeJid(p.id) },
      isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
      isSuperAdmin: p.admin === 'superadmin'
    }));
  }

  async sendMessage(text, options) {
    return this.client.sendMessage(this.id._serialized, text, options);
  }

  async setMessagesAdminsOnly(adminsOnly) {
    await this.client.groupSettingUpdate(this.id._serialized, adminsOnly ? 'announcement' : 'not_announcement');
  }
}

class WrappedMessage {
  constructor(client, raw) {
    this.client = client;
    this.raw = raw;
    this.key = raw.key || {};
    this.id = { _serialized: serializeKey(this.key) };
    this.from = raw.key?.remoteJid || '';
    this.author = raw.key?.participant || raw.participant || null;
    this.isGroup = this.from.endsWith('@g.us');
    this.isStatus = this.from === 'status@broadcast';
    this.body = this.extractText(raw);
  }

  extractText(raw) {
    const msg = raw.message || {};
    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.imageMessage?.caption) return msg.imageMessage.caption;
    if (msg.videoMessage?.caption) return msg.videoMessage.caption;
    return '';
  }

  async reply(content, _unused, options={}) {
    return this.client.sendMessage(this.from, content, { ...options, quoted: this.raw });
  }

  async react(emoji) {
    try { await this.client.sock?.sendMessage(this.from, { react: { text: emoji, key: this.raw.key } }); } catch {}
  }

  async getContact() {
    const jid = this.isGroup ? (this.author || this.from) : this.from;
    return { id: { _serialized: normalizeJid(jid) } };
  }

  async getChat() {
    if (this.isGroup) {
      const meta = await this.client.getGroupMeta(this.from);
      return new GroupChat(this.client, meta);
    }
    return {
      id: { _serialized: this.from },
      isGroup: false,
      async sendMessage(text, options) { return this.client.sendMessage(this.from, text, options); }
    };
  }
}

class BaileysClient {
  constructor({ authDir }) {
    this.authDir = authDir;
    this.handlers = new Map();
    this.sentMessages = new Map();
    this.logger = pino({ level: 'silent' });
    this.info = { wid: { _serialized: '' } };
    this.sock = null;
    this.state = null;
    this.saveCreds = null;
    this._resetting = false;
    console.log('[Auth] Folder sesi:', this.authDir);
  }

  async init() {
    await fs.promises.mkdir(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.state = state;
    this.saveCreds = saveCreds;
    await this.startSocket();
  }

  async startSocket() {
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: this.state,
      logger: this.logger,
      printQRInTerminal: false,
      browser: ['PBS', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    this.sock = sock;
    sock.ev.on('creds.update', this.saveCreds);
    sock.ev.on('connection.update', (update) => this.handleConnection(update));
    sock.ev.on('messages.upsert', (ev) => this.handleMessages(ev));
  }

  async handleConnection(update) {
    const { connection, lastDisconnect, qr } = update;
    if (connection === 'connecting') console.log('[WA] Menghubungkan...');
    if (qr) this.emit('qr', qr);

    if (connection === 'open') {
      this.info.wid._serialized = normalizeJid(this.sock?.user?.id || '');
      this.emit('ready');
      return;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.warn('[WA] Koneksi terputus.', statusCode, 'reconnect =', shouldReconnect);
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        await this.resetAuthAndReconnect();
      } else if (shouldReconnect) {
        await this.startSocket();
      }
    }
  }

  async handleMessages({ messages, type }) {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message) continue;
      const msg = new WrappedMessage(this, m);
      await this.emitMessage(msg);
    }
  }

  async emitMessage(msg) {
    const handlers = this.handlers.get('message') || [];
    for (const h of handlers) {
      try { await h(msg); } catch (err) { console.error('handler error:', err); }
    }
  }

  on(event, handler) {
    const arr = this.handlers.get(event) || [];
    arr.push(handler);
    this.handlers.set(event, arr);
  }

  emit(event, payload) {
    const arr = this.handlers.get(event) || [];
    for (const h of arr) {
      try { h(payload); } catch (e) { console.error('emit error', event, e); }
    }
  }

  async sendMessage(jid, content, options={}) {
    const to = normalizeJid(jid);
    if (!to) throw new Error('Invalid JID');

    const payload = this.buildContent(content, options);
    if (options.mentions?.length) payload.mentions = options.mentions.map(m => m?.id?._serialized || m);
    if (options.quoted) payload.quoted = options.quoted;

    const res = await this.sock.sendMessage(to, payload);
    const serialized = serializeKey(res?.key || {});
    if (res?.key) this.sentMessages.set(serialized, res.key);
    return { ...res, id: { _serialized: serialized } };
  }

  buildContent(content, options) {
    if (content instanceof MessageMedia) {
      const buffer = Buffer.from(content.data, 'base64');
      const isImage = (content.mimetype || '').startsWith('image/');
      const isVideo = (content.mimetype || '').startsWith('video/');
      if (isImage) return { image: buffer, mimetype: content.mimetype, caption: options.caption, fileName: content.filename };
      if (isVideo) return { video: buffer, mimetype: content.mimetype, caption: options.caption, fileName: content.filename };
      return { document: buffer, mimetype: content.mimetype, fileName: content.filename, caption: options.caption };
    }

    if (typeof content === 'object') return content;
    return { text: String(content), linkPreview: options.linkPreview };
  }

  async getMessageById(serialized) {
    const key = this.sentMessages.get(serialized);
    if (!key) return null;
    const client = this;
    return {
      key,
      async delete(forEveryone=true) {
        if (!forEveryone) return;
        try { await client.sock?.sendMessage(key.remoteJid, { delete: key }); } catch (err) { console.warn('delete fail', err?.message); }
      }
    };
  }

  async groupSettingUpdate(jid, mode) {
    return this.sock?.groupSettingUpdate(normalizeJid(jid), mode);
  }

  async getContactById(jid) {
    return { id: { _serialized: normalizeJid(jid) } };
  }

  async getGroupMeta(jid) {
    try { return await this.sock?.groupMetadata(normalizeJid(jid)); }
    catch { return { id: normalizeJid(jid), participants: [] }; }
  }

  async destroy() {
    try { this.sock?.end?.(); this.sock?.ws?.close?.(); } catch {}
  }

  initialize() {
    // noop for compatibility with whatsapp-web.js
  }
}

BaileysClient.prototype.resetAuthAndReconnect = async function() {
  if (this._resetting) return;
  this._resetting = true;
  try {
    console.warn('[Auth] Sesi tidak valid (logged out). Resetting dan menampilkan QR baru...');
    try { fs.rmSync(this.authDir, { recursive: true, force: true }); } catch {}
    await fs.promises.mkdir(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.state = state;
    this.saveCreds = saveCreds;
    await this.startSocket();
  } catch (e) {
    console.error('[Auth] Gagal reset sesi:', e);
  } finally {
    this._resetting = false;
  }
};

BaileysClient.prototype.saveAuth = async function() {
  try { if (this.saveCreds) await this.saveCreds(); }
  catch (e) { console.warn('[Auth] Gagal menyimpan kredensial:', e?.message); }
};

/* -------------------------------------------------------------------------- */
/* Public factory                                                            */
/* -------------------------------------------------------------------------- */

export function createClient() {
  const sessionBase = ENV.SESSION_DIR || path.join(process.cwd(), 'baileys_auth');
  const authDir = path.join(sessionBase, ENV.CLIENT_ID || 'session');
  const credsPath = path.join(authDir, 'creds.json');
  console.log('[Auth] Folder sesi:', authDir);
  console.log('[Auth] RESET_SESSION =', !!ENV.RESET_SESSION);
  console.log('[Auth] creds.json exist =', fs.existsSync(credsPath));

  if (ENV.RESET_SESSION) {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log('[Auth] RESET_SESSION=true → sesi lama dihapus');
    } catch (e) {
      console.warn('[Auth] Gagal menghapus sesi lama:', e?.message);
    }
  }
  const client = new BaileysClient({ authDir });
  return client;
}

export function installQRHandlers(client) {
  let lastQR = '';
  client.on('qr', (qr) => {
    lastQR = qr;
    console.log('Scan QR berikut:');
    qrcodeTerminal.generate(qr, { small: true });
    // Simpan juga sebagai PNG agar mudah dibuka di Termux/Android
    (async () => {
      try {
        const out = path.join(client.authDir || process.cwd(), 'last-qr.png');
        const png = await QR.toBuffer(qr, { type: 'png', width: 512, margin: 1 });
        await fs.promises.writeFile(out, png);
        console.log('[QR] Tersimpan ke:', out);
        console.log('[QR] Termux tips: gunakan salah satu perintah berikut untuk membuka:');
        console.log('  termux-open-url http://127.0.0.1:3000/qr');
        console.log('  termux-open "' + out + '"');
      } catch (e) {
        console.warn('[QR] Gagal menyimpan PNG:', e?.message);
      }
    })();
  });
  client.on('ready', () => { lastQR = ''; });
  return {
    getLastQR: () => lastQR,
    clear: () => { lastQR = ''; }
  };
}