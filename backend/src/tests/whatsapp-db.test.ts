import { after,before,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { startIsolatedPostgres } from './helpers/isolated-postgres.js';
import type { WhatsAppRuntimeConnection,WhatsAppInboundMessage } from '../services/whatsapp/whatsapp.provider.js';
import type { WhatsAppJob } from '../repositories/whatsapp.repo.js';

// This suite always creates a disposable PostgreSQL instance; it never opens the user's DB.
let database: Awaited<ReturnType<typeof startIsolatedPostgres>>;
let pool: typeof import('../database/connection.js').pool;
let repo: typeof import('../repositories/whatsapp.repo.js').WhatsAppRepository;
let engine: typeof import('../services/order.processor.js').OrderProcessingEngine;
let aiFor: typeof import('../services/ai/business-ai.js').getBusinessAi;
let encrypt: typeof import('../services/business-settings.service.js').encryptSecret;
let connection: WhatsAppRuntimeConnection;
let customerId: string,productId: string;
const originalFetch=globalThis.fetch;
let extracted={items:[{product:'Tomato',quantity:500,unit:'g'}],warnings:[] as string[]};
let sends=0;
const png=Buffer.from([137,80,78,71,13,10,26,10]);

before(async()=>{
  database=await startIsolatedPostgres();
  ({pool}=await import('../database/connection.js'));
  await (await import('../database/migrator.js')).runMigrations();
  repo=(await import('../repositories/whatsapp.repo.js')).WhatsAppRepository;
  engine=(await import('../services/order.processor.js')).OrderProcessingEngine;
  aiFor=(await import('../services/ai/business-ai.js')).getBusinessAi;
  encrypt=(await import('../services/business-settings.service.js')).encryptSecret;
});
beforeEach(async()=>{
  await pool.query('TRUNCATE businesses CASCADE');
  const business=(await pool.query("INSERT INTO businesses(name,slug) VALUES('WhatsApp disposable','whatsapp-disposable') RETURNING id")).rows[0];
  customerId=(await pool.query("INSERT INTO customers(business_id,name,phone) VALUES($1,'Test customer','9000000001') RETURNING id",[business.id])).rows[0].id;
  productId=(await pool.query("INSERT INTO products(business_id,name,unit,current_price) VALUES($1,'Tomato','kg',40) RETURNING id",[business.id])).rows[0].id;
  await pool.query(`INSERT INTO business_connections(business_id,slot,provider,model,api_key_encrypted)
    VALUES($1,'primary','gemini','synthetic-model',$2)`,[business.id,encrypt('synthetic-key',business.id,'primary')]);
  await repo.updateConnection(business.id,{enabled:true,phoneNumberId:'11111',wabaId:'22222',graphVersion:'v23.0',
    accessToken:'synthetic-token',appSecret:'synthetic-secret',verifyToken:'synthetic-verify'});
  connection=await repo.runtimeConnection(business.id);
  extracted={items:[{product:'Tomato',quantity:500,unit:'g'}],warnings:[]};sends=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('googleapis.com')) return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(extracted)}]}}]});
    if(String(url).endsWith('/messages')) {sends++;return Response.json({messages:[{id:'wamid.out.'+randomUUID()}]});}
    if(String(url).includes('graph.facebook.com')) return Response.json({url:'https://lookaside.fbsbx.com/synthetic',mime_type:'image/png',file_size:8,sha256:createHash('sha256').update(png).digest('hex')});
    assert.equal(String(url),'https://lookaside.fbsbx.com/synthetic');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-token');
    return new Response(png);
  };
});
after(async()=>{globalThis.fetch=originalFetch;if(pool)await pool.end();if(database)await database.stop();});

