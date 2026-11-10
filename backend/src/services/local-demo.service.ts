import { randomBytes,randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/env.js';
import { query } from '../database/connection.js';
import { AuthService } from './auth.service.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { CustomerRepository } from '../repositories/customer.repo.js';
import { ProductRepository } from '../repositories/product.repo.js';
import { WhatsAppRepository } from '../repositories/whatsapp.repo.js';
import type { WhatsAppTransport } from './whatsapp/whatsapp.provider.js';

/** Injected only by the disposable local entry point. It never contacts Meta. */
export class LocalWhatsAppTransport implements WhatsAppTransport {
  private photos=new Map<string,{data:Buffer;mimeType:string;createdAt:number}>();
  addPhoto(base64: string,mimeType: string) {
    if (!['image/jpeg','image/png'].includes(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new AppError('Choose a JPEG or PNG photo.',400);
    const data=Buffer.from(base64,'base64');
    if (data.length>5*1024*1024) throw new AppError('Photo must be below 5 MB.',400);
    const valid=mimeType==='image/png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data[0]===255 && data[1]===216 && data[2]===255;
    if(!valid)throw new AppError('The selected file does not match its image format.',400);
    // Bound temporary photo memory; retries can reuse the same photo for 30 minutes.
    while(this.photos.size>=3)this.photos.delete(this.photos.keys().next().value!);
    const id=randomUUID();this.photos.set(id,{data,mimeType,createdAt:Date.now()});return id;
  }
  async downloadMedia(id: string) {
    const photo=this.photos.get(id);
    if(!photo || Date.now()-photo.createdAt>30*60*1000)throw new AppError('The local photo expired. Upload it again.',400);
    return {data:photo.data,mimeType:photo.mimeType};
  }
  async sendTextMessage(_phone: string,_text: string) {return {success:true,messageId:'local-reply-'+randomUUID()};}
}

export class LocalDemoService {
  constructor(readonly session: Awaited<ReturnType<typeof AuthService.registerOwnerAndBusiness>>,readonly transport: LocalWhatsAppTransport) {}
  status() {return {available:true,businessId:this.session.business.id,businessName:this.session.business.name,replies:'local' as const};}
  async enqueue(customerId: string,text: string,image?: {data:string;mimeType:string}) {
    const customer=await CustomerRepository.findById({businessId:this.session.business.id,customerId});
    if(!customer?.active)throw new AppError('Choose an active customer in this local business.',400);
    const phone=customer.phone.replace(/\D/g,'');
    const senderPhone=phone.length===10?'91'+phone:phone;
    if(!/^[1-9]\d{7,14}$/.test(senderPhone))throw new AppError('The customer needs a valid phone number.',400);
    const connection=await WhatsAppRepository.runtimeConnection(this.session.business.id);
    if(connection.phoneNumberId!=='local-demo' || !connection.enabled)throw new AppError('This business is no longer using the local test connection.',409);
    const mediaId=image?this.transport.addPhoto(image.data,image.mimeType):undefined;
    await WhatsAppRepository.recordInbound(connection,[{providerMessageId:'local-message-'+randomUUID(),senderPhone,
      messageType:image?'image':'text',messageText:text,mediaId,mediaMimeType:image?.mimeType,providerTimestamp:new Date().toISOString()}],[]);
    return {queued:true,replies:'local' as const};
  }
}

export async function createLocalDemo() {
  if(config.env==='production')throw new Error('A local demo cannot run in production.');
  const session=await AuthService.registerOwnerAndBusiness({businessName:'OrderLedger Local Test',businessSlug:'local-test',categoryTemplate:'custom',ownerName:'Local Tester',email:'local@orderledger.test',password:randomBytes(24).toString('base64url')});
  await ProductRepository.bulkCreate(session.business.id,[{name:'Tomato',unit:'kg',current_price:40},{name:'Onion',unit:'kg',current_price:30},{name:'Rice',unit:'kg',current_price:60},{name:'Milk',unit:'litre',current_price:55},{name:'Eggs',unit:'dozen',current_price:72}]);
  await CustomerRepository.create({businessId:session.business.id,name:'Demo Restaurant',phone:'919000000001'});
  for(const slot of ['primary','fallback'] as const) {
    const prefix=slot==='primary'?'AI_PRIMARY':'AI_FALLBACK';
    let provider=process.env[prefix+'_PROVIDER'] || (slot==='primary'?(process.env.GEMINI_API_KEY || process.env.AI_PRIMARY_API_KEY ? 'gemini':'groq'):'groq');
    if(provider!=='gemini' && provider!=='groq')throw new AppError('Use Gemini or Groq for the local AI provider.',400);
    let apiKey=process.env[prefix+'_API_KEY'] || process.env[provider==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY'];
    let promoted=false;
    if(slot==='primary' && !apiKey){provider=provider==='gemini'?'groq':'gemini';apiKey=process.env[provider==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY'];promoted=true;}
    if(!apiKey)continue;
    const model=(!promoted && (process.env[prefix+'_VISION_MODEL'] || process.env[prefix+'_MODEL'])) || (provider==='gemini'?'gemini-2.5-flash':'llama-3.3-70b-versatile');
    await BusinessRepository.updateConnections(session.business.id,{[slot]:{provider,model,apiKey,endpoint:provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.groq.com/openai/v1'}});
  }
  // Only this newly created temporary business gets the sentinel connection. No Meta secrets are fabricated.
  await query("INSERT INTO whatsapp_connections(business_id,enabled,phone_number_id,waba_id,graph_version) VALUES($1,true,'local-demo','local-demo','')",[session.business.id]);
  return new LocalDemoService(session,new LocalWhatsAppTransport());
}
