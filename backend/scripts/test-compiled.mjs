import { spawnSync } from 'node:child_process';
import { closeSync,openSync,readFileSync } from 'node:fs';
import { cp,mkdtemp,readdir,rm,symlink,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs without tsx/esbuild native binaries. Each DB suite creates its own disposable database.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const selected=process.argv.slice(2);
const names=selected.length?selected:await readdir(join(root,'src/tests')).then(names=>names.filter(name=>name.endsWith('.test.ts')));
if(names.some(name=>!/^[-\w]+(?:\.[-\w]+)*\.test\.ts$/.test(name)))throw new Error('Pass test filenames, for example whatsapp.test.ts');
const directory=await mkdtemp(join(tmpdir(),'orderledger-compiled-tests-'));
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'test',JWT_SECRET:'compiled-disposable-test-secret',DATABASE_URL:''}});if(result.error)throw result.error;return result.status??1;}
try {
  const compiled=run(['node_modules/typescript/bin/tsc','-p','tsconfig.tests.json','--noEmit','false','--outDir',directory,'--module','NodeNext','--moduleResolution','NodeNext']);
  if(compiled)process.exitCode=compiled;
  else {
    await writeFile(join(directory,'package.json'),'{"type":"module"}\n');
    await symlink(join(root,'node_modules'),join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
    await cp(join(root,'src/database/migrations'),join(directory,'src/database/migrations'),{recursive:true});
    await cp(join(root,'src/assets'),join(directory,'src/assets'),{recursive:true});
    await cp(join(root,'scripts/setup-local.mjs'),join(directory,'scripts/setup-local.mjs'));
    for(const name of names){
      const stdoutPath=join(directory,name+'.stdout'),stderrPath=join(directory,name+'.stderr');
      const stdoutFd=openSync(stdoutPath,'w'),stderrFd=openSync(stderrPath,'w');
      let result;
      try {result=spawnSync(process.execPath,[join(directory,'src/tests',name.replace(/\.ts$/,'.js'))],{
        cwd:root,stdio:['inherit',stdoutFd,stderrFd],env:{...process.env,NODE_ENV:'test',JWT_SECRET:'compiled-disposable-test-secret',DATABASE_URL:''}
      });}finally{closeSync(stdoutFd);closeSync(stderrFd);}
      const stdout=readFileSync(stdoutPath,'utf8'),stderr=readFileSync(stderrPath,'utf8');
      process.stdout.write(stdout);process.stderr.write(stderr);
      if(result.error)throw result.error;
      const code=result.status||(/^not ok\b/m.test(stdout)||/^# (?:fail|cancelled) [1-9]/m.test(stdout)?1:0);
      if(code){process.exitCode=code;break;}
    }
  }
} finally {await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
