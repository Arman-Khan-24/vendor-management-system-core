import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,createHmac } from 'node:crypto';
import { CatalogMatcher } from '../services/ai/catalog.matcher.js';
import { convertQuantity } from '../services/ai/units.js';
import { AiOrderExtractionService,GeminiExtractionProvider,GroqExtractionProvider,extractionSchema } from '../services/ai/ai.service.js';
import { MetaWhatsAppProvider,type WhatsAppRuntimeConnection } from '../services/whatsapp/whatsapp.provider.js';
import { decryptSecret,encryptSecret } from '../services/business-settings.service.js';
import { WhatsAppRepository,type WhatsAppJob } from '../repositories/whatsapp.repo.js';
import { OrderProcessingEngine } from '../services/order.processor.js';
import { processNextWhatsAppJob } from '../services/whatsapp/whatsapp.worker.js';
import { ProviderError } from '../services/provider-http.js';

const connection: WhatsAppRuntimeConnection={ businessId:'tenant-a',enabled:true,phoneNumberId:'11111',wabaId:'22222',graphVersion:'v23.0',defaultCountryCode:'91',accessToken:'synthetic-access-token',appSecret:'synthetic-app-secret',verifyToken:'synthetic-verify-token' };
const catalog=[{id:'tomato',name:'Tomato',unit:'kg',current_price:40}];
async function mockFetch(callback: typeof fetch,run:()=>Promise<void>){const original=globalThis.fetch;globalThis.fetch=callback;try{await run();}finally{globalThis.fetch=original;}}

