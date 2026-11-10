import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { config } from '../config/env.js';
import { createLocalDemoRouter } from '../routes/local-demo.routes.js';
import { LocalWhatsAppTransport,type LocalDemoService } from '../services/local-demo.service.js';
import { requestInProcess } from './helpers/http.js';

test('local credential import copies only AI keys, preserves its signing secret and respects a cleared key',async()=>{
  const {setupLocalEnvironment}=await import(new URL('../../scripts/setup-local.mjs',import.meta.url).href);
  const root=await mkdtemp(join(tmpdir(),'orderledger-local-credentials-'));
  try{
    await mkdir(join(root,'backend'));await mkdir(join(root,'frontend'));
    const source=join(root,'backend','.env');
    await writeFile(source,'GEMINI_API_KEY=synthetic-gemini\nGROQ_API_KEY=synthetic-groq\nDATABASE_URL=postgresql://private-business\nJWT_SECRET=private-business-secret\nWHATSAPP_TOKEN=private-meta-token\n');
    const result=setupLocalEnvironment(root);
    assert.equal(result.geminiConfigured,true);assert.equal(result.groqConfigured,true);
    const saved=dotenv.parse(await readFile(join(root,'backend','.env.local')));
    assert.equal(saved.GEMINI_API_KEY,'synthetic-gemini');assert.equal(saved.DATABASE_URL,undefined);assert.equal(saved.WHATSAPP_TOKEN,undefined);
    assert.notEqual(saved.JWT_SECRET,'private-business-secret');assert.equal(saved.JWT_SECRET.length,64);
    const frontend=dotenv.parse(await readFile(join(root,'frontend','.env.local')));
    assert.deepEqual(frontend,{VITE_API_URL:'http://127.0.0.1:5100'});
    if(process.platform!=='win32')assert.equal((await stat(join(root,'backend','.env.local'))).mode&0o777,0o600);
    await writeFile(join(root,'backend','.env.local'),'JWT_SECRET='+saved.JWT_SECRET+'\nGEMINI_API_KEY=\nGROQ_API_KEY=synthetic-replacement\n');
    setupLocalEnvironment(root);
    const repeated=dotenv.parse(await readFile(join(root,'backend','.env.local')));
    assert.equal(repeated.JWT_SECRET,saved.JWT_SECRET);assert.equal(repeated.GEMINI_API_KEY,'');assert.equal(repeated.GROQ_API_KEY,'synthetic-replacement');
    assert.match(await readFile(source,'utf8'),/JWT_SECRET=private-business-secret/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('local photo transport validates bytes and captures replies without any network call',async()=>{
  const transport=new LocalWhatsAppTransport();
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  const id=transport.addPhoto(png.toString('base64'),'image/png');
  assert.deepEqual((await transport.downloadMedia(id)).data,png);
  assert.throws(()=>transport.addPhoto(png.toString('base64'),'image/jpeg'),/image format/);
  assert.throws(()=>transport.addPhoto('%%%','image/png'),/JPEG or PNG/);
  assert.throws(()=>transport.addPhoto(Buffer.alloc(5*1024*1024+1).toString('base64'),'image/png'),/5 MB/);
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network calls are forbidden in local reply transport');};
  try{assert.match((await transport.sendTextMessage('919000000001','Test reply')).messageId,/^local-reply-/);}
  finally{globalThis.fetch=original;}
});
test('local demo routes are absent in a normal app and block remote hosts, remote clients and foreign origins',async()=>{
  const demo={status:()=>({available:true}),session:{business:{id:'10000000-0000-4000-8000-000000000001'},token:'synthetic'}} as unknown as LocalDemoService;
  assert.equal((await requestInProcess(createApp(),'GET','/api/local-demo/status')).status,404);
  const app=createApp(createLocalDemoRouter(demo));
  assert.equal((await requestInProcess(app,'GET','/api/local-demo/status')).status,200);
  assert.equal((await requestInProcess(app,'GET','/api/local-demo/status','',{host:'evil.example'})).status,403);
  assert.equal((await requestInProcess(app,'GET','/api/local-demo/status','',{origin:'https://evil.example'})).status,403);
  assert.equal((await requestInProcess(app,'GET','/api/local-demo/status','',{},'192.0.2.1')).status,403);
  const env=config.env;config.env='production';try{assert.throws(()=>createApp(createLocalDemoRouter(demo)),/unavailable in production/);}finally{config.env=env;}
});
test('local session requires its request header and message submission is owner/tenant scoped',async()=>{
  const businessId='10000000-0000-4000-8000-000000000001',customerId='10000000-0000-4000-8000-000000000002';
  let received=false;
  const demo={status:()=>({available:true}),session:{business:{id:businessId},token:'synthetic'},enqueue:async(customer:string,text:string)=>{assert.equal(customer,customerId);assert.equal(text,'Tomato 500 g');received=true;return {queued:true};}} as unknown as LocalDemoService;
  const app=createApp(createLocalDemoRouter(demo));
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/session','{}')).status,403);
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/session','{}',{'x-orderledger-local-demo':'1'})).status,200);
  const token=(role:string,tenant=businessId)=>jwt.sign({userId:'local',businessId:tenant,role},config.jwtSecret);
  const body=JSON.stringify({customerId,text:'Tomato 500 g'});
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/messages',body,{authorization:'Bearer '+token('STAFF')})).status,403);
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/messages',body,{authorization:'Bearer '+token('OWNER',customerId)})).status,403);
  assert.equal(received,false);
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/messages',body,{authorization:'Bearer '+token('OWNER')})).status,202);assert.equal(received,true);
  assert.equal((await requestInProcess(app,'POST','/api/local-demo/messages',JSON.stringify({customerId,text:''}),{authorization:'Bearer '+token('OWNER')})).status,400);
});
