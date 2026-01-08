import { IDR, pipesToComma, isHttp } from '../utils/index.js';

export const cardHeader = (adminContact='-') => [
  `╭────〔 BOT AUTO ORDER 〕─`,
  `┊・Untuk membeli ketik perintah berikut`,
  `┊・#buynow Kode(spasi)JumlahAkun`,
  `┊・Ex: #buynow cc1b 1`,
  `┊・Contact Admin: ${adminContact}`,
  `╰┈┈┈┈┈┈┈┈`
].join('\n');

export function cardProduk(p){
  const hargaNow = IDR(p.harga);
  const hargaOld = p.harga_lama ? `~${IDR(p.harga_lama)}~ → *${hargaNow}*` : `*${hargaNow}*`;
  const stokTersedia = p.stok || '-';
  const stokTerjual = p.terjual || '-';
  const totalStok = p.total || (p.stok && p.terjual ? (Number(p.stok)+Number(p.terjual)) : '-');
  const deskPretty = p.deskripsi ? pipesToComma(p.deskripsi) : '-';
  const aliasShow = p.alias ? `\n┊・Alias: ${p.alias}` : '';
  return [
    `*╭────〔 ${p.nama.toUpperCase()} 〕─*`,
    `┊・Harga: ${hargaOld}`,
    `┊・Stok Tersedia: ${stokTersedia}`,
    `┊・Stok Terjual: ${stokTerjual}`,
    `┊・Total Stok: ${totalStok}`,
    `┊・Kode: ${p.kode || '-'}`,
    `┊・Desk: ${deskPretty}${aliasShow}`,
    `╰┈┈┈┈┈┈┈┈`
  ].join('\n');
}