import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { startIsolatedPostgres } from '../src/tests/helpers/isolated-postgres.js';
dotenv.config({path:'.env.local',quiet:true,override:true});
dotenv.config({quiet:true});
const secret=process.env.JWT_SECRET || randomBytes(32).toString('hex');
let stop: (()=>Promise<void>)|undefined;
try {
  const database=await startIsolatedPostgres();
  process.env.NODE_ENV='development';process.env.JWT_SECRET=secret;
  const {runMigrations}=await import('../src/database/migrator.js');
  const {pool}=await import('../src/database/connection.js');
  stop=async()=>{await pool.end();await database.stop();};
  await runMigrations();
  const {createLocalDemo}=await import('../src/services/local-demo.service.js');
  const demo=await createLocalDemo();
  const {createApp}=await import('../src/app.js');
  const {createLocalDemoRouter}=await import('../src/routes/local-demo.routes.js');
  const {startWhatsAppWorker}=await import('../src/services/whatsapp/whatsapp.worker.js');
  const server=createApp(createLocalDemoRouter(demo)).listen(5100,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const stopWorker=startWhatsAppWorker(demo.transport);
  stop=async()=>{await stopWorker();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await database.stop();};
  console.log('Local API ready at http://127.0.0.1:5100. Open the localhost demo on the sign-in screen. Messages and orders use a temporary database; replies stay in the app.');
  let stopping=false;
  const shutdown=async()=>{if(stopping)return;stopping=true;await stop?.();if(process.connected)process.disconnect();};
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
  process.on('message',message=>{if(message==='shutdown')void shutdown();});
}catch(error){
  console.error('Local demo could not start.',{code:(error as any)?.code||'LOCAL_START_FAILED'});
  await stop?.().catch(()=>undefined);process.exitCode=1;
}
