// language: Node/JavaScript, file: demo_ai.mjs, target: OrderLedger AI demo
// Live demo of the AI order extraction: text order (Hinglish) + handwritten photo order
// Run from backend folder:  node demo_ai.mjs
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_KEY || GEMINI_KEY.trim().length < 10) {
  console.error('No GEMINI_API_KEY found in backend/.env');
  process.exit(1);
}

// compiled service from the repo (same code production uses)
const { GeminiExtractionProvider } = await import('./dist/services/ai/ai.service.js');

// catalog mirrors a real fresh-produce shop (ambiguous varieties included on purpose)
const catalog = [
  { id: '1', name: 'Tomato (Country/Naati)', unit: 'kg', current_price: 45 },
  { id: '2', name: 'Tomato (Hybrid)', unit: 'kg', current_price: 40 },
  { id: '3', name: 'Onion (Nashik)', unit: 'kg', current_price: 35 },
  { id: '4', name: 'Potato (Jyoti)', unit: 'kg', current_price: 30 },
  { id: '5', name: 'Lady Finger (Bhindi)', unit: 'kg', current_price: 50 },
  { id: '6', name: 'Banana (Yellaki)', unit: 'dozen', current_price: 60 }
];

const provider = new GeminiExtractionProvider(GEMINI_KEY, 'gemini-3.5-flash-lite');

// 1) text order â€” comma-less Hinglish, exactly how customers type on WhatsApp
const textOrder = 'tamatar 5kg pyaz 3kg aalu 10kg bhindi 2kg and banana 2 dozen';

console.log('=== DEMO 1: TEXT ORDER ON WHATSAPP ===');
console.log('Customer message: "' + textOrder + '"');
const t1 = Date.now();
const textBox = await provider.extractOrderText(textOrder, catalog);
console.log('gemini-3.5-flash-lite replied in', Date.now() - t1, 'ms');
console.log(JSON.stringify({ items: textBox.items, warnings: textBox.warnings }, null, 2));

// 2) photo order â€” the handwritten Devanagari fixture shipped in the repo
const imgPath = path.resolve('src/tests/fixtures/devanagari_handwritten.png');
const imgBuf = fs.readFileSync(imgPath);

console.log('\n=== DEMO 2: HANDWRITTEN PHOTO ORDER (Devanagari) ===');
const t2 = Date.now();
const imgBox = await provider.extractOrderImage(imgBuf, 'image/png', catalog, 'à¤¥à¥ˆà¤²à¥‡ à¤®à¥‡à¤‚ à¤­à¥‡à¤œà¥‹');
console.log('gemini-3.5-flash-lite (vision) replied in', Date.now() - t2, 'ms');
console.log(JSON.stringify({ items: imgBox.items, warnings: imgBox.warnings }, null, 2));
