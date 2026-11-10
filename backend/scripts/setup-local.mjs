import { existsSync,readFileSync,writeFileSync,chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const fields=['GEMINI_API_KEY','GROQ_API_KEY','AI_PRIMARY_PROVIDER','AI_PRIMARY_API_KEY','AI_PRIMARY_MODEL','AI_PRIMARY_VISION_MODEL','AI_FALLBACK_PROVIDER','AI_FALLBACK_API_KEY','AI_FALLBACK_MODEL','AI_FALLBACK_VISION_MODEL'];
/** Import only AI credentials. Never import the source database or authentication secrets. */
export function setupLocalEnvironment(root,sourcePath) {
  const backend=join(root,'backend');
  const destination=join(backend,'.env.local');
  const source=resolve(sourcePath||join(backend,'.env'));
  const original=existsSync(source)?dotenv.parse(readFileSync(source)):{};
  const current=existsSync(destination)?dotenv.parse(readFileSync(destination)):{};
  const values={NODE_ENV:'development',PORT:'5100',JWT_SECRET:current.JWT_SECRET||randomBytes(32).toString('hex'),JWT_EXPIRES_IN:'7d',PUBLIC_APP_URL:'http://127.0.0.1:5174',API_BASE_URL:'http://127.0.0.1:5100'};
  for(const key of fields)if(current[key]!==undefined)values[key]=current[key];else if(original[key])values[key]=original[key];
  writeFileSync(destination,Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600});chmodSync(destination,0o600);
  const frontend=join(root,'frontend','.env.local');
  const publicValues=existsSync(frontend)?dotenv.parse(readFileSync(frontend)):{};
  publicValues.VITE_API_URL='http://127.0.0.1:5100';
  writeFileSync(frontend,Object.entries(publicValues).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600});chmodSync(frontend,0o600);
  const hasKey=name=>!!(values[name==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY'] || ['AI_PRIMARY','AI_FALLBACK'].some(prefix=>values[prefix+'_PROVIDER']===name&&values[prefix+'_API_KEY']));
  return {geminiConfigured:hasKey('gemini'),groqConfigured:hasKey('groq'),environmentFile:destination};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  console.log(JSON.stringify(setupLocalEnvironment(root,process.argv[2])));
}
