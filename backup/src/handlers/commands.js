import QR from 'qrcode';
import { MessageMedia } from '../whatsapp/client.js';
import { ENV } from '../config/env.js';
import { IDR, paginate, toID } from '../utils/index.js';
import { loadProducts, categories, searchProducts, byKode, getAll as getProducts } from '../data/products.js';
import { loadPromos, getPromos, isPromoValidFor, applyPromo } from '../data/promos.js';
import { reserveStock, finalizeStock, releaseStock } from '../services/gas.js';
import { cardHeader, cardProduk } from '../formatters/cards.js';
import { formatTransaksiSuksesBox, formatAccountDetailsStacked } from '../formatters/transactions.js';
import { createMidtransQRISCharge, createMidtransInvoice, midtransStatus } from '../payments/midtrans.js';
import { isLikelyQuery, cleanQuery } from '../intent/smartIntent.js';
import { ORDERS, SENT_ORDERS, LAST_SEEN } from '../whatsapp/state.js';
import { isSenderAdminInThisGroup, isSelfAdminInThisGroup, setGroupSendMode, assertGroupAndAdmin } from '../services/group.js';
import { loadPaymentLines } from '../data/payments.js';

const chunk = (arr, size = 90) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/* ================= Commands ================= */
const COMMANDS = [
  '#menu', '#ping', '#kategori', '#list', '#harga', '#detail',
  '#beli', '#buynow', '#status', '#refresh', '#h'
];

