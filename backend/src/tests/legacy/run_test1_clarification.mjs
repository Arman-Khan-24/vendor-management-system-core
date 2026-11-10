import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiExtractionProvider } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const key = 'process.env.GEMINI_API_KEY || ''';
const provider = new GeminiExtractionProvider(key, 'gemini-3.1-flash-lite');

const catalog = [
  { id: '1', name: 'Tomato (Country/Naati)', unit: 'kg', current_price: 45 },
  { id: '2', name: 'Tomato (Hybrid)', unit: 'kg', current_price: 40 },
  { id: '3', name: 'Onion (Nashik)', unit: 'kg', current_price: 35 },
  { id: '4', name: 'Potato (Jyoti)', unit: 'kg', current_price: 30 }
];

const imgBuf = fs.readFileSync(path.join(__dirname, 'fixtures/devanagari_handwritten.png'));

async function main() {
  console.log('Sending devanagari_handwritten.png to gemini-3.7-flash...');
  const start = Date.now();
  const res = await provider.extractOrderImage(imgBuf, 'image/png', catalog, 'दैनिक आर्डर');
  console.log('Duration:', Date.now() - start, 'ms');
  console.log('Extracted items:\n', JSON.stringify(res.items, null, 2));
  console.log('Warnings:\n', JSON.stringify(res.warnings, null, 2));

  const match = CatalogMatcher.match(res.items, catalog);
  console.log('Match isValid:', match.isValid);
  console.log('Matched items:\n', JSON.stringify(match.matchedItems, null, 2));
  console.log('Ambiguous items:\n', JSON.stringify(match.ambiguousItems, null, 2));

  // Build outbound clarification message
  let clarification = 'Could not fully read or match your order photo:';
  if (match.ambiguousItems.length > 0) {
    for (const amb of match.ambiguousItems) {
      clarification += `\n- "${amb.input}" matches multiple items (${amb.candidates.join(' / ')}). Please clarify.`;
    }
  }
  clarification += '\nPlease reply with the updated item names and quantities.';

  console.log('\n======================================================');
  console.log('ACTUAL OUTBOUND WHATSAPP CLARIFICATION MESSAGE:');
  console.log('======================================================\n');
  console.log(clarification);
}

main().catch(console.error);
