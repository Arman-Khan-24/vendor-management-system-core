import { AiOrderExtractionService } from '../../dist/services/ai/ai.service.js';
import { CatalogMatcher } from '../../dist/services/ai/catalog.matcher.js';
import { pool } from '../../dist/database/connection.js';

const testCases = [
  // Original 4 test cases
  'tomato 5kg pyaz 3kg aalu 10kg bhindi 2kg',
  'need: Tomatoes- 20, onion 15 kg, potato , banana 2dz',
  'tomaot 10kgg',
  'tomato 5kg and potato 10kg',

  // 5 New Real-World Test Cases:
  // Case 5: No commas, space-separated Hindi & English items
  'tamatar 15kg batata 25kg pyaz 10kg kanda 5kg',
  
  // Case 6: "and"-joined items with conversational filler
  'bhai please send tomato 12kg and onion 8kg and okra 4kg',
  
  // Case 7: Mixed plural cases, numbers without units, and abbreviations
  'Tomatoes 30 kgs and Potatoes 20 and Banana 4 dozen',
  
  // Case 8: Multiline with mixed English and Hinglish shorthands
  'bhindi 5kg\nchilli 2kg and mirchi 1kg\npyaz 20kg',
  
  // Case 9: Unintelligible / random non-order chat message
  'kal subah rate kya hoga bhaiya?'
];

async function runStressTest() {
  const aiService = new AiOrderExtractionService();

  // Create a temporary mock catalog with standard Hindi synonyms to test both matching and ambiguity
  const catalog = [
    { id: 'prod-tomato-hybrid', name: 'Tomato (Hybrid)', unit: 'kg', price: 40 },
    { id: 'prod-onion', name: 'Onion (Pyaz)', unit: 'kg', price: 35 },
    { id: 'prod-potato', name: 'Potato (Aalu/Jyoti)', unit: 'kg', price: 30 },
    { id: 'prod-okra', name: 'Bhindi (Okra)', unit: 'kg', price: 50 },
    { id: 'prod-banana', name: 'Banana', unit: 'dozen', price: 60 }
  ];

  console.log('================================================================');
  console.log('PHASE 3 STRESS TEST: MESSY INPUT EXTRACTION & CATALOG MATCHING');
  console.log('================================================================\n');

  for (let i = 0; i < testCases.length; i++) {
    const input = testCases[i];
    console.log(`----------------------------------------------------------------`);
    console.log(`TEST CASE ${i + 1}: "${input}"`);
    console.log(`----------------------------------------------------------------`);

    const extractionResult = await aiService.extract(input, catalog);
    console.log('AI Extraction Raw JSON Output:');
    console.log(JSON.stringify(extractionResult, null, 2));

    const matchResult = CatalogMatcher.match(extractionResult.items, catalog);
    console.log('\nCatalog Matching & Validation Result:');
    console.log(JSON.stringify(matchResult, null, 2));
    console.log('\n');
  }

  process.exit(0);
}

runStressTest().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
