import express from 'express';
import QR from 'qrcode';
import { ENV } from '../config/env.js';
import { verifyMidtransSignature } from '../payments/midtrans.js';
import { finalizeStock, releaseStock } from '../services/gas.js';
import { formatTransaksiSuksesBox, formatAccountDetailsStacked } from '../formatters/transactions.js';
import { ORDERS, SENT_ORDERS } from '../whatsapp/state.js';
import { loadProducts } from '../data/products.js';
import { loadPromos, setPromosStale, getPromos } from '../data/promos.js';
import { notifyAdmins } from '../services/adminNotify.js';

export function createApp({ getLastQR, client }){
  const app = express();
  app.use(express.json({ type: ['application/json','application/*+json'] }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/', (_req,res)=>res.send('OK - PBS Bot is running'));
  app.get('/status', (_req,res)=>res.json({ok:true}));

  app.get('/qr', async (_req,res)=>{
    const lastQR = getLastQR();
    if (!lastQR) return res.status(204).send('');
    try {
      const png = await QR.toBuffer(lastQR, { type:'png', width:320, margin:1 });
      res.set('Content-Type','image/png');
      res.send(png);
    } catch {
      res.status(500).send('QR gen error');
    }
  });

  app.get('/pay/finish', (_req,res)=> res.send('Terima kasih! Silakan cek WhatsApp Anda untuk konfirmasi & produk.'));

  // helper kecil untuk hapus pesan yang disimpan di meta.toDelete
  async function deleteOrderMessages(meta){
    if (!meta?.toDelete?.length) return;
    for (const mid of meta.toDelete) {
      try {
        if (!mid) continue;
        const m = await client.getMessageById(mid);
        if (m) await m.delete(true); // true => delete for everyone
      } catch (err) {
        // bisa gagal jika lewat batas waktu hapus WA / pesan sudah hilang
        console.warn('[DEL] gagal hapus', mid, err?.message);
      }
    }
  }

  app.post('/webhook/midtrans', async (req,res)=>{
    try{
      const ev = req.body || {};
      if (!verifyMidtransSignature(ev)) return res.status(401).send('bad signature');

      const order_id = ev.order_id;
      const status   = ev.transaction_status;
      const grossStr = String(ev.gross_amount || '0');
      const gross    = Number(grossStr);

      // sukses (QRIS/VA/e-wallet -> settlement, CC -> capture accept)
      if (status==='settlement' || status==='capture') {
        if (SENT_ORDERS.has(order_id)) return res.send('ok');
        SENT_ORDERS.add(order_id);
        setTimeout(() => SENT_ORDERS.delete(order_id), 10 * 60 * 1000);

        const fin = await finalizeStock({ order_id, total: grossStr });
        if (fin?.ok) {
          const meta = ORDERS.get(order_id);
          if (meta?.timer) clearTimeout(meta.timer);
          if (meta?.chatId) {
            const items = fin.items || [];
            const box = formatTransaksiSuksesBox({ ev, meta, gross });
            await client.sendMessage(meta.chatId, box, { linkPreview: false });
            const detailMsg = items.length
              ? formatAccountDetailsStacked(items)
              : '( ACCOUNT DETAIL )\n- Stok akan dikirim manual oleh admin.';
            await client.sendMessage(meta.chatId, detailMsg, { linkPreview: false });
            if (fin.after_msg) await client.sendMessage(meta.chatId, fin.after_msg, { linkPreview: false });

            // 🔥 hapus QR/Invoice yg dikirim saat order dibuat
            await deleteOrderMessages(meta);
          }
          ORDERS.delete(order_id);
        }
        return res.send('ok');
      }

      // gagal/berakhir
      if (status==='expire' || status==='cancel' || status==='deny') {
        await releaseStock({ order_id }).catch(()=>{});
        const meta = ORDERS.get(order_id);
        if (meta?.timer) clearTimeout(meta.timer);
        if (meta?.chatId) {
          await client.sendMessage(meta.chatId, `❌ Pembayaran *${status}*. Order dibatalkan dan stok dikembalikan.`);
          // 🔥 hapus QR/Invoice supaya chat tidak membingungkan
          await deleteOrderMessages(meta);
        }
        ORDERS.delete(order_id);
        return res.send('ok');
      }

      return res.send('ok');
    }catch(e){
      console.error('webhook midtrans:', e);
      res.status(500).send('error');
    }
  });

  app.post('/admin/reload', async (req, res) => {
    try {
      if (!ENV.ADMIN_SECRET || req.body?.secret !== ENV.ADMIN_SECRET) return res.status(401).send('forbidden');
      const what = (req.body?.what || 'all').toLowerCase();
      if (what === 'produk' || what === 'all') { await loadProducts(true); }
      if (what === 'promo'  || what === 'all') { await loadPromos(true); }
      if (req.body?.note) await notifyAdmins(client, `♻️ Reload diminta: ${req.body.note}`);
      return res.json({ ok:true, promos: getPromos().length });
    } catch (e) {
      console.error('admin/reload:', e);
      return res.status(200).json({ ok:false, error: String(e) });
    }
  });

  app.post('/admin/lowstock', async (req, res) => {
    try {
      if (!ENV.ADMIN_SECRET || req.body?.secret !== ENV.ADMIN_SECRET) return res.status(401).send('forbidden');
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.json({ ok:true });
      let msg = ['⚠️ *Low Stock Alert*'];
      for (const it of items) msg.push(`• ${it.kode}: ready ${it.ready}`);
      await notifyAdmins(client, msg.join('\n'));
      return res.json({ ok:true });
    } catch (e) {
      console.error('admin/lowstock:', e);
      return res.status(200).json({ ok:false, error: String(e) });
    }
  });

  return app;
}
