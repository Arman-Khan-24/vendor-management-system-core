import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { config } from '../config/env.js';
import { WhatsAppRepository } from '../repositories/whatsapp.repo.js';
import type { WhatsAppRuntimeConnection } from '../services/whatsapp/whatsapp.provider.js';
import { requestInProcess } from './helpers/http.js';

// Exercise Express parsing/auth/routing without opening a network socket.
async function request(method: string,path: string,body='',headers: Record<string,string>={}) {
  return requestInProcess(createApp(),method,path,body,headers);
}
const businessId='10000000-0000-4000-8000-000000000001';
const connection:WhatsAppRuntimeConnection={businessId,enabled:true,phoneNumberId:'11111',wabaId:'22222',graphVersion:'v23.0',defaultCountryCode:'91',accessToken:'synthetic-token',appSecret:'synthetic-secret',verifyToken:'synthetic-verify'};

test('Meta GET challenge verifies the configured token and excludes an incorrect token',async()=>{
  const original=WhatsAppRepository.runtimeConnection;
  WhatsAppRepository.runtimeConnection=async()=>connection;
  try{
    const valid=await request('GET',`/webhooks/whatsapp/${businessId}?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345`);
    assert.equal(valid.status,200);assert.equal(valid.body,'12345');
    assert.equal((await request('GET',`/webhooks/whatsapp/${businessId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`)).status,403);
  }finally{WhatsAppRepository.runtimeConnection=original;}
});
test('signed webhook persists the batch before acknowledging, and modified JSON is rejected',async()=>{
  const runtime=WhatsAppRepository.runtimeConnection,record=WhatsAppRepository.recordInbound;
  let saved=false;
  WhatsAppRepository.runtimeConnection=async()=>connection;
  WhatsAppRepository.recordInbound=async(_connection,messages)=>{assert.equal(messages.length,1);saved=true;};
  try{
    const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'22222',changes:[{field:'messages',value:{metadata:{phone_number_id:'11111'},messages:[{id:'wamid.synthetic',from:'919000000001',type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body:'Tomato 2kg'}}]}}]}]});
    const signature='sha256='+createHmac('sha256',connection.appSecret).update(body).digest('hex');
    assert.equal((await request('POST',`/webhooks/whatsapp/${businessId}`,body,{'x-hub-signature-256':signature})).status,200);assert.equal(saved,true);
    saved=false;
    assert.equal((await request('POST',`/webhooks/whatsapp/${businessId}`,body.replace('2kg','3kg'),{'x-hub-signature-256':signature})).status,401);assert.equal(saved,false);
  }finally{WhatsAppRepository.runtimeConnection=runtime;WhatsAppRepository.recordInbound=record;}
});
test('WhatsApp history uses JWT tenant identity and connection writes require owner permission',async()=>{
  const original=WhatsAppRepository.list;
  WhatsAppRepository.list=async(id)=>{assert.equal(id,businessId);return [];};
  const staff=jwt.sign({userId:'test',businessId,role:'STAFF'},config.jwtSecret);
  try{
    assert.equal((await request('GET','/api/whatsapp/messages')).status,401);
    assert.equal((await request('GET','/api/whatsapp/messages?businessId=other','',{authorization:'Bearer '+staff})).status,200);
    assert.equal((await request('PATCH','/api/whatsapp/connection','{"enabled":true}',{authorization:'Bearer '+staff})).status,403);
    assert.equal((await request('POST','/api/whatsapp/jobs/10000000-0000-4000-8000-000000000002/retry','{}',{authorization:'Bearer '+staff})).status,403);
  }finally{WhatsAppRepository.list=original;}
});
test('disabled WhatsApp connections reject ingestion and obsolete mock endpoints are absent',async()=>{
  const original=WhatsAppRepository.runtimeConnection;
  WhatsAppRepository.runtimeConnection=async()=>({...connection,enabled:false});
  try{assert.equal((await request('POST',`/webhooks/whatsapp/${businessId}`,'{}')).status,503);
    assert.equal((await request('POST','/webhooks/whatsapp','{}')).status,404);
  }finally{WhatsAppRepository.runtimeConnection=original;}
});
