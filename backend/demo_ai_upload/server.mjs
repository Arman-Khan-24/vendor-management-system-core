// language: Node/JavaScript, file: demo_ai_upload/server.mjs, target: local AI demo server
// Serves a photo/text -> order-extraction demo UI, calls Gemini 3.5 Flash-Lite with the
// key from backend/.env. Run:  node demo_ai_upload/server.mjs   -> http://localhost:7777
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const KEY = process.env.GEMINI_API_KEY;
if (!KEY || KEY.trim().length < 10) { console.error('GEMINI_API_KEY missing in backend/.env'); process.exit(1); }
const MODEL_DEFAULT = process.env.DEMO_MODEL || 'gemini-3.5-flash-lite';

const app = express();
app.use(express.json({ limit: '25mb' }));

// same catalog shape the production service uses; editable in the UI
const DEFAULT_CATALOG = `Tomato (Country/Naati) | Unit: kg
Tomato (Hybrid) | Unit: kg
Onion (Nashik) | Unit: kg
Potato (Jyoti) | Unit: kg
Lady Finger (Bhindi) | Unit: kg
Banana (Yellaki) | Unit: dozen`;

const TEXT_PROMPT = (catalog) => `You are OrderLedger AI order extractor for a wholesale vendor.
Vendor Catalog (reference only — items may exist beyond it):
${catalog}

Incoming customer message:
"$MSG"

TASK:
Transcribe as an ORDER: every product mentioned, whether or not it is in the vendor catalog.
Return structured JSON:
{"items":[{"product":"exact name as written by customer","quantity":number,"unit":"kg/dozen/crate/etc"}],"warnings":[]}
CRITICAL PARSING RULES:
1. Comma-less and "and"-joined multi-item lists are PRIMARY formats (e.g. "tomato 5kg pyaz 3kg aalu 10kg" = 4 items).
2. NEVER merge adjacent items or drop items. Extract every item. NEVER omit an item because it is missing from the catalog.
3. Understand Hinglish/Hindi synonyms in Roman and Devanagari script (tamatar, pyaz, aalu, bhindi, dozen->darjan).
4. Quantity with no unit -> unit "".
5. If nothing parseable, return items: [] and explain in warnings.
6. Output valid JSON only, no markdown fences.`;

const VISION_PROMPT = (catalog) => `You are OrderLedger AI Vision order transcriber.
You inspect a photo of a customer's order (handwritten notepad, printed slip, whiteboard).
Vendor Catalog (reference only — the list may be incomplete):
${catalog}

TASK: Transcribe EVERY item visible in the photo with quantity and unit —
including items that are NOT in the vendor's catalog. Never skip or omit an item
just because the vendor's catalog does not have it.
Return structured JSON:
{"items":[{"product":"exact written name (keep original language, e.g. Hindi term)","quantity":number,"unit":"kg/dozen/crate/piece"}],"warnings":[]}
VISION RULES:
1. Handle angled photos, uneven light, handwriting, Devanagari, mixed script.
2. Crossed-out/corrected items -> take ONLY the final correction.
3. Illegible bits -> warning, never guess wildly.
4. Blank or non-order photo -> items: [] + warning.
5. Output valid JSON only, no markdown fences.`;

// deterministic catalog tagging: item is "in stock-catalog" when its base name
// matches (case-insensitive, before variety parentheses) any catalog base name
function baseName(line) {
  return line.split('|')[0].replace(/\(.*?\)/g, '').trim().toLowerCase();
}
function catalogBaseNames(catalog) {
  return (catalog || '').split('\n').map(baseName).filter(w => w.length > 1);
}
// common Roman-Hindi -> English produce synonyms so "pyaz" matches "Onion"
const SYNONYMS = [
  [/tamat[ae]r|tamatar/g,'tomato'], [/pya?z|onion/g,'onion'], [/aloo|aalu/g,'potato'],
  [/bhind[iy]/g,'ladyfinger'], [/dal|lentil/g,'dal'], [/kela/g,'banana'],
  [/baingan/g,'brinjal'], [/gobhi|gobi/g,'cauliflower'], [/matar/g,'peas'],
  [/dhania|coriander/g,'coriander'], [/ptta|patta|leaf/g,'leaf'],
  [/kaddu/g,'pumpkin'], [/karela/g,'bittergourd'], [/mirch/g,'chilli']
];
function normalizeName(s) {
  let n = ' ' + String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\u0900-\u097F]+/g, ' ') + ' ';
  for (const [re, en] of SYNONYMS) n = n.replace(re, en);
  return n.trim();
}
function tagCatalog(items, catalog) {
  const bases = catalogBaseNames(catalog).map(normalizeName);
  const missing = [];
  for (const item of items || []) {
    const p = normalizeName(item.product);
    item.inCatalog = bases.some(b => p.includes(b) || b.includes(p));
    if (!item.inCatalog) missing.push(item.product);
  }
  return missing;
}

