import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import { GeminiExtractionProvider } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'");
});

async function runDevanagariSuite() {
  console.log('================================================================');
  console.log('  LIVE DEVANAGARI & MIXED SCRIPT TESTING SUITE (GEMINI 2.5 FLASH) ');
  console.log('================================================================');

  const bRes = await pool.query('SELECT id, name FROM businesses LIMIT 1');
  const business = bRes.rows[0];

  const catRes = await pool.query('SELECT id, name, unit, current_price FROM products WHERE business_id = $1 ORDER BY name ASC', [business.id]);
  const catalog = catRes.rows.map(r => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    current_price: parseFloat(r.current_price)
  }));

  console.log(`Business Tenant: ${business.name}`);
  console.log(`Active Catalog Products:`);
  catalog.forEach(c => console.log(`  - ${c.name} (${c.unit}) @ ₹${c.current_price}`));

  const apiKey = process.env.AI_PRIMARY_API_KEY || 'process.env.GEMINI_API_KEY || ''';
  const model = process.env.AI_PRIMARY_MODEL || 'gemini-2.5-flash';
  const provider = new GeminiExtractionProvider(apiKey, model);

  console.log(`\nGemini API Key ends with: ${apiKey.slice(-6)}`);
  console.log(`Gemini Vision & Text Model: ${model}`);

  // -------------------------------------------------------------
  // TEST 1: Pure Devanagari Handwritten Note (Vision)
  // "टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो"
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TEST 1: Pure Devanagari Handwritten Image (Vision)');
  console.log('Image Fixture: devanagari_handwritten.png');
  const devImgPath = path.join(FIXTURES_DIR, 'devanagari_handwritten.png');
  const devImgBuf = fs.readFileSync(devImgPath);
  console.log(`Image Size: ${devImgBuf.length} bytes (image/png)`);

  const t1Start = Date.now();
  const res1 = await provider.extractOrderImage(devImgBuf, 'image/png', catalog, 'दैनिक आर्डर');
  const t1Duration = Date.now() - t1Start;

  console.log(`\n>> LIVE GEMINI VISION API RESULT:`);
  console.log(`   - Duration (real latency): ${t1Duration} ms`);
  console.log(`   - Model: ${res1.model}`);
  console.log(`   - Raw Response from Gemini:\n${res1.rawResponse}`);
  console.log(`   - Extracted Items:`, JSON.stringify(res1.items, null, 2));

  const match1 = CatalogMatcher.match(res1.items, catalog);
  console.log(`\n>> CATALOG MATCHER RESULT:`);
  console.log(`   - Is Valid: ${match1.isValid}`);
  console.log(`   - Matched Items:`, JSON.stringify(match1.matchedItems, null, 2));
  console.log(`   - Unresolved:`, match1.unresolvedItems);
  console.log(`   - Ambiguous:`, match1.ambiguousItems);

  // Record audit in DB
  const safeText1 = '[Devanagari Image]: Tamatar 10kg, Pyaz 5kg, Aalu 15kg';
  await pool.query(
    `INSERT INTO ai_extraction_audits (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, $2, $3, $4, $5, false, true, $6, 'image', $7, $8, $9)`,
    [business.id, 'gemini', model, 'gemini', model, safeText1, res1.rawResponse, JSON.stringify(res1.items), t1Duration]
  );

  // -------------------------------------------------------------
  // TEST 2: Pure Devanagari WhatsApp Text Message (Text Pipeline)
  // "टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो"
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TEST 2: Pure Devanagari WhatsApp Text Message (Text Pipeline)');
  const devanagariText = 'टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो';
  console.log(`Input Text: "${devanagariText}"`);

  const t2Start = Date.now();
  const res2 = await provider.extractOrderText(devanagariText, catalog);
  const t2Duration = Date.now() - t2Start;

  console.log(`\n>> LIVE GEMINI TEXT API RESULT:`);
  console.log(`   - Duration (real latency): ${t2Duration} ms`);
  console.log(`   - Model: ${res2.model}`);
  console.log(`   - Raw Response from Gemini:\n${res2.rawResponse}`);
  console.log(`   - Extracted Items:`, JSON.stringify(res2.items, null, 2));

  const match2 = CatalogMatcher.match(res2.items, catalog);
  console.log(`\n>> CATALOG MATCHER RESULT:`);
  console.log(`   - Is Valid: ${match2.isValid}`);
  console.log(`   - Matched Items:`, JSON.stringify(match2.matchedItems, null, 2));
  console.log(`   - Unresolved:`, match2.unresolvedItems);
  console.log(`   - Ambiguous:`, match2.ambiguousItems);

  const safeText2 = '[Devanagari Text]: Tamatar 10kg, Pyaz 5kg, Aalu 15kg';
  await pool.query(
    `INSERT INTO ai_extraction_audits (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, $2, $3, $4, $5, false, true, $6, 'text', $7, $8, $9)`,
    [business.id, 'gemini', model, 'gemini', model, safeText2, res2.rawResponse, JSON.stringify(res2.items), t2Duration]
  );

  // -------------------------------------------------------------
  // TEST 3: Mixed Script Handwritten Note (Vision)
  // "टमाटर (Hybrid) 12 kg, Potato 15 किलो, प्याज़ (Nashik) 8 kg, Banana 2 दर्जन"
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TEST 3: Mixed Script Handwritten Note (Devanagari + English/Romanized)');
  console.log('Image Fixture: mixed_script_note.png');
  const mixedImgPath = path.join(FIXTURES_DIR, 'mixed_script_note.png');
  const mixedImgBuf = fs.readFileSync(mixedImgPath);
  console.log(`Image Size: ${mixedImgBuf.length} bytes (image/png)`);

  const t3Start = Date.now();
  const res3 = await provider.extractOrderImage(mixedImgBuf, 'image/png', catalog, 'Daily Kitchen Supplies (मिक्स आर्डर)');
  const t3Duration = Date.now() - t3Start;

  console.log(`\n>> LIVE GEMINI VISION API RESULT:`);
  console.log(`   - Duration (real latency): ${t3Duration} ms`);
  console.log(`   - Model: ${res3.model}`);
  console.log(`   - Raw Response from Gemini:\n${res3.rawResponse}`);
  console.log(`   - Extracted Items:`, JSON.stringify(res3.items, null, 2));

  const match3 = CatalogMatcher.match(res3.items, catalog);
  console.log(`\n>> CATALOG MATCHER RESULT:`);
  console.log(`   - Is Valid: ${match3.isValid}`);
  console.log(`   - Matched Items:`, JSON.stringify(match3.matchedItems, null, 2));
  console.log(`   - Unresolved:`, match3.unresolvedItems);
  console.log(`   - Ambiguous:`, match3.ambiguousItems);

  const safeText3 = '[Mixed Script Image]: Daily Kitchen Supplies (Mix Order)';
  await pool.query(
    `INSERT INTO ai_extraction_audits (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, $2, $3, $4, $5, false, true, $6, 'image', $7, $8, $9)`,
    [business.id, 'gemini', model, 'gemini', model, safeText3, res3.rawResponse, JSON.stringify(res3.items), t3Duration]
  );

  console.log('\n================================================================');
  console.log('     ALL 3 DEVANAGARI TESTS COMPLETED SUCCESSFULLY!              ');
  console.log('================================================================');

  await pool.end();
}

runDevanagariSuite().catch(err => {
  console.error('Test Suite Error:', err);
  pool.end();
  process.exit(1);
});
