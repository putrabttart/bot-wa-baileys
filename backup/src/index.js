import { ENV } from './config/env.js';
import { createClient, installQRHandlers } from './whatsapp/client.js';
import { installCommandHandler } from './handlers/commands.js';
import { createApp } from './handlers/express.js';
import { loadProducts } from './data/products.js';
import { loadPromos } from './data/promos.js';

const client = createClient();
const { getLastQR, clear } = installQRHandlers(client);

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
app.listen(ENV.PORT, ()=> console.log('HTTP keepalive on :', ENV.PORT));

process.on('SIGINT', async ()=>{
  console.log('\n🛑 Shutting down...');
  try{ await client.destroy(); }catch{}
  process.exit(0);
});