export function installCommandHandler(client) {
  client.on('message', async (msg) => {
    try {
      const text = (msg.body || '').trim();
      const from = msg.from;
      if (msg.isStatus) return;

      const looksLikeCommand = /^[#\/!]/.test(text);
      const likelyQuery = isLikelyQuery(text);

      if (!looksLikeCommand && !likelyQuery) return;

      // cooldown
      const now = Date.now();
      const last = LAST_SEEN.get(from) || 0;
      if (now - last < ENV.COOLDOWN_MS) return;
      LAST_SEEN.set(from, now);

      try { await msg.react('⏳'); } catch {}

      /* ---------- #menu ---------- */
      if (/^#menu$/i.test(text)) {
        await msg.reply([
          '📜 *Menu Bot*',
          '• #ping',
          '• #kategori',
          '• #list [kategori] [hal]',
          '• #harga <keyword>',
          '• #detail <kode>',
          '• #beli <kode>',
          '• #buynow <kode> <jumlah> [PROMO]',
          '• #status <OrderID>',
          '• #h <pesan>  (tag semua member – admin grup saja)',
          ENV.ADMIN_JIDS.has(from) ? '• #refresh (admin)' : null
        ].filter(Boolean).join('\n'));
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #ping ---------- */
      if (/^#ping$/i.test(text)) {
        await msg.reply('Pong ✅ Bot aktif.');
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #refresh (admin) ---------- */
      if (/^#refresh$/i.test(text)) {
        if (!ENV.ADMIN_JIDS.has(from)) {
          await msg.reply('❌ Hanya admin.');
          try { await msg.react('❌'); } catch {}
          return;
        }
        await Promise.all([loadProducts(true), loadPromos(true)]);
        await msg.reply(`✅ Reload sukses. Items: ${getProducts().length} | Promos: ${getPromos().length}`);
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #kategori ---------- */
      if (/^#kategori$/i.test(text)) {
        await loadProducts();
        const cats = categories();
        await msg.reply(cats.length ? `🗂️ *Kategori*\n• ${cats.join('\n• ')}` : 'Belum ada kategori.');
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #list ---------- */
      if (/^#list\b/i.test(text)) {
        await loadProducts();
        const parts = text.split(/\s+/).slice(1);
        let cat = ''; let page = 1;
        if (parts.length === 1 && /^\d+$/.test(parts[0])) page = Number(parts[0]);
        else if (parts.length >= 1) {
          const last = parts[parts.length - 1];
          if (/^\d+$/.test(last)) { page = Number(last); cat = parts.slice(0, -1).join(' '); }
          else { cat = parts.join(' '); }
        }
        let data = getProducts();
        if (cat) data = data.filter(p => (p.kategori || '').toLowerCase().includes((cat || '').toLowerCase()));
        const { items, page: p, total } = paginate(data, page, 8);
        if (!items.length) {
          await msg.reply(cat ? `Tidak ada produk untuk kategori *${cat}*.` : 'Belum ada produk.');
          try { await msg.react('❌'); } catch {}
          return;
        }
        const chunks = [cardHeader(ENV.ADMIN_CONTACT || '-'), ...items.map(cardProduk)];
        await msg.reply(chunks.join('\n\n') + `\n\nHalaman ${p}/${total} — *#list ${cat ? cat + ' ' : ''}${p + 1}* untuk berikutnya.`);
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #harga / #cari ---------- */
      if (/^#(harga|cari)\b/i.test(text)) {
        await loadProducts();
        const q = text.replace(/^#(harga|cari)\s*/i, '');
        if (!q) { await msg.reply('Format: *#harga <kata kunci>*'); try { await msg.react('❌'); } catch {} return; }
        const found = searchProducts(q).slice(0, 6);
        if (!found.length) { await msg.reply('❌ Tidak ditemukan.'); try { await msg.react('❌'); } catch {} return; }
        const chunks = [cardHeader(ENV.ADMIN_CONTACT || '-'), ...found.map(cardProduk)];
        await msg.reply(chunks.join('\n\n'));
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #detail ---------- */
      if (/^#detail\s+/i.test(text)) {
        await loadProducts();
        const code = text.split(/\s+/)[1] || '';
        const p = byKode(code);
        if (!p) { await msg.reply('Kode tidak ditemukan.'); try { await msg.react('❌'); } catch {} return; }
        const cap = [cardHeader(ENV.ADMIN_CONTACT || '-'), cardProduk(p)].join('\n\n');
        if (ENV.SHOW_PRODUCT_IMAGE && p.ikon && /^https?:\/\//i.test(p.ikon)) {
          try { const media = await MessageMedia.fromUrl(p.ikon); await msg.reply(media, undefined, { caption: cap }); }
          catch { await msg.reply(cap); }
        } else { await msg.reply(cap); }
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #beli ---------- */
      if (/^#beli\s+/i.test(text)) {
        await loadProducts();
        const code = text.split(/\s+/)[1] || '';
        const p = byKode(code); if (!p) { await msg.reply('Kode tidak ditemukan.'); try { await msg.react('❌'); } catch {} return; }
        const link = `https://wa.me/${toID(p.wa || ENV.ADMIN_CONTACT)}?text=${encodeURIComponent(`Halo admin, saya ingin beli ${p.nama} (kode: ${p.kode}).`)}`;
        await msg.reply(`Silakan order ke admin:\n${link}`);
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- #buynow ---------- */
      if (/^#buynow\s+/i.test(text)) {
        await Promise.all([loadProducts(), loadPromos()]);
        const m = text.match(/^#buynow\s+(\S+)(?:\s+(\d+))?(?:\s+(\S+))?/i);
        const code = m?.[1] || ''; const qty = Math.max(1, Number(m?.[2] || '1') || 1);
        const promoCode = (m?.[3] || '').toUpperCase();
        const p = byKode(code); if (!p) { await msg.reply('Kode tidak ditemukan. Contoh: *#buynow spo3b 1*'); try { await msg.react('❌'); } catch {} return; }

        const order_id = `PBS-${Date.now()}`;
        const unitPrice = Number(p.harga) || 0;
        let total = unitPrice * qty;

        let promoInfo = '';
        if (promoCode && getPromos().length) {
          const promo = getPromos().find(x => x.code === promoCode);
          if (!promo) {
            promoInfo = '\n( Kode promo tidak dikenal )';
          } else {
            const chk = isPromoValidFor(promo, { kode: p.kode, qty, total });
            if (!chk.ok) {
              promoInfo = `\n( Promo tidak valid: ${chk.reason} )`;
            } else {
              const disc = applyPromo(promo, { total });
              if (disc > 0) {
                total = Math.max(0, total - disc);
                promoInfo = `\n( Promo ${promo.label || promo.code}: -${IDR(disc)} )`;
              }
            }
          }
        } else if (promoCode) {
          promoInfo = '\n( Promo data belum dikonfigurasi )';
        }

        const reserve = await reserveStock({ kode: p.kode, qty, order_id, buyer_jid: from });
        if (!reserve.ok) { await msg.reply('Maaf, stok tidak mencukupi. Coba kurangi jumlah / pilih produk lain.'); try { await msg.react('❌'); } catch {} return; }

        // simpan meta order (tambahkan toDelete untuk menyimpan pesan yang akan dihapus)
        ORDERS.set(order_id, {
          chatId: from,
          kode: p.kode,
          qty,
          buyerPhone: toID(from),
          total,
          unit_price: unitPrice,
          product_name: p.nama || code,
          toDelete: []                 // <<— penting untuk auto-delete setelah sukses
        });

        const timer = setTimeout(async () => {
          if (ORDERS.has(order_id) && !SENT_ORDERS.has(order_id)) {
            await releaseStock({ order_id }).catch(() => { });
            const meta = ORDERS.get(order_id);
            if (meta?.chatId) {
              await client.sendMessage(meta.chatId, '⚠️ Pembayaran belum diterima dan order dibatalkan otomatis. Silakan #buynow lagi bila masih ingin membeli.');
            }
            ORDERS.delete(order_id);
          }
        }, ENV.PAY_TTL_MS);
        ORDERS.get(order_id).timer = timer;

        if (ENV.PAY_PROV === 'midtrans') {
          try {
            const charge = await createMidtransQRISCharge({ order_id, gross_amount: total });

            let payLink = '';
            if (Array.isArray(charge?.actions)) {
              const prefer = (names) => charge.actions.find(a => names.some(n => (a?.name || '').toLowerCase().includes(n)));
              const a1 = prefer(['desktop', 'web']);
              const a2 = prefer(['mobile']);
              const a3 = prefer(['deeplink']);
              const aAny = charge.actions[0];
              payLink = (a1?.url || a2?.url || a3?.url || aAny?.url || '');
            }

            const qrString = charge?.qr_string || '';
            let media = null;
            if (qrString) {
              const buf = await QR.toBuffer(qrString, { type: 'png', width: 512, margin: 1 });
              media = new MessageMedia('image/png', buf.toString('base64'), `qris-${order_id}.png`);
            }

            const caption = [
              '🧾 *Order dibuat!*',
              `Order ID: ${order_id}`,
              `Produk: ${p.nama} x ${qty}`,
              `Subtotal: ${IDR(unitPrice * qty)}`,
              promoInfo ? promoInfo : '',
              `Total Bayar: ${IDR(total)}`,
              '',
              'Silakan scan QRIS berikut untuk membayar.',
              payLink ? `Link Checkout: ${payLink}` : '(Jika QR tidak muncul, balas: *#buynow* lagi.)'
            ].filter(Boolean).join('\n');

            // === kirim & simpan ID pesan untuk auto-delete ===
            let sentMsg;
            if (media) sentMsg = await msg.reply(media, undefined, { caption });
            else sentMsg = await msg.reply(caption + (qrString ? `\n\nQR String:\n${qrString}` : ''));

            const meta = ORDERS.get(order_id);
            if (sentMsg?.id?._serialized) meta?.toDelete?.push(sentMsg.id._serialized);

            try { await msg.react('✅'); } catch {}
            return;
          } catch (e) {
            console.error('qris:', e);
            const inv = await createMidtransInvoice({
              order_id, gross_amount: total, customer_phone: toID(from), product_name: `${p.nama} x ${qty}`
            });
            const sent = await msg.reply(['⚠️ QRIS sedang bermasalah, fallback ke link:', inv.redirect_url].join('\n'));
            const meta = ORDERS.get(order_id);
            if (sent?.id?._serialized) meta?.toDelete?.push(sent.id._serialized);
            try { await msg.react('✅'); } catch {}
            return;
          }
        }

        await msg.reply('Provider pembayaran belum dikonfigurasi.');
        try { await msg.react('❌'); } catch {}
        return;
      }

      /* ---------- #status ---------- */
      if (/^#status\s+/i.test(text)) {
        const order_id = text.split(/\s+/)[1] || '';
        if (!order_id) { await msg.reply('Format: *#status <OrderID>*'); try { await msg.react('❌'); } catch {} return; }
        try {
          const st = await midtransStatus(order_id);
          const status = (st.transaction_status || '-').toUpperCase();
          const payT = (st.payment_type || '-').toUpperCase();
          const amt = IDR(st.gross_amount || 0);
          const tTime = new Date(st.transaction_time || '').toLocaleString('id-ID');
          const sTime = st.settlement_time ? '\n- Settled: ' + new Date(st.settlement_time).toLocaleString('id-ID') : '';
          await msg.reply([
            `📦 *Status Order* ${order_id}`,
            `- Status: ${status}`,
            `- Metode: ${payT}`,
            `- Nominal: ${amt}`,
            `- Dibuat: ${tTime}${sTime}`
          ].join('\n'));
          try { await msg.react('✅'); } catch {}
        } catch (e) {
          console.error('status:', e);
          await msg.reply('❌ OrderID tidak ditemukan atau belum ada transaksi.');
          try { await msg.react('❌'); } catch {}
        }
        return;
      }

      /* ---------- #payment / payment ---------- */
      if (/^#payment$/i.test(text) || /^payment$/i.test(text)) {
        try {
          if (!ENV.SHEET_URL_PAYMENT) {
            await msg.reply("SHEET_URL_PAYMENT belum dikonfigurasi di .env");
            try { await msg.react('❌'); } catch {}
            return;
          }

          const lines = await loadPaymentLines(ENV.SHEET_URL_PAYMENT);
          if (!lines.length) {
            await msg.reply("Daftar metode pembayaran kosong.");
            try { await msg.react('❌'); } catch {}
            return;
          }

          // cari URL gambar (mis. qris.png) untuk dikirim sebagai image
          const imgUrl = lines.find(
            l => /^https?:\/\//i.test(l) && /\.(png|jpe?g|webp)$/i.test(l)
          );

          const caption = lines.filter(l => l !== imgUrl).join('\n');

          if (imgUrl) {
            try {
              const media = await MessageMedia.fromUrl(imgUrl);
              await msg.reply(media, undefined, { caption });
            } catch {
              // kalau gagal ambil gambar, kirim teks biasa + URL
              const textOut = [caption, imgUrl].filter(Boolean).join('\n');
              await msg.reply(textOut);
            }
          } else {
            await msg.reply(caption);
          }

          try { await msg.react('✅'); } catch {}
        } catch (e) {
          console.error('payment cmd error:', e);
          await msg.reply("Gagal memuat data payment. Coba lagi atau cek URL CSV.");
          try { await msg.react('❌'); } catch {}
        }
        return;
      }

      /* ---------- #open / #close (ubah mode kirim pesan grup) ---------- */
      if (text === '#open' || text === '#close') {
        const chat = await msg.getChat();

        // Hanya untuk grup
        if (!chat?.isGroup) {
          await msg.reply('Perintah ini hanya bisa digunakan di dalam *Group*.');
          try { await msg.react('❌'); } catch {}
          return;
        }

        // Pengirim harus admin grup
        const senderIsAdmin = await isSenderAdminInThisGroup(msg, chat);
        if (!senderIsAdmin) {
          await msg.reply('Perintah ini hanya untuk *Admin* grup.');
          try { await msg.react('❌'); } catch {}
          return;
        }

        // Bot juga harus admin agar bisa ubah setting grup
        const botIsAdmin = await isSelfAdminInThisGroup(client, chat);
        if (!botIsAdmin) {
          await msg.reply('Aku belum jadi *Admin* di grup ini, tidak bisa ubah pengaturan. Jadikan admin dulu ya.');
          try { await msg.react('❌'); } catch {}
          return;
        }

        try { await msg.react('⏳'); } catch {}

        try {
          const adminsOnly = (text === '#close'); // close = hanya admin boleh kirim
          await setGroupSendMode(client, chat, adminsOnly);

          if (adminsOnly) {
            await msg.reply('🔒 Grup *ditutup*. Hanya *Admin* yang bisa mengirim pesan sekarang.');
          } else {
            await msg.reply('🔓 Grup *dibuka*. Semua anggota bisa mengirim pesan.');
          }
          try { await msg.react('✅'); } catch {}
        } catch (err) {
          console.error('Error #open/#close:', err);
          await msg.reply('Gagal mengubah pengaturan kirim pesan grup. Cek versi *whatsapp-web.js* atau izin admin.');
          try { await msg.react('❌'); } catch {}
        }
        return;
      }

      /* ---------- #h (tag-all oleh admin grup) ---------- */
      if (/^#h\b/i.test(text)) {
        const check = await assertGroupAndAdmin(msg);
        if (!check.ok) {
          if (check.reason === 'not_group') { await msg.reply('❌ Perintah ini hanya untuk *grup*.'); }
          else if (check.reason === 'not_admin') { await msg.reply('❌ Hanya *admin grup* yang bisa memakai perintah ini.'); }
          try { await msg.react('❌'); } catch {}
          return;
        }

        const chat = check.chat; // GroupChat
        const payload = text.replace(/^#h\s*/i, '').trim();
        const messageText = payload || '(tanpa pesan)';

        const idsAll = chat.participants.map(p => p.id._serialized);

        const batches = chunk(idsAll, 90);
        for (const idsBatch of batches) {
          const mentions = await Promise.all(idsBatch.map(id => client.getContactById(id)));
          await chat.sendMessage(messageText, { mentions });
          await new Promise(r => setTimeout(r, 400)); // throttle kecil
        }

        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- Smart intent ---------- */
      if (likelyQuery) {
        await loadProducts();
        const rawQ = cleanQuery(text);
        const mPage = rawQ.match(/\s+(\d{1,3})$/);
        const pageReq = mPage ? Number(mPage[1]) : 1;
        const q = mPage ? rawQ.replace(/\s+\d{1,3}$/, '').trim() : rawQ;

        const pByCode = byKode(q);
        if (pByCode) {
          const cap = [cardHeader(ENV.ADMIN_CONTACT || '-'), cardProduk(pByCode)].join('\n\n');
          if (ENV.SHOW_PRODUCT_IMAGE && pByCode.ikon && /^https?:\/\//i.test(pByCode.ikon)) {
            try { const media = await MessageMedia.fromUrl(pByCode.ikon); await msg.reply(media, undefined, { caption: cap }); }
            catch { await msg.reply(cap); }
          } else { await msg.reply(cap); }
          try { await msg.react('✅'); } catch {}
          return;
        }

        const cats = categories();
        const catHit = cats.find(c => (c || '').toLowerCase().includes((q || '').toLowerCase()));
        if (catHit) {
          const data = getProducts().filter(p => (p.kategori || '').toLowerCase().includes((catHit || '').toLowerCase()));
          const { items, page, total } = paginate(data, pageReq, 8);
          if (!items.length) { await msg.reply(`Tidak ada produk untuk kategori *${catHit}*.`); try { await msg.react('❌'); } catch {} return; }
          const chunks = [cardHeader(ENV.ADMIN_CONTACT || '-'), ...items.map(cardProduk)];
          chunks.push(`\nHalaman ${page}/${total} — ketik: *${catHit} ${page + 1}* untuk berikutnya.`);
          await msg.reply(chunks.join('\n\n'));
          try { await msg.react('✅'); } catch {}
          return;
        }

        const found = searchProducts(q);
        if (!found.length) { await msg.reply('❌ Tidak ditemukan. Coba ketik nama produk/kode yang lebih spesifik.'); try { await msg.react('❌'); } catch {} return; }
        if (found.length === 1) {
          const p = found[0];
          const cap = [cardHeader(ENV.ADMIN_CONTACT || '-'), cardProduk(p)].join('\n\n');
          if (ENV.SHOW_PRODUCT_IMAGE && p.ikon && /^https?:\/\//i.test(p.ikon)) {
            try { const media = await MessageMedia.fromUrl(p.ikon); await msg.reply(media, undefined, { caption: cap }); }
            catch { await msg.reply(cap); }
          } else { await msg.reply(cap); }
          try { await msg.react('✅'); } catch {}
          return;
        }

        const { items, page, total } = paginate(found, pageReq, 8);
        const chunks = [cardHeader(ENV.ADMIN_CONTACT || '-'), ...items.map(cardProduk)];
        if (total > 1) chunks.push(`\nHalaman ${page}/${total} — ketik: *${q} ${page + 1}* untuk berikutnya.`);
        await msg.reply(chunks.join('\n\n'));
        try { await msg.react('✅'); } catch {}
        return;
      }

      /* ---------- Fallback unknown commands ---------- */
      if (looksLikeCommand) {
        const lower = text.toLowerCase();
        const suggest = COMMANDS.filter(c => c.includes(lower.replace(/[#\s]+/g, ''))).slice(0, 4);
        let help = '❌ Perintah tidak ditemukan.\n';
        help += 'Coba salah satu ini:\n• ' + COMMANDS.join('\n• ');
        if (suggest.length) help = '❌ Perintah tidak ditemukan.\nMungkin maksud Anda:\n• ' + suggest.join('\n• ');
        await msg.reply(help);
        try { await msg.react('❌'); } catch {}
        return;
      }

    } catch (e) {
      console.error('handler:', e);
      try { await msg.reply('⚠️ Terjadi error. Coba lagi nanti.'); } catch {}
      try { await msg.react('❌'); } catch {}
    }
  });
}
