import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import QR from 'qrcode';
import { ENV } from '../config/env.js';

export { MessageMedia };

export function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: ENV.CLIENT_ID }),
    puppeteer: {
      headless: true,
      ...(ENV.EXEC_PATH ? { executablePath: ENV.EXEC_PATH } : {}),
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions']
    }
  });
  return client;
}

let lastQR = '';
export function installQRHandlers(client) {
  client.on('qr', (qr)=>{ lastQR=qr; console.log('Scan QR berikut:'); qrcode.generate(qr, { small:true }); });
  client.on('authenticated', ()=> lastQR = '');
  return {
    getLastQR: () => lastQR,
    clear: () => { lastQR = ''; }
  };
}