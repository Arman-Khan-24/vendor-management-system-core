import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import { GeminiExtractionProvider, GroqExtractionProvider, AiOrderExtractionService } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

async function runForcedFallbackTest() {
  console.log('========================================================================');
  console.log('   FORCED FALLBACK STRESS TEST: GEMINI INTENTIONALLY FAILS              ');
  console.log('========================================================================');

  const bRes = await pool.query('SELECT id, name FROM businesses LIMIT 1');
  const business = bRes.rows[0];

  const catalog = [
    { id: '1', name: 'Tomato (Country/Naati)', unit: 'kg', current_price: 45 },
    { id: '2', name: 'Tomato (Hybrid)', unit: 'kg', current_price: 40 },
    { id: '3', name: 'Onion (Nashik)', unit: 'kg', current_price: 35 },
    { id: '4', name: 'Potato (Jyoti)', unit: 'kg', current_price: 30 }
  ];

  // 1. Primary Gemini configured with bad key to guarantee 400/403/429 failure
  const badGeminiProvider = new GeminiExtractionProvider('INVALID_DEAD_KEY_FORCING_FAILURE', 'gemini-3.1-flash-lite');

  // 2. Fallback Groq provider
  const fallbackKey = process.env.GROQ_API_KEY || 'mock';
  const groqProvider = new GroqExtractionProvider(fallbackKey, 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b');

  const extractionService = new AiOrderExtractionService(badGeminiProvider, groqProvider);

  console.log(`Testing input: "tomato 20kg and potato 10kg" (Generic tomato with two catalog varieties)`);
  console.log(`Primary Provider: gemini (FORCED TO FAIL)`);
  console.log(`Fallback Provider: groq (${fallbackKey === 'mock' ? 'SIMULATED / NO LIVE KEY IN .ENV' : 'LIVE KEY PRESENT'})\n`);

  const start = Date.now();
  let result;
  try {
    result = await extractionService.extract('tomato 20kg and potato 10kg', catalog);
  } catch (err) {
    console.error('Extraction error:', err.message);
    await pool.end();
    return;
  }
  const latency = Date.now() - start;

  console.log('>> EXTRACTION RESULT:');
  console.log(`   - Was Fallback Triggered: ${result.wasFallback}`);
  console.log(`   - Provider Used: ${result.provider}`);
  console.log(`   - Model Used: ${result.model}`);
  console.log(`   - Extracted Items:`, JSON.stringify(result.items, null, 2));

  // CatalogMatcher evaluation
  const match = CatalogMatcher.match(result.items, catalog);
  console.log('\n>> CATALOG MATCHER HARD BACKSTOP EVALUATION:');
  console.log(`   - Is Valid (Order Allowed to Commit?): ${match.isValid}`);
  console.log(`   - Ambiguous Items:`, JSON.stringify(match.ambiguousItems, null, 2));
  console.log(`   - Matched Items:`, JSON.stringify(match.matchedItems, null, 2));

  // Write audit row to PostgreSQL
  const auditRes = await pool.query(
    `INSERT INTO ai_extraction_audits 
     (business_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, raw_response, structured_output, duration_ms)
     VALUES ($1, 'gemini', 'gemini-3.1-flash-lite', $2, $3, $4, true, 'tomato 20kg and potato 10kg', 'text', $5, $6, $7)
     RETURNING id, primary_provider, used_provider, used_model, was_fallback, duration_ms`,
    [business.id, result.provider, result.model, result.wasFallback, result.rawResponse, JSON.stringify(result.items), latency]
  );

  console.log('\n>> DATABASE AUDIT ROW INSERTED:');
  console.log(JSON.stringify(auditRes.rows[0], null, 2));

  await pool.end();
}

runForcedFallbackTest().catch(console.error);
