// language: Node/JavaScript, file: demo_whatsapp/server.mjs, target: WhatsApp-style AI chat demo
// Visual demo: send text or photo like a customer on WhatsApp, AI replies in chat bubbles.
// Run:  node demo_whatsapp/server.mjs   -> http://localhost:7777
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const KEY = process.env.GEMINI_API_KEY;
if (!KEY || KEY.trim().length < 10) { console.error('GEMINI_API_KEY missing in backend/.env'); process.exit(1); }
const MODEL_DEFAULT = 'gemini-3.5-flash-lite';

const app = express();
app.use(express.json({ limit: '25mb' }));

const DEFAULT_CATALOG = `Tomato (Country/Naati) | Unit: kg | Rs.45
Tomato (Hybrid) | Unit: kg | Rs.40
Onion (Nashik) | Unit: kg | Rs.35
Potato (Jyoti) | Unit: kg | Rs.30
Lady Finger (Bhindi) | Unit: kg | Rs.50
Banana (Yellaki) | Unit: dozen | Rs.60`;

// ---------- extraction core (same production prompts, full-transcription mode) ----------
const TEXT_PROMPT = (catalog) => `You are the WhatsApp order desk of a wholesale vendor.
Vendor Catalog (reference only — customers may order items beyond it):
${catalog}

Incoming customer message:
"$MSG"

TASK:
Transcribe as an ORDER: every product mentioned, whether or not it is in the catalog.
Return JSON: {"items":[{"product":"exact name as written","quantity":number,"unit":"kg/dozen/crate/etc"}],"warnings":[]}
RULES:
1. Comma-less and "and"-joined lists are PRIMARY formats ("tomato 5kg pyaz 3kg" = 2 items).
2. NEVER merge or drop items. Include out-of-catalog items.
3. Understand Hinglish/Hindi Roman + Devanagari (tamatar, pyaz, aalu, bhindi, darjan).
4. No unit specified -> unit "".
5. No parseable order -> items: [].
6. JSON only, no fences.`;

const VISION_PROMPT = (catalog) => `You are the WhatsApp order desk of a wholesale vendor. A customer sent a photo of their order.
Vendor Catalog (reference only — items beyond it exist):
${catalog}

TASK: transcribe EVERY item visible (even ones not in the catalog), with quantity and unit.
Return JSON: {"items":[{"product":"exact written name (original language)","quantity":number,"unit":"kg/dozen/crate/piece"}],"warnings":[]}
RULES:
1. angled photos, uneven light, Devanagari handwriting, mixed script all fine.
2. crossed-out items -> take final correction only.
3. illegible -> warning.
4. blank/non-order photo -> items: [].
5. JSON only, no fences.`;

const BILL_QUESTIONS = /(bill|invoice|price|rate|kitn[ae]|payment|paisa|due|udhaar|udhar|credit|paise)/i;
const NOISE_BUBBLE = 'Namaste! Ye order desk hai. Order aise bhejein, jaise:\n"tamatar 5kg pyaz 3kg aalu 10kg"\nOrder list ki PHOTO bhi bhej sakte hain.';

// roman-hindi normalization for stock tagging + pricing
const SYNONYMS = [
  [/tamat[ae]r/g,'tomato'], [/pya?z/g,'onion'], [/aloo|aalu/g,'potato'], [/bhind[iy]/g,'ladyfinger'],
  [/kela/g,'banana'], [/baingan/g,'brinjal'], [/gobhi|gobi/g,'cauliflower'], [/matar/g,'peas'],
  [/dhania/g,'coriander'], [/kaddu/g,'pumpkin'], [/karela/g,'bittergourd'], [/mirch/g,'chilli']
];
function normalizeName(s) {
  let n = ' ' + String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\u0900-\u097F]+/g, ' ') + ' ';
  for (const [re, en] of SYNONYMS) n = n.replace(re, en);
  return n.trim().replace(/\s+/g, '');
}
function baseNames(catalog) {
  return (catalog || '').split('\n')
    .map(l => l.split('|')[0].replace(/\(.*?\)/g, '').trim().toLowerCase())
    .filter(w => w.length > 1).map(normalizeName);
}
function tagCatalog(items, catalog) {
  const bases = baseNames(catalog);
  const missing = [];
  for (const item of items || []) {
    const p = normalizeName(item.product);
    item.inCatalog = bases.some(b => p.includes(b) || b.includes(p));
    if (!item.inCatalog) missing.push(item.product);
  }
  return missing;
}
function priceLine(nm) {
  const m = String(nm || '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function priced(items, catalog) {
  const map = {};
  (catalog || '').split('\n').forEach(l => { map[normalizeName(l.split('|')[0])] = priceLine(l.split('|')[2]); });
  let total = 0, known = true;
  for (const i of items) {
    const p = map[normalizeName(i.product)];
    if (p == null) known = false; else total += p * (parseFloat(i.quantity) || 0);
  }
  return known ? 'Rs.' + (Math.round(total * 100) / 100).toLocaleString('en-IN') : null;
}

async function callGemini(model, prompt, imageB64, imageMime) {
  const parts = [{ text: prompt }];
  if (imageB64) parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageB64 } });
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } })
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()).slice(0, 280));
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from model');
  return JSON.parse(text);
}

