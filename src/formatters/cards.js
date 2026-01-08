import { IDR, pipesToComma, isHttp } from '../utils/index.js';

export const cardHeader = (adminContact='-') => [
  `╭────〔 BOT CEK HARGA PBS 〕─`,
  `┊・Untuk melihat semua produk ketik perintah berikut`,
  `┊・#list (spasi) halaman`,
  `┊・Contoh: #list 1`,
  `┊・Untuk mencari produk ketik nama produk`,
  `┊・Contoh: Netflix, Youtube, viu, dll`,
  `┊・Contact Admin: ${adminContact}`,
  `╰┈┈┈┈┈┈┈┈`
].join('\n');

export function cardProduk(p){
  const hargaNow = IDR(p.harga);
  const hargaOld = `*${hargaNow}*`;
  const stokTersedia = p.stok || '-';
  const deskPretty = p.deskripsi ? pipesToComma(p.deskripsi) : '-';
  const aliasShow = p.alias ? `\n┊・Alias: ${p.alias}` : '';
  return [
    `*╭────〔 ${p.nama.toUpperCase()} 〕─*`,
    `┊・Harga: ${hargaOld}`,
    `┊・Stok Tersedia: ${stokTersedia}`,
    `┊・Kode: ${p.kode || '-'}`,
    `┊・Desk: ${deskPretty}${aliasShow}`,
    `╰┈┈┈┈┈┈┈┈`
  ].join('\n');
}