import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

const templates = [
  {
    filename: 'devanagari_handwritten.png',
    title: 'Pure Devanagari Handwritten Note',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #fdfaf2;
            font-family: 'Nirmala UI', 'Mangal', 'Segoe UI', cursive, sans-serif;
            color: #1a237e;
          }
          .notepad {
            background: #fffefb;
            border: 1px solid #dcd4c3;
            border-radius: 4px;
            box-shadow: 2px 4px 14px rgba(0,0,0,0.09);
            padding: 40px 50px;
            width: 520px;
            background-image: repeating-linear-gradient(#fffefb 0px, #fffefb 40px, #e8dfcc 41px, #fffefb 42px);
          }
          .header {
            font-size: 32px;
            font-weight: bold;
            color: #b71c1c;
            margin-bottom: 25px;
            text-decoration: underline;
          }
          .item {
            font-size: 32px;
            line-height: 42px;
            font-weight: 600;
            color: #0d47a1;
          }
        </style>
      </head>
      <body>
        <div class="notepad">
          <div class="header">दैनिक आर्डर - रसोई</div>
          <div class="item">• टमाटर 10 किलो</div>
          <div class="item">• प्याज़ 5 किलो</div>
          <div class="item">• आलू 15 किलो</div>
        </div>
      </body>
      </html>
    `
  },
  {
    filename: 'mixed_script_note.png',
    title: 'Mixed Script Note (Devanagari + English/Hinglish)',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #f1f2f6;
            font-family: 'Nirmala UI', 'Mangal', 'Segoe UI', cursive, sans-serif;
            color: #2f3542;
          }
          .notepad {
            background: #ffffff;
            border: 2px solid #ced6e0;
            border-radius: 6px;
            box-shadow: 3px 6px 15px rgba(0,0,0,0.12);
            padding: 40px;
            width: 540px;
            transform: rotate(-1deg);
          }
          .header {
            font-size: 30px;
            font-weight: bold;
            color: #ff4757;
            margin-bottom: 20px;
          }
          .item {
            font-size: 30px;
            line-height: 42px;
            font-weight: 500;
            color: #2ed573;
          }
          .highlight {
            color: #2f3542;
          }
        </style>
      </head>
      <body>
        <div class="notepad">
          <div class="header">Daily Kitchen Supplies (मिक्स आर्डर)</div>
          <div class="item highlight">• टमाटर (Hybrid) 12 kg</div>
          <div class="item highlight">• Potato 15 किलो</div>
          <div class="item highlight">• प्याज़ (Nashik) 8 kg</div>
          <div class="item highlight">• Banana 2 दर्जन</div>
        </div>
      </body>
      </html>
    `
  }
];

async function generateDevanagariImages() {
  console.log('Launching Puppeteer browser for Devanagari image generation...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 500, deviceScaleFactor: 2 });

  for (const t of templates) {
    console.log(`Rendering ${t.filename} (${t.title})...`);
    await page.setContent(t.html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const outPath = path.join(FIXTURES_DIR, t.filename);
    await page.screenshot({ path: outPath, type: 'png' });
    const stats = fs.statSync(outPath);
    console.log(`✓ Saved ${t.filename} (${stats.size} bytes)`);
  }

  await browser.close();
  console.log('Devanagari test images generated successfully!');
}

generateDevanagariImages().catch(err => {
  console.error('Error generating Devanagari images:', err);
  process.exit(1);
});
