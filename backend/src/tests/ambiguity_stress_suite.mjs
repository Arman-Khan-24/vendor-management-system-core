import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiExtractionProvider } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const key = 'process.env.GEMINI_API_KEY';
const model = 'gemini-3.1-flash-lite';
const provider = new GeminiExtractionProvider(key, model);

// Catalog containing products with varieties and unit splits
const catalog = [
  { id: '1', name: 'Tomato (Country/Naati)', unit: 'kg', current_price: 45 },
  { id: '2', name: 'Tomato (Hybrid)', unit: 'kg', current_price: 40 },
  { id: '3', name: 'Onion (Nashik)', unit: 'kg', current_price: 35 },
  { id: '4', name: 'Potato (Jyoti)', unit: 'kg', current_price: 30 },
  { id: '5', name: 'Watermelon', unit: 'piece', current_price: 60 },
  { id: '6', name: 'Watermelon', unit: 'kg', current_price: 25 },
  { id: '7', name: 'Banana (Robusta)', unit: 'dozen', current_price: 50 },
  { id: '8', name: 'Banana (Yellaki)', unit: 'dozen', current_price: 75 }
];

const testCases = [
  {
    id: 'CASE 1 (Repeated Devanagari Generic Tomato)',
    type: 'text',
    input: 'टमाटर 15 किलो और आलू 10 किलो',
    description: 'Generic Devanagari Tomato with two varieties in catalog'
  },
  {
    id: 'CASE 2 (English Generic Tomato repeated phrasing)',
    type: 'text',
    input: 'need 20kg tomato and 5kg onion',
    description: 'Generic English tomato with two varieties in catalog'
  },
  {
    id: 'CASE 3 (Generic Banana with two varieties: Robusta vs Yellaki)',
    type: 'text',
    input: 'send 4 dozen banana urgent',
    description: 'Generic Banana with Robusta vs Yellaki in catalog'
  },
  {
    id: 'CASE 4 (Unit ambiguity: Watermelon sold in piece vs kg)',
    type: 'text',
    input: 'watermelon 10',
    description: 'Product sold in both piece and kg with no unit specified'
  },
  {
    id: 'CASE 5 (Devanagari Image: Repeat Run of Handwritten Note)',
    type: 'image',
    filePath: path.join(__dirname, 'fixtures/devanagari_handwritten.png'),
    caption: 'दैनिक आर्डर',
    description: 'Vision OCR on handwritten note: टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो'
  }
];

async function runAmbiguityStressTest() {
  console.log('========================================================================');
  console.log(`  AMBIGUITY STRESS-TEST SUITE: 5 CASES WITH LIVE RAW MODEL RESPONSE     `);
  console.log(`  Model Tested: ${model} | API Key ends with: ${key.slice(-6)}         `);
  console.log('========================================================================\n');

  for (const tc of testCases) {
    console.log('------------------------------------------------------------------------');
    console.log(`[${tc.id}]`);
    console.log(`Description: ${tc.description}`);
    console.log(`Input: ${tc.type === 'text' ? `"${tc.input}"` : `Image Fixture (${path.basename(tc.filePath)})`}`);

    const start = Date.now();
    let res;
    if (tc.type === 'text') {
      res = await provider.extractOrderText(tc.input, catalog);
    } else {
      const buf = fs.readFileSync(tc.filePath);
      res = await provider.extractOrderImage(buf, 'image/png', catalog, tc.caption);
    }
    const latency = Date.now() - start;

    console.log(`\n>> 1. LIVE API RESPONSE (Latency: ${latency} ms):`);
    console.log(`   - Model field reported: "${res.model}"`);
    console.log(`   - Raw Candidate Text from Google API:\n${res.rawResponse.trim()}`);

    console.log(`\n>> 2. EXTRACTED JSON STRUCTURE:`);
    console.log(JSON.stringify(res.items, null, 2));

    // Hard backstop CatalogMatcher execution
    const match = CatalogMatcher.match(res.items, catalog);
    console.log(`\n>> 3. CATALOG MATCHER HARD BACKSTOP EVALUATION:`);
    console.log(`   - Is Valid (Order Allowed to Commit?): ${match.isValid}`);
    console.log(`   - Ambiguous Items Detected:`, JSON.stringify(match.ambiguousItems, null, 2));
    console.log(`   - Matched Items:`, JSON.stringify(match.matchedItems, null, 2));
    console.log(`   - Unresolved Items:`, match.unresolvedItems);

    if (match.ambiguousItems.length > 0) {
      console.log(`\n   ✓ VERIFIED: System correctly stopped and flagged ambiguity for customer clarification!`);
    } else if (!match.isValid) {
      console.log(`\n   ✓ VERIFIED: System stopped order commit (Invalid).`);
    } else {
      console.log(`\n   ✗ WARNING: Order passed without ambiguity flag!`);
    }
    console.log('\n');
  }
}

runAmbiguityStressTest().catch(console.error);