function orderBubbleText(items, catalog) {
  const missing = tagCatalog(items, catalog);
  let t = '*Order received* (' + items.length + ' item' + (items.length === 1 ? '' : 's') + ')\n';
  items.forEach((i, n) => {
    const tag = i.inCatalog === false ? '  (-not in stock-)' : '';
    t += (n + 1) + '. ' + i.product + ' — ' + i.quantity + (i.unit ? ' ' + i.unit : '') + tag + '\n';
  });
  if (missing.length) t += '\nNot in catalog: ' + missing.join(', ') + '\n';
  t += '\nSahi hai toh reply karein: *YES*';
  return t;
}

app.get('/api/models', (_req, res) =>
  res.json({ models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'], default: MODEL_DEFAULT }));

app.post('/api/chat', async (req, res) => {
  const { mode, text, imageBase64, imageMime, catalog, model, intent, lastItems } = req.body || {};
  const cat = catalog || DEFAULT_CATALOG;
  const meta = { ai: false, ms: 0 };
  try {
    // YES confirmation path (no AI call, instant)
    if (intent === 'confirm' || /^(yes|ok|confirm|haan|ha|theek hai)\.?$/i.test(String(text || '').trim())) {
      const items = Array.isArray(lastItems) && lastItems.length ? lastItems : null;
      if (!items) return res.json({ bubbles: [{ from: 'bot', text: 'Koi pending order nahi mila. Pehle order bhejein.' }], meta });
      const ord = 'OL-' + Math.floor(1000 + Math.random() * 9000);
      const bill = priced(items, cat);
      let t = 'Order CONFIRMED - ' + ord + '\nPacking starts now.\n' + items.map(i => '- ' + i.product + ' x ' + i.quantity + (i.unit ? ' ' + i.unit : '')).join('\n');
      t += bill ? '\nEst. bill: ' + bill + ' (catalog prices; final bill on delivery)' : '\nBill milegi delivery par.';
      return res.json({ bubbles: [{ from: 'bot', text: t }], meta });
    }

    const t0 = Date.now();
    let parsed = null;
    // chat gate for typed text: no digits, no catalog word, no bill-speak -> zero AI call
    const isLikelyOrder = /\d/.test(String(text || '')) || BILL_QUESTIONS.test(String(text || ''))
      || baseNames(cat).some(b => normalizeName(text || '').includes(b));
    if (mode === 'text') {
      meta.ai = isLikelyOrder;
      if (!isLikelyOrder) return res.json({ bubbles: [{ from: 'bot', text: NOISE_BUBBLE }], meta: { ai: false } });
      parsed = await callGemini(model || MODEL_DEFAULT, TEXT_PROMPT(cat).replace('$MSG', String(text || '').slice(0, 4000)));
    } else if (mode === 'image' && imageBase64) {
      meta.ai = true;
      parsed = await callGemini(model || MODEL_DEFAULT, VISION_PROMPT(cat), imageBase64, imageMime);
    } else {
      return res.status(400).json({ error: 'Send text or an image.' });
    }
    meta.ms = Date.now() - t0;

    const bubbles = [];
    const items = parsed.items || [];
    if (items.length) {
      tagCatalog(items, cat);
      bubbles.push({ from: 'bot', text: orderBubbleText(items, cat) });
      (parsed.warnings || []).forEach(w => {
        if (!/not in/i.test(w)) bubbles.push({ from: 'bot', text: '(note) ' + w + '\nPlease clarify.', small: true });
      });
      return res.json({ bubbles, items, meta });
    }
    bubbles.push({ from: 'bot', text: NOISE_BUBBLE, small: true });
    (parsed.warnings || []).slice(0, 2).forEach(w => bubbles.push({ from: 'bot', text: '(note) ' + w, small: true }));
    return res.json({ bubbles, meta });
  } catch (e) {
    return res.status(500).json({ error: e.message, meta });
  }
});

app.get('/', (_req, res) => res.type('html').send(PAGE));

const PORT = process.env.DEMO_PORT || 7777;
app.listen(PORT, () => console.log('WHATSAPP DEMO -> http://localhost:' + PORT));

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrderLedger — WhatsApp order demo</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Segoe UI',system-ui,sans-serif; background:#0a1014; color:#e9edef; display:flex; justify-content:center; }
  .stage { width:100%; max-width:430px; height:100vh; display:flex; flex-direction:column; background:#0b141a; }
  @media (min-width:900px){ body{ align-items:center; } .stage{ height:92vh; border-radius:14px; overflow:hidden; box-shadow:0 8px 60px #000a; } }
  .hdr { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#202c33; }
  .hdr .av { width:38px; height:38px; border-radius:50%; background:#6a7175; display:flex; align-items:center; justify-content:center; font-size:19px; }
  .hdr .nm { font-size:15px; font-weight:600; }
  .hdr .st { font-size:12px; color:#aebac1; }
  .hdr .gear { margin-left:auto; background:none; border:0; color:#aebac1; font-size:19px; cursor:pointer; }
  .settings { display:none; background:#111b21; padding:12px 14px; border-bottom:1px solid #202c33; }
  .settings.open { display:block; }
  .settings textarea { width:100%; background:#0b141a; color:#e9edef; border:1px solid #2a3942; border-radius:9px; padding:9px; font-size:12.5px; min-height:96px; font-family:inherit; }
  .settings .lab { font-size:12px; color:#8696a0; margin:8px 0 4px; }
  .chat { flex:1; overflow-y:auto; padding:16px 12px 8px; background:#0b141a; }
  .datechip { width:max-content; margin:6px auto 14px; background:#182229; color:#8696a0; font-size:12px; padding:5px 12px; border-radius:8px; }
  .b { max-width:82%; margin:3px 0; padding:7px 10px 4px; border-radius:9px; font-size:14.5px; line-height:1.35; white-space:pre-wrap; word-break:break-word; }
  .b.me { background:#005c4b; margin-left:auto; border-top-right-radius:3px; }
  .b.them { background:#202c33; margin-right:auto; border-top-left-radius:3px; }
  .b .t { display:block; text-align:right; font-size:11px; color:#8696a0; margin-top:3px; }
  .b.me .t { color:#9ad6c7; }
  .b img.thumb { max-width:200px; max-height:260px; border-radius:7px; display:block; margin-bottom:4px; background:#111; }
  .b .tick { font-size:11px; color:#53bdeb; }
  .b.small { font-size:13px; color:#d1d7db; }
  .typing { display:inline-flex; gap:4px; padding:11px 14px; }
  .typing i { width:7px; height:7px; background:#8696a0; border-radius:50%; opacity:.4; animation:bl 1.2s infinite; }
  .typing i:nth-child(2){ animation-delay:.2s } .typing i:nth-child(3){ animation-delay:.4s }
  @keyframes bl { 0%,100%{opacity:.25} 50%{opacity:.95} }
  .inbar { display:flex; align-items:flex-end; gap:8px; padding:8px 10px; background:#202c33; }
  .inbar .clip { font-size:20px; background:none; border:0; color:#aebac1; cursor:pointer; padding:8px; }
  .inbar input[type=text] { flex:1; background:#2a3942; color:#e9edef; border:0; border-radius:20px; padding:11px 16px; font-size:15px; outline:none; }
  .inbar .send { width:40px; height:40px; border-radius:50%; border:0; background:#00a884; color:#fff; font-size:17px; cursor:pointer; }
  .fileinput { display:none; }
  .err { background:#3a151a; color:#ffb4b4; font-size:12.5px; padding:9px 12px; border-radius:8px; margin:6px auto; max-width:82%; }
  .meta { text-align:center; font-size:11px; color:#5a6a73; margin:10px 0 2px; }
</style>
</head>
<body>
<div class="stage">
  <div class="hdr">
    <div class="av">🧺</div>
    <div><div class="nm">Sharma Wholesale 🥬</div><div class="st" id="st">online • order desk</div></div>
    <button class="gear" id="gear" title="catalog + model">⚙</button>
  </div>
  <div class="settings" id="pow">
    <div class="lab">Shop catalog (one per line: "Name | Unit: kg | Rs.40")</div>
    <textarea id="catalog">${DEFAULT_CATALOG}</textarea>
    <div class="lab">Model</div>
    <select id="model" style="width:100%;background:#0b141a;color:#e9edef;border:1px solid #2a3942;border-radius:9px;padding:9px;font-size:13px"></select>
  </div>
  <div class="chat" id="chat">
    <div class="datechip">Today</div>
    <div class="b them">Namaste. Yahan aap order message kar sakte hain — text ya photo 👍<span class="t">—</span></div>
  </div>
  <div class="inbar">
    <button class="clip" id="clip">📎</button>
    <input type="file" class="fileinput" id="file" accept="image/*" capture="environment">
    <input type="text" id="txt" placeholder="Message" autocomplete="off">
    <button class="send" id="send">➤</button>
  </div>
</div>
<script>
const $ = id => document.getElementById(id);
const chat=$('chat'), txt=$('txt');
let pending=null;

fetch('/api/models').then(r=>r.json()).then(d=>{
  $('model').innerHTML = d.models.map(m=>'<option'+((m===d.default)?' selected':'')+'>'+m+'</option>').join('');
});

function now(){ const d=new Date(); return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); }
function tx(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\\n/g,'<br>').replace(/\\*([^\\n*]+)\\*/g,'<b>$1</b>'); }
function addB(o){
  const div=document.createElement('div');
  div.className='b '+(o.from==='me'?'me':'them'+(o.small?' small':''));
  let html='';
  if(o.img) html+='<img class="thumb" src="'+o.img+'">';
  html+=tx(o.text||'');
  html+='<span class="t">'+now()+(o.from==='me'?' <span class="tick">✓✓</span>':'')+'</span>';
  div.innerHTML=html;
  chat.appendChild(div);
  chat.scrollTop=chat.scrollHeight;
}
function typing(on){
  $('st').textContent = on ? 'typing…' : 'online • order desk';
  let e=$('typingB');
  if(on){ if(!e){ e=document.createElement('div'); e.className='b them typing'; e.id='typingB'; e.innerHTML='<i></i><i></i><i></i>'; chat.appendChild(e); } }
  else if(e) e.remove();
  chat.scrollTop=chat.scrollHeight;
}
function metaChip(m){
  const d=document.createElement('div'); d.className='meta';
  d.textContent=(m.ai?('AI: '+m.ms+'ms'):'chat — AI skipped, Rs.0 spent')+((m.items!=null)?(' · '+m.items+' items'):'');
  chat.appendChild(d); chat.scrollTop=chat.scrollHeight;
}

function ship(mode, extra){
  addB({ from:'me', text:(mode==='text'?extra.text:'photo of my order 📷'), img:extra._img });
  typing(true);
  const body=Object.assign({ mode, catalog:$('catalog').value, model:$('model').value }, extra);
  delete body._img;
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(r=>r.json()).then(d=>{
    typing(false);
    if(d.error){ const e=document.createElement('div'); e.className='err'; e.textContent='x '+d.error; chat.appendChild(e); chat.scrollTop=chat.scrollHeight; return; }
    (d.bubbles||[]).forEach(b=>addB(b));
    metaChip(Object.assign({}, d.meta||{}, { items:(d.items||[]).length }));
    if(d.items && d.items.length) pending=d.items;
  }).catch(e=>{ typing(false); const el=document.createElement('div'); el.className='err'; el.textContent='x '+e.message; chat.appendChild(el); });
}

function sendMsg(){
  const t=txt.value.trim();
  if(!t) return;
  const isConfirm=/^(yes|ok|confirm|haan|ha|theek hai)\\.?$/i.test(t);
  txt.value='';
  if(isConfirm && pending){ ship('text',{ text:t, intent:'confirm', lastItems:pending }); pending=null; return; }
  ship('text',{ text:t });
}

$('send').onclick=sendMsg;
txt.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); sendMsg(); } });
$('clip').onclick=()=>$('file').click();
$('file').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{ const img=ev.target.result; ship('image',{ imageBase64:img.split(',')[1], imageMime:f.type||'image/jpeg', _img:img }); e.target.value=''; };
  r.readAsDataURL(f);
};
$('gear').onclick=()=>$('pow').classList.toggle('open');
txt.focus();
</script>
</body>
</html>`;
