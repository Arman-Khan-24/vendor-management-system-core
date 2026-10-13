import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;
import { GeminiExtractionProvider, GroqExtractionProvider, AiOrderExtractionService } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

async function runLiveForcedFallback() {
  console.log('========================================================================');
  console.log('   LIVE FORCED FALLBACK TEST: GEMINI HARD-KILLED -> LIVE GROQ TAKEOVER  ');
  console.log('========================================================================');

  const bRes = await pool.query('SELECT id, name FROM businesses LIMIT 1');
  const business = bRes.rows[0];

  const catalog = [
    { id: '1', name: 'Tomato (Country/Naati)', unit: 'kg', current_price: 45 },
    { id: '2', name: 'Tomato (Hybrid)', unit: 'kg', current_price: 40 },
    { id: '3', name: 'Onion (Nashik)', unit: 'kg', current_price: 35 },
    { id: '4', name: 'Potato (Jyoti)', unit: 'kg', current_price: 30 }
  ];

  // Primary Gemini configured with bad key to guarantee 400/403/429 failure
  const badGeminiProvider = new GeminiExtractionProvider('INVALID_DEAD_KEY_FORCING_FAILURE', 'gemini-3.1-flash-lite');

  // Fallback Groq provider using the real Groq key
  const fallbackKey = process.env.GROQ_API_KEY;
  const groqProvider = new GroqExtractionProvider(fallbackKey, 'qwen/qwen3.8-27b', 'qwen/qwen3.8-27b');

  const extractionService = new AiOrderExtractionService(badGeminiProvider, groqProvider);

  // ---------------------------------------------------------
  // TEST 1: TEXT FORCED FALLBACK (Ambiguous Tomato)
  // ---------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 1: TEXT FALLBACK - "tomato 20kg and potato 10kg"');
  console.log('------------------------------------------------------------------------');
  const t0 = Date.now();
  let textResult;
  try {
    textResult = await extractionService.extract('tomato 20kg and potato 10kg', catalog);
  } catch (err) {
    console.error('Text extraction failed:', err);
    await pool.end();
    return;
  }
  const textLatency = Date.now() - t0;

  console.log('>> LIVE GROQ TEXT EXTRACTION OUTPUT:');
  console.log(`   wasFallback : ${textResult.wasFallback}`);
  console.log(`   provider    : ${textResult.provider}`);
  console.log(`   model       : ${textResult.model}`);
  console.log(`   latency     : ${textLatency}ms`);
  console.log(`   rawResponse : ${textResult.rawResponse}`);
  console.log(`   items       :`, JSON.stringify(textResult.items, null, 2));

  // CatalogMatcher evaluation
  const textMatch = CatalogMatcher.match(textResult.items, catalog);
  console.log('\n>> CATALOG MATCHER EVALUATION (TEXT):');
  console.log(`   isValid (Order Committable?) : ${textMatch.isValid}`);
  console.log(`   Ambiguous Items              :`, JSON.stringify(textMatch.ambiguousItems, null, 2));
  console.log(`   Matched Items                :`, JSON.stringify(textMatch.matchedItems, null, 2));

  // Insert audit into PostgreSQL
  const textAudit = await pool.query(
    `INSERT INTO ai_extraction_audits 
     (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, 'gemini', 'gemini-3.1-flash-lite', $2, $3, $4, true, 'tomato 20kg and potato 10kg', 'text', $5, $6, $7)
     RETURNING id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, duration_ms, created_at`,
    [business.id, textResult.provider, textResult.model, textResult.wasFallback, textResult.rawResponse, JSON.stringify(textResult.items), textLatency]
  );
  console.log('\n>> POSTGRESQL AUDIT ROW (TEXT):');
  console.log(JSON.stringify(textAudit.rows[0], null, 2));

  // ---------------------------------------------------------
  // TEST 2: VISION FORCED FALLBACK (Handwritten Devanagari Note)
  // ---------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 2: VISION FALLBACK - Handwritten Note (टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो)');
  console.log('------------------------------------------------------------------------');
  const imgPath = path.resolve('src/tests/fixtures/devanagari_handwritten.png');
  const imgBuf = fs.readFileSync(imgPath);

  const v0 = Date.now();
  let visionResult;
  try {
    visionResult = await extractionService.extractImage(imgBuf, 'image/png', catalog, 'devanagari note');
  } catch (err) {
    console.error('Vision extraction failed:', err);
    await pool.end();
    return;
  }
  const visionLatency = Date.now() - v0;

  console.log('>> LIVE GROQ VISION EXTRACTION OUTPUT:');
  console.log(`   wasFallback : ${visionResult.wasFallback}`);
  console.log(`   provider    : ${visionResult.provider}`);
  console.log(`   model       : ${visionResult.model}`);
  console.log(`   latency     : ${visionLatency}ms`);
  console.log(`   rawResponse : ${visionResult.rawResponse}`);
  console.log(`   items       :`, JSON.stringify(visionResult.items, null, 2));

  const visionMatch = CatalogMatcher.match(visionResult.items, catalog);
  console.log('\n>> CATALOG MATCHER EVALUATION (VISION):');
  console.log(`   isValid (Order Committable?) : ${visionMatch.isValid}`);
  console.log(`   Ambiguous Items              :`, JSON.stringify(visionMatch.ambiguousItems, null, 2));
  console.log(`   Matched Items                :`, JSON.stringify(visionMatch.matchedItems, null, 2));

  // Sanitize for DB (WIN1252 encoding safe)
  const toAsciiSafe = (val) => {
    if (typeof val === 'string') {
      return val.replace(/[^\x00-\x7F]/g, ch => `[U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
    }
    if (Array.isArray(val)) return val.map(toAsciiSafe);
    if (val && typeof val === 'object') {
      const res = {};
      for (const k of Object.keys(val)) res[k] = toAsciiSafe(val[k]);
      return res;
    }
    return val;
  };

  const sanitizedVisionRaw = toAsciiSafe(visionResult.rawResponse);
  const sanitizedVisionItems = JSON.stringify(toAsciiSafe(visionResult.items));

  const visionAudit = await pool.query(
    `INSERT INTO ai_extraction_audits 
     (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, 'gemini', 'gemini-3.1-flash-lite', $2, $3, $4, true, 'devanagari_handwritten.png', 'image', $5, $6, $7)
     RETURNING id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, duration_ms, created_at`,
    [business.id, visionResult.provider, visionResult.model, visionResult.wasFallback, sanitizedVisionRaw, sanitizedVisionItems, visionLatency]
  );
  console.log('\n>> POSTGRESQL AUDIT ROW (VISION):');
  console.log(JSON.stringify(visionAudit.rows[0], null, 2));

  console.log('\n========================================================================');
  console.log('   ALL FORCED FALLBACK TESTS COMPLETE - LIVE GROQ VERIFIED               ');
  console.log('========================================================================');

  await pool.end();
}

runLiveForcedFallback().catch(console.error);