async function callGemini(model, prompt, imageB64, imageMime) {
  const parts = [{ text: prompt }];
  if (imageB64) parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageB64 } });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from model');
  return text;
}

app.get('/api/models', (_req, res) =>
  res.json({ models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'], default: MODEL_DEFAULT }));

app.post('/api/extract', async (req, res) => {
  const { mode, text, imageBase64, imageMime, catalog, model } = req.body || {};
  try {
    if (mode === 'text' && text) {
      const prompt = TEXT_PROMPT(catalog || DEFAULT_CATALOG).replace('$MSG', String(text).slice(0, 4000));
      const reply = await callGemini(model || MODEL_DEFAULT, prompt, null, null);
      const parsed = JSON.parse(reply);
      const missing = tagCatalog(parsed.items, catalog || DEFAULT_CATALOG);
      if (missing.length) parsed.warnings = [...(parsed.warnings || []), 'Not in shop catalog: ' + missing.join(', ')];
      return res.json({ raw: reply, parsed });
    }
    if (mode === 'image' && imageBase64) {
      const prompt = VISION_PROMPT(catalog || DEFAULT_CATALOG);
      const reply = await callGemini(model || MODEL_DEFAULT, prompt, imageBase64, imageMime);
      const parsed = JSON.parse(reply);
      const missing = tagCatalog(parsed.items, catalog || DEFAULT_CATALOG);
      if (missing.length) parsed.warnings = [...(parsed.warnings || []), 'Not in shop catalog: ' + missing.join(', ')];
      return res.json({ raw: reply, parsed });
    }
    return res.status(400).json({ error: 'Nothing to extract. Send text or an image.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/', (_req, res) => res.type('html').send(PAGE));

const PORT = process.env.DEMO_PORT || 7777;
app.listen(PORT, () => console.log(`AI DEMO -> http://localhost:${PORT}`));

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrderLedger AI — Live Demo</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, 'Segoe UI', sans-serif; background:#0e1116; color:#e6e8ee; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color:#8b93a1; font-size:14px; margin-bottom:20px; }
  .card { background:#161b22; border:1px solid #232a35; border-radius:14px; padding:18px; margin-bottom:16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .drop { border:2px dashed #2e3947; border-radius:12px; padding:28px 12px; text-align:center; cursor:pointer; transition:.2s; }
  .drop:hover,.drop.drag { border-color:#6ea8fe; background:#131926; }
  .drop input { display:none; }
  button { background:#2f6fed; border:0; color:#fff; padding:10px 18px; border-radius:9px; font-size:14px; cursor:pointer; font-weight:600; }
  button:disabled { opacity:.4; cursor:wait; }
  button.ghost { background:#232a35; }
  select,textarea { background:#0e1116; color:#e6e8ee; border:1px solid #2e3947; border-radius:9px; padding:9px 12px; font-size:14px; }
  textarea { width:100%; min-height:70px; resize:vertical; font-family:inherit; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:15px; }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid #232a35; }
  th { color:#8b93a1; font-weight:600; font-size:13px; }
  .qty b { color:#6ea8fe; }
  .warn { background:#2a2013; border:1px solid #5c4a1e; color:#e6c66e; border-radius:9px; padding:10px 14px; margin-top:10px; font-size:14px; white-space:pre-wrap; }
  .chip { display:inline-block; background:#232a35; color:#9fb0c9; border-radius:20px; padding:4px 12px; font-size:12px; margin:2px; }
  .preview { max-width:100%; max-height:420px; border-radius:10px; display:block; margin:0 auto; }
  details { margin-top:12px; color:#8b93a1; font-size:13px; }
  pre { background:#0a0d12; padding:12px; border-radius:9px; overflow-x:auto; font-size:12px; color:#9fd1a0; }
  .err { color:#ff8f8f; background:#2a1517; border:1px solid #64232a; border-radius:9px; padding:10px 14px; }
  details.cat { margin:10px 0; }
  .spin i { display:inline-block; width:14px; height:14px; border:2px solid #2f6fed; border-top-color:transparent; border-radius:50%; animation:r 1s linear infinite; vertical-align:-2px; }
  @keyframes r { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap">
  <h1>OrderLedger AI — live photo &amp; text demo</h1>
  <div class="sub">customer WhatsApp order → same prompt the backend uses → structured order for the ledger. key stays server-side.</div>

  <div class="card">
    <div class="row" style="align-items:center;margin-bottom:12px">
      <select id="mode">
        <option value="image">📷 Photo of order</option>
        <option value="text">💬 Typed order text</option>
      </select>
      <select id="model"></select>
      <button id="go" style="margin-left:auto">Extract order</button>
    </div>

    <div id="imgPane">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*" capture="environment">
        <div><b>click / drop photo</b> — of a handwriting note, order slip, or whiteboard<br><span style="color:#8b93a1;font-size:13px">phone camera works directly (many phones open camera instantly)</span></div>
      </label>
      <img id="preview" class="preview" style="display:none">
    </div>

    <div id="txtPane" style="display:none">
      <textarea id="txt" placeholder='tamatar 5kg pyaz 3kg aalu 10kg bhindi 2kg and banana 2 dozen'>tamatar 5kg pyaz 3kg aalu 10kg bhindi 2kg and banana 2 dozen</textarea>
    </div>

    <details class="cat">
      <summary>Catalog (edit to match any shop)</summary>
      <textarea id="catalog">${DEFAULT_CATALOG}</textarea>
    </details>
  </div>

  <div class="card" id="outCard" style="display:none">
    <div id="meta"></div>
    <table id="tbl"><thead><tr><th>Product</th><th>Quantity</th><th>Unit</th><th>Shop stock</th></tr></thead><tbody></tbody></table>
    <div id="warn"></div>
    <details><summary>Raw JSON</summary><pre id="raw"></pre></details>
  </div>
</div>
<script>
const $ = id => document.getElementById(id);
const modeSel=$('mode'), modelSel=$('model'), fileEl=$('file'), preview=$('preview'), go=$('go');
let currentB64=null, currentMime='image/jpeg';

fetch('/api/models').then(r=>r.json()).then(d=>{
  modelSel.innerHTML = d.models.map(m=>'<option '+((m===d.default)?'selected':'')+'>'+m+'</option>').join('');
});

modeSel.onchange = ()=>{
  $('imgPane').style.display = modeSel.value==='image' ? 'block':'none';
  $('txtPane').style.display = modeSel.value==='text' ? 'block':'none';
};

const readF = f=>{
  const r=new FileReader();
  r.onload=e=>{ preview.src=e.target.result; preview.style.display='block';
    currentMime=f.type||'image/jpeg'; currentB64=e.target.result.split(',')[1]; };
  r.readAsDataURL(f);
};
fileEl.onchange = e=> e.target.files[0] && readF(e.target.files[0]);
const drop=$('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag');});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)readF(f);});

go.onclick = async ()=> {
  const t0=performance.now();
  go.disabled=true; go.innerHTML='<span class="spin"><i></i></span> extracting… '+0+'s';
  const tick=setInterval(()=>{ go.innerHTML='<span class="spin"><i></i></span> extracting… '+Math.floor((performance.now()-t0)/1000)+'s'; },500);
  $('outCard').style.display='none';
  try {
    const body = modeSel.value==='text'
      ? { mode:'text', text:$('txt').value, catalog:$('catalog').value, model:modelSel.value }
      : { mode:'image', imageBase64:currentB64, imageMime:currentMime, catalog:$('catalog').value, model:modelSel.value };
    const r = await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    const items = d.parsed.items||[], warns = d.parsed.warnings||[];
    document.querySelector('#tbl tbody').innerHTML = items.map(i=>{
      const inCat = i.inCatalog;
      const badge = (inCat===true) ? '<span style="color:#57d482">✓ in stock</span>'
                  : (inCat===false) ? '<span style="color:#ff9b6a">✗ missing</span>'
                  : '<span style="color:#8b93a1">—</span>';
      const rowStyle = (inCat===false) ? ' style="opacity:.85"' : '';
      return '<tr'+rowStyle+'><td>'+i.product+'</td><td class="qty"><b>'+i.quantity+'</b></td><td>'+i.unit+'</td><td>'+badge+'</td></tr>';
    }).join('');
    $('warn').innerHTML = warns.length ? '<div class="warn">⚠ '+warns.join('<br>⚠ ')+'</div>' : '';
    const miss = items.filter(i=>i.inCatalog===false).length;
    $('meta').innerHTML = 'model <span class="chip">'+modelSel.value+'</span> in <span class="chip">'+Math.round(performance.now()-t0)+'ms</span> items <span class="chip">'+items.length+'</span>'+(miss?'<span class="chip" style="background:#3a2313;color:#ff9b6a">'+miss+' not in catalog</span>':'');
    $('raw').textContent = JSON.stringify(d.parsed,null,2);
    $('outCard').style.display='block';
  } catch(e) {
    $('outCard').style.display='block';
    document.querySelector('#tbl tbody').innerHTML='';
    $('warn').innerHTML='<div class="err">✗ '+e.message+'</div>';
    $('meta').innerHTML='';
    $('raw').textContent='';
  } finally { clearInterval(tick); go.disabled=false; go.textContent='Extract order'; }
};
</script>
</body>
</html>`;