function message(text='Tomato 500g',type: 'text'|'image'='text',ageMs=0): WhatsAppInboundMessage {
  return {providerMessageId:'wamid.in.'+randomUUID(),senderPhone:'919000000001',messageType:type,messageText:text,
    providerTimestamp:new Date(Date.now()+2000-ageMs).toISOString(),...(type==='image'?{mediaId:'33333',mediaMimeType:'image/png'}:{})};
}
async function ingest(input=message()) {await repo.recordInbound(connection,[input],[]);return input;}
async function step() {const job=await repo.claim();assert.ok(job,'Expected a ready job');await engine.processJob(job);return job;}
async function draft(type: 'text'|'image'='text') {await ingest(message(type==='image'?'Photo order':'Tomato 500g',type));await step();await step();
  return (await pool.query("SELECT * FROM pending_order_confirmations WHERE status='pending_confirmation'")).rows[0];}
async function orders() {return (await pool.query('SELECT * FROM orders')).rows;}

test('duplicate webhook is idempotent and an enqueue failure rolls back the inbound record',async()=>{
  const input=message();
  await pool.query(`CREATE FUNCTION reject_whatsapp_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER reject_whatsapp_job BEFORE INSERT ON whatsapp_jobs FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_job()`);
  try {await assert.rejects(()=>ingest(input));assert.equal((await pool.query('SELECT id FROM whatsapp_messages')).rowCount,0);}
  finally {await pool.query('DROP TRIGGER reject_whatsapp_job ON whatsapp_jobs; DROP FUNCTION reject_whatsapp_job()');}
  await Promise.all([ingest(input),ingest(input)]);
  assert.equal((await pool.query('SELECT id FROM whatsapp_messages')).rowCount,1);
  assert.equal((await pool.query('SELECT id FROM whatsapp_jobs')).rowCount,1);
});
test('text order sends a converted quote, then YES creates one ledger order despite duplicate replies',async()=>{
  const pending=await draft();assert.equal(pending.extracted_items[0].quantity,0.5);assert.equal(sends,1);
  await ingest(message('YES'));await ingest(message('YES'));await step();await step();
  const saved=await orders();assert.equal(saved.length,1);assert.equal(saved[0].source,'whatsapp_text');assert.equal(saved[0].status,'Received');
  const item=(await pool.query('SELECT * FROM order_items')).rows[0];assert.equal(Number(item.quantity),0.5);assert.equal(Number(item.total_price),20);
  assert.equal((await pool.query('SELECT key FROM write_receipts')).rowCount,1);
  assert.equal((await pool.query('SELECT id FROM invoices')).rowCount,0);
});
test('simultaneous YES transactions lock the pending quote and create exactly one order',async()=>{
  await draft();await ingest(message('YES'));await ingest(message('YES'));
  // Force two leases to exercise the final transaction defense independently of queue serialization.
  const jobs=(await pool.query("UPDATE whatsapp_jobs SET status='processing',lease_token=gen_random_uuid(),attempts=1,lease_until=NOW()+INTERVAL '3 minutes' WHERE kind='inbound' AND status='queued' RETURNING *")).rows as WhatsAppJob[];
  assert.equal(jobs.length,2);await Promise.all(jobs.map(job=>engine.handleConfirmation(job,customerId)));
  assert.equal((await orders()).length,1);
  assert.equal((await pool.query("SELECT id FROM pending_order_confirmations WHERE status='confirmed'")).rowCount,1);
});
test('confirmation failure rolls back order, receipt, quote and acknowledgement together',async()=>{
  await draft();await ingest(message('YES'));const job=await repo.claim();assert.ok(job);
  await pool.query(`CREATE FUNCTION reject_order_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.direction='outbound' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_order_ack BEFORE INSERT ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION reject_order_ack()`);
  try {await assert.rejects(()=>engine.processJob(job));assert.equal((await orders()).length,0);
    assert.equal((await pool.query('SELECT key FROM write_receipts')).rowCount,0);
    assert.equal((await pool.query("SELECT id FROM pending_order_confirmations WHERE status='pending_confirmation'")).rowCount,1);
    assert.equal((await pool.query('SELECT status FROM whatsapp_jobs WHERE id=$1',[job.id])).rows[0].status,'processing');
  } finally {await pool.query('DROP TRIGGER reject_order_ack ON whatsapp_messages; DROP FUNCTION reject_order_ack()');}
  await engine.processJob(job);assert.equal((await orders()).length,1);
});
test('expired quotes and changed prices cannot be confirmed',async()=>{
  const pending=await draft();await pool.query("UPDATE pending_order_confirmations SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[pending.id]);
  await ingest(message('YES'));await step();assert.equal((await orders()).length,0);
  await step();await draft();await pool.query('UPDATE products SET current_price=50 WHERE id=$1',[productId]);
  await ingest(message('YES'));await step();assert.equal((await orders()).length,0);
  assert.equal((await pool.query("SELECT id FROM pending_order_confirmations WHERE status='expired'")).rowCount,2);
});
test('uncertain corrections invalidate the earlier quote and owner review needs a fresh YES',async()=>{
  await draft();extracted={items:[{product:'Tomato',quantity:1,unit:'kg'}],warnings:['Quantity unclear']};
  await ingest(message('change quantity'));const correction=await step();await step();
  assert.equal((await pool.query("SELECT id FROM pending_order_confirmations WHERE status='pending_confirmation'")).rowCount,0);
  await engine.review(connection.businessId,correction.message_id,[{productId,quantity:2}]);
  assert.equal((await orders()).length,0);await step();await ingest(message('YES'));await step();
  assert.equal((await orders()).length,1);assert.equal(Number((await pool.query('SELECT quantity FROM order_items')).rows[0].quantity),2);
});
test('photo order downloads authenticated bytes and records the image source in the ledger',async()=>{
  const pending=await draft('image');assert.equal(pending.source_type,'whatsapp_image');assert.equal(pending.extracted_items[0].quantity,0.5);
  assert.equal((await pool.query('SELECT input_type FROM ai_extraction_audits')).rows[0].input_type,'image');
  await ingest(message('YES'));await step();assert.equal((await orders())[0].source,'whatsapp_image');
});
test('expired inbound leases recover, per-phone jobs stay ordered, and expired outbound leases require review',async()=>{
  await ingest();await ingest();const first=await repo.claim();assert.ok(first);assert.equal(await repo.claim(),null);
  await pool.query("UPDATE whatsapp_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[first.id]);
  const reclaimed=await repo.claim();assert.ok(reclaimed);assert.equal(reclaimed.id,first.id);assert.notEqual(reclaimed.lease_token,first.lease_token);
  await assert.rejects(()=>engine.processJob(first));await engine.processJob(reclaimed);await step();await step();
  const outbound=await repo.claim();assert.ok(outbound);assert.equal(outbound.kind,'outbound');
  await pool.query("UPDATE whatsapp_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[outbound.id]);
  assert.equal(await repo.claim(),null);
  assert.equal((await pool.query('SELECT error_code FROM whatsapp_jobs WHERE id=$1',[outbound.id])).rows[0].error_code,'DELIVERY_UNCONFIRMED');
});
test('callbacks arriving before send persistence are retained and never downgraded by late sent receipts',async()=>{
  await ingest();await step();const job=await repo.claim();assert.ok(job);const providerId='wamid.receipt.synthetic';
  globalThis.fetch=async()=>{await repo.recordInbound(connection,[],[{id:providerId,status:'read'}]);return Response.json({messages:[{id:providerId}]});};
  await engine.processJob(job);await repo.recordInbound(connection,[],[{id:providerId,status:'sent'}]);
  assert.equal((await pool.query('SELECT delivery_status FROM whatsapp_messages WHERE id=$1',[job.message_id])).rows[0].delivery_status,'read');
});
test('a database failure after Meta accepts a reply becomes uncertain delivery and is never retried automatically',async()=>{
  await ingest();await step();const job=await repo.claim();assert.ok(job);
  await pool.query(`CREATE FUNCTION reject_send_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.kind='outbound' AND NEW.status='completed' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_send_completion BEFORE UPDATE ON whatsapp_jobs FOR EACH ROW EXECUTE FUNCTION reject_send_completion()`);
  try {await assert.rejects(()=>engine.processJob(job),/DELIVERY_UNCONFIRMED/);}
  finally {await pool.query('DROP TRIGGER reject_send_completion ON whatsapp_jobs; DROP FUNCTION reject_send_completion()');}
  await repo.fail(job,'DELIVERY_UNCONFIRMED',false);assert.equal(sends,1);assert.equal(await repo.claim(),null);
  assert.equal((await pool.query('SELECT status FROM whatsapp_jobs WHERE id=$1',[job.id])).rows[0].status,'failed');
});
test('free-form replies outside the 24-hour window are blocked',async()=>{
  await ingest(message('Tomato 500g','text',25*60*60*1000));await step();const reply=await repo.claim();assert.ok(reply);
  await assert.rejects(()=>engine.processJob(reply),/CUSTOMER_SERVICE_WINDOW_CLOSED/);assert.equal(sends,0);
});
test('changing the connected Meta number expires old quotes and never sends queued replies from the new account',async()=>{
  await draft();await ingest(message('YES'));const job=await repo.claim();assert.ok(job);
  await repo.updateConnection(connection.businessId,{phoneNumberId:'99999'});
  await assert.rejects(()=>engine.processJob(job),/WHATSAPP_CONNECTION_CHANGED/);
  assert.equal((await orders()).length,0);
  assert.equal((await pool.query("SELECT id FROM pending_order_confirmations WHERE status='pending_confirmation'")).rowCount,0);
});
test('cleared tenant AI keys override environment fallback and ciphertext cannot cross businesses',async()=>{
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='synthetic-global';
  try {await pool.query('UPDATE business_connections SET api_key_encrypted=NULL WHERE business_id=$1',[connection.businessId]);
    await assert.rejects(()=>aiFor(connection.businessId),/Save a provider API key/);
    const other=(await pool.query("INSERT INTO businesses(name,slug) VALUES('Other','other') RETURNING id")).rows[0].id;
    await pool.query(`INSERT INTO business_connections(business_id,slot,provider,model,api_key_encrypted)
      VALUES($1,'primary','gemini','synthetic-model',$2)`,[other,encrypt('synthetic-key',connection.businessId,'primary')]);
    await assert.rejects(()=>aiFor(other),/cannot be read/);
  }finally{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;}
});
test('localhost submission uses the same quote/confirmation ledger flow while replies remain local',async()=>{
  const {LocalDemoService,LocalWhatsAppTransport}=await import('../services/local-demo.service.js');
  await pool.query("UPDATE whatsapp_connections SET phone_number_id='local-demo',waba_id='local-demo',access_token_encrypted=NULL,app_secret_encrypted=NULL,verify_token_encrypted=NULL WHERE business_id=$1",[connection.businessId]);
  const local=new LocalDemoService({business:{id:connection.businessId}} as any,new LocalWhatsAppTransport());
  await local.enqueue(customerId,'Tomato 500 g');
  const inbound=await repo.claim();assert.ok(inbound);await engine.processJob(inbound,local.transport);
  const summary=await repo.claim();assert.ok(summary);await engine.processJob(summary,local.transport);
  assert.match((await pool.query('SELECT provider_message_id FROM whatsapp_messages WHERE id=$1',[summary.message_id])).rows[0].provider_message_id,/^local-reply-/);
  assert.equal(sends,0);assert.equal((await orders()).length,0);
  await local.enqueue(customerId,'YES');const confirmation=await repo.claim();assert.ok(confirmation);await engine.processJob(confirmation,local.transport);
  assert.equal((await orders()).length,1);assert.equal(Number((await pool.query('SELECT quantity FROM order_items')).rows[0].quantity),0.5);
});
