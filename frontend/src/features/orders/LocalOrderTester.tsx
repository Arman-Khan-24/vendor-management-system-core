import { useEffect,useState } from 'react';
import { ApiClient } from '../../api/client';
import { Badge,Button,ErrorNotice,Input,Select,Textarea } from '../../components/ui';
import type { Customer } from '../../types';
import { errorMessage } from '../../utils/formatters';

export function LocalOrderTester({customers,onQueued}:{customers:Customer[];onQueued:()=>void}){
  const [available,setAvailable]=useState(false);
  const [customer,setCustomer]=useState('');
  const [text,setText]=useState('Tomato 500 g');
  const [image,setImage]=useState<{data:string;mimeType:string;name:string}|null>(null);
  const [busy,setBusy]=useState(false),[reading,setReading]=useState(false);
  const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{if(!['localhost','127.0.0.1'].includes(window.location.hostname))return;let active=true;void ApiClient.getLocalDemoStatus().then(value=>{if(active)setAvailable(value.available&&value.replies==='local');}).catch(()=>{});return()=>{active=false;};},[]);
  const selected=customer||customers.find(value=>value.active)?.id||'';
  const photo=async(file?:File)=>{
    setImage(null);setError(null);if(!file)return;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024){setError('Choose a JPEG or PNG photo below 5 MB.');return;}
    setReading(true);
    try{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The photo could not be read.'));reader.readAsDataURL(file);});setImage({data,mimeType:file.type,name:file.name});}
    catch(e){setError(errorMessage(e));}finally{setReading(false);}
  };
  const send=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError(null);setNotice(null);
    try{await ApiClient.sendLocalDemoMessage({customerId:selected,text,...(image?{image:{data:image.data,mimeType:image.mimeType}}:{})});setNotice('Message queued. The extracted order and captured reply will appear below. Wait for the summary before sending YES.');setImage(null);onQueued();}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  if(!available)return null;
  return <section className="card stack"><div className="row between wrap"><h2>Try an order locally</h2><Badge variant="info">Local test · replies captured</Badge></div>
    <p>Send a customer message or photo to this temporary business. Gemini/Groq reads it using your saved key. Replies appear in this inbox; they are not sent to WhatsApp.</p>
    <form className="stack" onSubmit={send}>
      <Select label="Test customer" value={selected} required onChange={e=>setCustomer(e.target.value)}>{customers.filter(value=>value.active).map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</Select>
      <Textarea label="Customer message or photo caption" value={text} maxLength={10000} required={!image} onChange={e=>{setText(e.target.value);setNotice(null);}} rows={3}/>
      <div className="chips">{['Tomato 500 g','change Tomato to 1 kg','YES','NO'].map(sample=><button key={sample} type="button" className="chip" disabled={busy||reading} onClick={()=>{setText(sample);setImage(null);setNotice(null);}}>{sample}</button>)}</div>
      <Input key={image?.name||'no-photo'} label="Order photo (optional)" type="file" accept="image/jpeg,image/png" disabled={busy||reading} onChange={e=>void photo(e.target.files?.[0])}/>
      {image&&<p className="small">Photo ready: {image.name} <Button variant="ghost" size="sm" onClick={()=>setImage(null)}>Remove photo</Button></p>}
      <ErrorNotice message={error} focus/>{notice&&<p className="success-note" role="status">{notice}</p>}
      <Button type="submit" busy={busy} disabled={reading||!selected}>Send test message</Button>
    </form>
  </section>;
}
