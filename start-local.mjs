import { spawn,spawnSync } from 'node:child_process';
import { existsSync,lstatSync } from 'node:fs';
import { cp,rename,rm } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const win=process.platform==='win32';
const npm=win?'npm.cmd':'npm';
function runNpm(args,cwd){const result=spawnSync(npm,args,{cwd,stdio:'inherit',shell:win});if(result.error || result.status!==0)throw new Error('Dependency installation failed. Check npm/network access and retry.');}
async function dependencies(name) {
  const cwd=join(root,name),modules=join(cwd,'node_modules');
  let ready=false;
  if(existsSync(modules) && !lstatSync(modules).isSymbolicLink()) {
    try {await import(name==='frontend'?new URL('./frontend/node_modules/rollup/dist/native.js',import.meta.url):new URL('./backend/node_modules/embedded-postgres/dist/index.js',import.meta.url));ready=true;}catch{}
  }
  if(ready)return;
  const backup=join(cwd,'.local-dependencies-reference');
  const linked=existsSync(modules)&&lstatSync(modules).isSymbolicLink();
  if(linked){if(existsSync(backup))throw new Error('Remove the stale local dependency reference before retrying.');await rename(modules,backup);}
  try {runNpm(['ci','--no-audit','--no-fund'],cwd);if(linked)await rm(backup,{force:true});}
  catch(error){if(linked){await rm(modules,{recursive:true,force:true});await rename(backup,modules);}throw error;}
}
let api,frontend;
const stopApi=()=>{if(api?.connected)api.send('shutdown',()=>{});else api?.kill('SIGTERM');};
try {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Use Node.js 22 or newer.');
  await dependencies('backend');
  const platform=win?'windows':process.platform;
  const binaryRoot=join(root,'backend/node_modules/@embedded-postgres',platform+'-'+process.arch);
  const hydration=join(binaryRoot,'scripts/hydrate-symlinks.js');
  if(existsSync(hydration)){
    const hydrated=spawnSync(process.execPath,[hydration],{cwd:binaryRoot,stdio:'inherit'});
    if(hydrated.error || hydrated.status!==0)throw new Error('Embedded PostgreSQL setup failed.');
  }
  const {setupLocalEnvironment}=await import('./backend/scripts/setup-local.mjs');
  const sourceIndex=process.argv.indexOf('--env-source');
  const status=setupLocalEnvironment(root,sourceIndex>=0?process.argv[sourceIndex+1]:undefined);
  console.log('Local credentials:',{geminiConfigured:status.geminiConfigured,groqConfigured:status.groqConfigured});
  if(!status.geminiConfigured && !status.groqConfigured)throw new Error('Add your Gemini or Groq key to backend/.env.local, then retry.');
  await dependencies('frontend');
  // npm can skip install scripts; Vite still needs the binary for this operating system.
  const esbuild=spawnSync(process.execPath,['node_modules/esbuild/install.js'],{cwd:join(root,'frontend'),stdio:'inherit'});
  if(esbuild.error || esbuild.status!==0)throw new Error('The local frontend dependency setup failed.');
  const built=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.tests.json','--noEmit','false','--outDir','.local-build','--module','NodeNext','--moduleResolution','NodeNext'],{cwd:join(root,'backend'),stdio:'inherit'});
  if(built.error || built.status!==0)throw new Error('The local backend build failed.');
  await cp(join(root,'backend/src/database/migrations'),join(root,'backend/.local-build/src/database/migrations'),{recursive:true});
  await cp(join(root,'backend/src/assets'),join(root,'backend/.local-build/src/assets'),{recursive:true});
  api=spawn(process.execPath,['.local-build/scripts/dev-local.js'],{cwd:join(root,'backend'),stdio:['inherit','inherit','inherit','ipc']});
  let ready=false;
  for(let attempt=0;attempt<120;attempt++) {
    if(api.exitCode!==null)throw new Error('The local API could not start. Check the message above.');
    try {const response=await fetch('http://127.0.0.1:5100/api/local-demo/status',{signal:AbortSignal.timeout(1000)});const value=await response.json();if(response.ok && value.available && value.replies==='local'){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw new Error('The disposable database/API did not become ready.');
  frontend=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],{cwd:join(root,'frontend'),stdio:'inherit'});
  console.log('Open http://127.0.0.1:5174 and click Open localhost demo, then WhatsApp inbox. Press Ctrl+C to stop both servers.');
  const stop=()=>{frontend?.kill('SIGTERM');stopApi();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  frontend.once('exit',code=>{stopApi();process.exitCode=code||0;});
  api.once('exit',code=>{frontend?.kill('SIGTERM');if(code)process.exitCode=code;});
}catch(error){frontend?.kill('SIGTERM');api?.kill('SIGTERM');console.error(error.message);process.exitCode=1;}
