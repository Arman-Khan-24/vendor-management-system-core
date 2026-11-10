import { useEffect,useState } from 'react';
import { MessageSquare,Plus,RefreshCw,Trash2 } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { Badge,Button,EmptyState,ErrorNotice,Input,LoadingState,Modal,PageHeader,Pagination,Select,usePagination } from '../../components/ui';
import type { Customer,Product,User,WhatsAppMessage } from '../../types';
import { LocalOrderTester } from './LocalOrderTester';
import { errorMessage,formatDateTime } from '../../utils/formatters';

export function WhatsAppInbox({ products,customers,user,onSetup }: { products: Product[]; customers:Customer[]; user: User; onSetup: () => void }) {
  const [messages,setMessages] = useState<WhatsAppMessage[]>([]);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [filter,setFilter] = useState('all');
  const [review,setReview] = useState<WhatsAppMessage | null>(null);
  const [retry,setRetry] = useState<WhatsAppMessage | null>(null);
  const load = async () => {
    try { setMessages(await ApiClient.getWhatsAppMessages());setError(null);setLoaded(true); }
    catch(e) { setError(errorMessage(e));setLoaded(true); }
  };
  useEffect(() => { let active=true; const poll=async()=>{
    try { const value=await ApiClient.getWhatsAppMessages(); if(active){setMessages(value);setError(null);setLoaded(true);} }
    catch(e){if(active){setError(errorMessage(e));setLoaded(true);}}
  }; void poll(); const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void poll();},10000);
    return()=>{active=false;window.clearInterval(timer);}; },[]);
  const needsReview = (message: WhatsAppMessage) => message.needs_review || message.job_status==='failed' || message.delivery_status==='failed' || !!message.structured_output?.warnings.length;
  const visible = messages.filter(message=>filter==='all'||filter==='review'&&needsReview(message)||filter==='pending'&&message.confirmation_status==='pending_confirmation');
  const pages=usePagination(visible,filter);
  const [busy,setBusy]=useState(false);
  const [actionError,setActionError]=useState<string|null>(null);
  const retryJob=async()=>{
    if(!retry?.job_id)return;setBusy(true);setActionError(null);
    try{await ApiClient.retryWhatsAppJob(retry.job_id);setRetry(null);await load();}catch(e){setActionError(errorMessage(e));}finally{setBusy(false);}
  };
  return <div className="page-stack">
    <PageHeader eyebrow="Orders from conversations" title="WhatsApp inbox" description="The latest 100 incoming messages and replies. Updates every 10 seconds while this page is open." actions={<><Button variant="outline" onClick={()=>void load()}><RefreshCw size={17} aria-hidden="true"/>Refresh</Button>{user.role==='OWNER'&&<Button onClick={onSetup}>Set up WhatsApp</Button>}</>}/>
    <ErrorNotice message={error} retry={()=>void load()}/>
    {user.role==='OWNER'&&<LocalOrderTester customers={customers} onQueued={()=>void load()}/>}
    <div className="chips">{[['all','All messages'],['review','Needs review'],['pending','Awaiting confirmation']].map(([key,label])=><button type="button" className={'chip '+(filter===key?'selected':'')} aria-pressed={filter===key} key={key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    {!loaded?<LoadingState label="Loading WhatsApp messages…"/>:!visible.length?<EmptyState icon={<MessageSquare size={28}/>} title={filter==='all'?'Your WhatsApp inbox is ready':'No messages in this view'} description="Incoming customer messages, order drafts, and replies appear here. Orders are created after confirmation." action={user.role==='OWNER'?<Button onClick={onSetup}>Open connection settings</Button>:undefined}/>:<div className="stack">{pages.items.map(message=><article className="card stack" key={message.id}>
      <div className="row between wrap"><strong>{message.customer_name||'+'+message.sender_phone}</strong><Badge variant={message.job_status==='failed'?'warning':message.direction==='inbound'?'info':'default'}>{message.direction==='inbound'?'Customer':'Reply'} · {message.job_status==='failed'?'Needs attention':message.delivery_status||message.status}</Badge></div>
      <p className="small muted">{formatDateTime(message.created_at)} · {message.message_type==='image'?'Order photo':message.message_type==='text'?'Text':'Attachment'}</p>
      <p className="whatsapp-message-text">{message.message_text||(message.message_type==='image'?'Photo received':'Attachment received')}</p>
      {message.structured_output&&<div className="form-note"><strong>Extracted items</strong>{message.structured_output.items.map((item,index)=><p key={index}>{item.product} — {item.quantity} {item.unit}</p>)}{message.structured_output.warnings.map((warning,index)=><p key={'w'+index}>Check: {warning}</p>)}</div>}
      {message.confirmation_status&&<p className="small">Order draft: {message.confirmation_status.replace(/_/g,' ')}{message.confirmation_status==='pending_confirmation'?' · expires '+formatDateTime(message.expires_at):''}</p>}
      {(message.job_error||message.error_code)&&<p className="form-note">{(message.job_error||message.error_code)?.replace(/_/g,' ')}</p>}
      {user.role==='OWNER'&&<div className="row wrap">
        {message.direction==='inbound'&&message.customer_id&&message.confirmation_status!=='confirmed'&&(!!message.structured_output||needsReview(message))&&!['queued','processing'].includes(message.job_status||'')&&<Button variant="secondary" onClick={()=>{setReview(message);setActionError(null);}}>Review order items</Button>}
        {message.job_status==='failed'&&<Button variant="outline" onClick={()=>{setRetry(message);setActionError(null);}}>Review retry</Button>}
      </div>}
    </article>)}</div>}
    <Pagination {...pages}/>
    {review&&<ReviewItems message={review} products={products} onClose={()=>setReview(null)} onSaved={()=>{setReview(null);void load();}}/>}
    <Modal isOpen={!!retry} title="Retry this message?" onClose={()=>setRetry(null)} busy={busy}><div className="stack"><p>{retry?.direction==='outbound'?'A reply with an unconfirmed response may already have reached the customer. Retrying could send it again. Check the conversation first.':'Retry extraction after fixing its provider or connection issue. The original message will be reused.'}</p><ErrorNotice message={actionError} focus/><div className="form-actions"><Button variant="ghost" disabled={busy} onClick={()=>setRetry(null)}>Cancel</Button><Button busy={busy} onClick={()=>void retryJob()}>Retry message</Button></div></div></Modal>
  </div>;
}

function ReviewItems({message,products,onClose,onSaved}:{message:WhatsAppMessage;products:Product[];onClose:()=>void;onSaved:()=>void}){
  const available=products.filter(product=>product.active);
  const [items,setItems]=useState<{key:string;productId:string;quantity:string}[]>(()=>{
    if(message.extracted_items?.length) return message.extracted_items.map(item=>({key:crypto.randomUUID(),productId:item.productId,quantity:String(item.quantity)}));
    if(message.structured_output?.items.length) return message.structured_output.items.map(item=>{
      const product=available.find(product=>product.name.toLowerCase()===item.product.toLowerCase()&&product.unit===item.unit);
      return {key:crypto.randomUUID(),productId:product?.id||'',quantity:product?String(item.quantity):''};
    });
    return [{key:crypto.randomUUID(),productId:'',quantity:'1'}];
  });
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError(null);
    try{if(items.some(item=>!item.productId||!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0))throw new Error('Choose a product and positive quantity for every row.');
      await ApiClient.reviewWhatsAppMessage(message.id,items.map(({productId,quantity})=>({productId,quantity:Number(quantity)})));onSaved();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  return <Modal isOpen title="Review the complete order" onClose={onClose} wide busy={busy}><form className="stack" onSubmit={save}>
    <p>Enter the complete intended order in each product’s catalog unit. The customer receives a fresh summary and must reply YES before an order is created.</p>
    <ErrorNotice message={error} focus/>
    {items.map((item,index)=><div className="form-grid" key={item.key}>
      <Select label={'Product '+(index+1)} required value={item.productId} onChange={e=>setItems(values=>values.map(value=>value.key===item.key?{...value,productId:e.target.value}:value))}><option value="">Choose a product</option>{available.map(product=><option value={product.id} key={product.id}>{product.name} ({product.unit})</option>)}</Select>
      <Input label={'Quantity '+(index+1)} required type="number" inputMode="decimal" min="0.01" step="0.01" value={item.quantity} hint={'Quantity in '+(available.find(product=>product.id===item.productId)?.unit||'the product’s unit')} onChange={e=>setItems(values=>values.map(value=>value.key===item.key?{...value,quantity:e.target.value}:value))}/>
      <Button variant="ghost" disabled={items.length===1} onClick={()=>setItems(values=>values.filter(value=>value.key!==item.key))}><Trash2 size={16} aria-hidden="true"/>Remove item {index+1}</Button>
    </div>)}
    <Button variant="outline" disabled={items.length>=100} onClick={()=>setItems(values=>[...values,{key:crypto.randomUUID(),productId:'',quantity:'1'}])}><Plus size={17} aria-hidden="true"/>Add item</Button>
    <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>Send reviewed summary</Button></div>
  </form></Modal>;
}