test('gram orders convert to kilograms before catalog pricing; repeated lines combine',()=>{
  const result=CatalogMatcher.match([{product:'Tomato',quantity:500,unit:'g'},{product:'Tomato',quantity:0.5,unit:'kg'}],catalog);
  assert.equal(result.isValid,true);assert.deepEqual(result.matchedItems.map(item=>[item.quantity,item.unit,item.totalPrice]),[[1,'kg',40]]);
});
test('dozens, volume, incompatible packages and precision boundaries are handled explicitly',()=>{
  assert.equal(convertQuantity(12,'pieces','dozen'),1);assert.equal(convertQuantity(500,'ml','litre'),0.5);
  assert.equal(convertQuantity(1,'piece','dozen'),null);assert.equal(convertQuantity(1,'bag','kg'),null);
  assert.equal(convertQuantity(1,'litre','kg'),null);assert.equal(convertQuantity(Infinity,'kg','kg'),null);
  assert.equal(convertQuantity(1,'g','kg'),null);assert.equal(convertQuantity(0,'kg','kg'),null);
});
test('generic varieties stay ambiguous and unit mismatch never silently changes an order',()=>{
  const varieties=[{...catalog[0],name:'Tomato (Hybrid)'},{...catalog[0],id:'country',name:'Tomato (Country)'}];
  assert.equal(CatalogMatcher.match([{product:'Tomato',quantity:5,unit:'kg'}],varieties).ambiguousItems.length,1);
  assert.equal(CatalogMatcher.match([{product:'Tomato',quantity:2,unit:'crate'}],catalog).isValid,false);
  assert.equal(CatalogMatcher.match([{product:'Tomato',quantity:2,unit:''}],catalog).isValid,false);
  assert.equal(CatalogMatcher.match([{product:'Tomato',quantity:2,unit:'kg'}],[varieties[0],{...varieties[1],unit:'box'}]).isValid,false);
});
test('uncertain Meta sends never become automatic retries; an explicit rate-limit response can retry',async()=>{
  for(const status of [500,503]) await mockFetch(async()=>Response.json({}, {status}),async()=>{
    await assert.rejects(()=>new MetaWhatsAppProvider(connection).sendTextMessage('919000000001','Test'),error=>
      error instanceof Error && error.message==='DELIVERY_UNCONFIRMED' && (error as any).retryable===false);
  });
  await mockFetch(async()=>Response.json({}, {status:429}),async()=>{
    await assert.rejects(()=>new MetaWhatsAppProvider(connection).sendTextMessage('919000000001','Test'),error=>(error as any).retryable===true);
  });
  await mockFetch(async()=>Response.json({}),async()=>{
    await assert.rejects(()=>new MetaWhatsAppProvider(connection).sendTextMessage('919000000001','Test'),/DELIVERY_UNCONFIRMED/);
  });
});
test('AI response validation rejects strings, non-finite quantities and oversized lists',()=>{
  assert.equal(extractionSchema.safeParse({items:[{product:'Tomato',quantity:'2',unit:'kg'}]}).success,false);
  assert.equal(extractionSchema.safeParse({items:[{product:'Tomato',quantity:Infinity,unit:'kg'}]}).success,false);
  assert.equal(extractionSchema.safeParse({items:Array(101).fill({product:'Tomato',quantity:2,unit:'kg'})}).success,false);
});
test('saved credentials decrypt only for the owning business and purpose',()=>{
  const value=encryptSecret('synthetic-token','tenant-a','whatsapp:accessToken');
  assert.equal(decryptSecret(value,'tenant-a','whatsapp:accessToken'),'synthetic-token');
  assert.throws(()=>decryptSecret(value,'tenant-b','whatsapp:accessToken'));
  assert.throws(()=>decryptSecret(value,'tenant-a','whatsapp:appSecret'));
});
test('Meta validates HMAC over exact raw bytes and rejects arbitrary headers',()=>{
  const provider=new MetaWhatsAppProvider(connection),raw=Buffer.from('{"hello":"world"}');
  const signature='sha256='+createHmac('sha256',connection.appSecret).update(raw).digest('hex');
  assert.equal(provider.verifyWebhook(raw,signature),true);
  assert.equal(provider.verifyWebhook(Buffer.from('{ "hello":"world"}'),signature),false);
  assert.equal(provider.verifyWebhook(raw,'present-but-invalid'),false);
  assert.equal(provider.verifyWebhook(raw,undefined),false);
});
test('Meta parses every message in a batch and excludes another business account or number',()=>{
  const provider=new MetaWhatsAppProvider(connection),timestamp=String(Math.floor(Date.now()/1000));
  const body={object:'whatsapp_business_account',entry:[{id:'22222',changes:[{field:'messages',value:{metadata:{phone_number_id:'11111'},messages:[
    {id:'a',from:'919000000001',type:'text',timestamp,text:{body:'Tomato 2 kg'}},
    {id:'b',from:'919000000001',type:'image',timestamp,image:{id:'33333',mime_type:'image/jpeg'}}
  ]}},{field:'messages',value:{metadata:{phone_number_id:'99999'},messages:[{id:'other',from:'919000000001',type:'text',timestamp,text:{body:'Ignore'}}]}}]}]};
  assert.deepEqual(provider.parseInbound(body).messages.map(message=>message.providerMessageId),['a','b']);
  body.entry[0].id='99999';assert.equal(provider.parseInbound(body).messages.length,0);
});
test('international phone identities retain the country code',()=>{
  for(const phone of ['919000000001','12025550123']) {
    const body={object:'whatsapp_business_account',entry:[{id:'22222',changes:[{field:'messages',value:{metadata:{phone_number_id:'11111'},messages:[
      {id:'synthetic',from:phone,type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body:'Test'}}]}}]}]};
    assert.equal(new MetaWhatsAppProvider(connection).parseInbound(body).messages[0].senderPhone,phone);
  }
});
test('Meta sending uses a real authenticated messages request and requires its returned message ID',async()=>{
  await mockFetch(async(url,init)=>{
    assert.equal(String(url),'https://graph.facebook.com/v23.0/11111/messages');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-access-token');
    const body=JSON.parse(String(init?.body));assert.equal(body.to,'919000000001');assert.equal(body.text.body,'Order confirmed');
    return Response.json({messages:[{id:'wamid.synthetic'}]});
  },async()=>{assert.equal((await new MetaWhatsAppProvider(connection).sendTextMessage('919000000001','Order confirmed')).messageId,'wamid.synthetic');});
});
test('Meta media requests reject unexpected hosts before transmitting the bearer token',async()=>{
  let calls=0;
  await mockFetch(async()=>{calls++;return Response.json({url:'https://example.org/image',mime_type:'image/png',file_size:8});},async()=>{
    await assert.rejects(()=>new MetaWhatsAppProvider(connection).downloadMedia('33333'),/INVALID_MEDIA_URL/);assert.equal(calls,1);
  });
});
test('Meta images are authenticated, size bounded, signature checked and checksum verified',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);let calls=0;
  await mockFetch(async(url,init)=>{
    calls++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-access-token');
    return String(url).includes('graph.facebook.com')?Response.json({url:'https://lookaside.fbsbx.com/image',mime_type:'image/png',file_size:8,sha256:createHash('sha256').update(png).digest('hex')}):new Response(png);
  },async()=>{assert.deepEqual((await new MetaWhatsAppProvider(connection).downloadMedia('33333')).data,png);assert.equal(calls,2);});
});
test('malformed Gemini output triggers Groq fallback and preserves its selected model',async()=>{
  const used:string[]=[];
  await mockFetch(async(url,init)=>{
    used.push(String(url));const body=JSON.parse(String(init?.body));
    if(String(url).includes('googleapis')){assert.equal(body.generationConfig.responseJsonSchema.required.length,2);assert.equal(new Headers(init?.headers).get('x-goog-api-key'),'synthetic-gemini-key');return Response.json({candidates:[{content:{parts:[{text:'{"items":[{"product":"Tomato","quantity":"oops","unit":"kg"}]}'}]}}]});}
    assert.equal(body.model,'chosen-groq-model');return Response.json({choices:[{message:{content:JSON.stringify({items:[{product:'Tomato',quantity:2,unit:'kg'}],warnings:[]})}}]});
  },async()=>{
    const service=new AiOrderExtractionService(new GeminiExtractionProvider('synthetic-gemini-key','chosen-gemini-model'),new GroqExtractionProvider('synthetic-groq-key','chosen-groq-model'));
    const result=await service.extract('Tomato 2 kg',catalog);assert.equal(result.wasFallback,true);assert.equal(result.model,'chosen-groq-model');assert.equal(used.length,2);
  });
});
test('image extraction carries actual bytes and correction context, without an implicit mock fallback',async()=>{
  await assert.rejects(()=>new GeminiExtractionProvider('').extractOrderText('Tomato 2 kg',catalog),/AI_NOT_CONFIGURED/);
  await mockFetch(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.contents[0].parts[2].inline_data.data,Buffer.from('synthetic-image').toString('base64'));
    assert.match(body.contents[0].parts[0].text,/COMPLETE updated order/);
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:[{product:'Tomato',quantity:3,unit:'kg'}],warnings:[]})}]}}]});
  },async()=>{const result=await new GeminiExtractionProvider('synthetic-key').extractOrderImage(Buffer.from('synthetic-image'),'image/png',catalog,'change to 3kg',[{product:'Tomato',quantity:2,unit:'kg'}]);assert.equal(result.items[0].quantity,3);});
});
test('worker retries uncertain inference requests but requires review for uncertain outbound delivery',async()=>{
  const claim=WhatsAppRepository.claim,fail=WhatsAppRepository.fail,process=OrderProcessingEngine.processJob;
  try {
    for(const [kind,error,retry] of [
      ['inbound',new ProviderError('PROVIDER_RESPONSE_UNCONFIRMED',false),true],
      ['outbound',new ProviderError('DELIVERY_UNCONFIRMED',false),false],
      ['inbound',new ProviderError('INVALID_AI_OUTPUT',false),false]
    ] as const) {
      const job={id:'synthetic',kind,attempts:1} as WhatsAppJob;
      WhatsAppRepository.claim=async()=>job;
      OrderProcessingEngine.processJob=async()=>{throw error;};
      let recorded=false;
      WhatsAppRepository.fail=async(received,code,retryable)=>{assert.equal(received,job);assert.equal(code,error.code);assert.equal(retryable,retry);recorded=true;};
      assert.equal(await processNextWhatsAppJob(),true);assert.equal(recorded,true);
    }
  }finally{WhatsAppRepository.claim=claim;WhatsAppRepository.fail=fail;OrderProcessingEngine.processJob=process;}
});
