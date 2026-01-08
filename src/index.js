import { ENV } from './config/env.js';
import { createClient, installQRHandlers } from './whatsapp/client.js';
import { installCommandHandler } from './handlers/commands.js';
import { createApp } from './handlers/express.js';
import { loadProducts } from './data/products.js';
import { loadPromos } from './data/promos.js';

const client = createClient();
const { getLastQR, clear } = installQRHandlers(client);
console.log('🚀 Starting WhatsApp socket...');
await client.init();

client.on('ready', async ()=>{
  clear();
  console.log('✅ Bot siap! (Local/Server)');
  try {
    await loadProducts(true);
    await loadPromos(true);
    console.log('📦 Items & Promos siap dimuat');
  } catch (e) { console.error(e); }
});

installCommandHandler(client);
client.initialize();

const app = createApp({ getLastQR, client });

function startServer(port, attemptsLeft = 10) {
  const usePort = Number(port) || 3000;
  const server = app.listen(usePort, () => console.log('HTTP keepalive on :', usePort));
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const next = usePort + 1;
      console.warn(`Port ${usePort} in use, trying ${next}...`);
      setTimeout(() => startServer(next, attemptsLeft - 1), 300);
    } else {
      console.error('HTTP server error:', err);
      process.exit(1);
    }
  });
}

startServer(ENV.PORT);

process.on('SIGINT', async ()=>{
  console.log('\n🛑 Shutting down...');
  try{ await client.saveAuth?.(); }catch{}
  try{ await client.destroy(); }catch{}
  process.exit(0);
});

process.on('SIGTERM', async ()=>{
  console.log('\n🛑 Shutting down (SIGTERM)...');
  try{ await client.saveAuth?.(); }catch{}
  try{ await client.destroy(); }catch{}
  process.exit(0);
});

process.on('beforeExit', async ()=>{
  try{ await client.saveAuth?.(); }catch{}
});