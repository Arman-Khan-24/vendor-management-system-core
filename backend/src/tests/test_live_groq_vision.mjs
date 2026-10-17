import fs from 'fs';
import path from 'path';

async function testGroqVision() {
  const filePath = path.resolve('src/tests/fixtures/devanagari_handwritten.png');
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');

  console.log('Sending request to Groq API with model: qwen/qwen3.8-27b...');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer process.env.GROQ_API_KEY || '''
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract order items from this image as JSON with format: {"items": [{"product": "...", "quantity": 1, "unit": "kg"}]}' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    })
  });

  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Raw Groq Response:', JSON.stringify(data, null, 2));
}

testGroqVision();
