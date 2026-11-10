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

// 5 Distinct realistic visual conditions specified by user:
// 1. Actual handwritten note (cursive script & wholesale shorthands: tom, pot, doz)
// 2. Photo taken at an angle (perspective tilt/skew & clustered list)
// 3. Poor/uneven lighting or slight blur (low-contrast ink smudge)
// 4. Note with crossed-out/struck-through items and scribbled correction arrows
// 5. Messy list on a single line / clustered stream without clean line breaks

const templates = [
  {
    filename: 'condition1_handwritten.png',
    title: 'Condition 1: Realistic Handwritten Note',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #fdfbf7;
            font-family: 'Caveat', cursive, sans-serif;
            color: #1a237e;
          }
          .notepad {
            background: #fffef8;
            border: 1px solid #e0dacf;
            border-radius: 4px;
            box-shadow: 2px 4px 12px rgba(0,0,0,0.08);
            padding: 40px 50px;
            width: 500px;
            background-image: repeating-linear-gradient(#fffef8 0px, #fffef8 38px, #e8e2d5 39px, #fffef8 40px);
          }
          .header {
            font-size: 32px;
            font-weight: 700;
            color: #b71c1c;
            margin-bottom: 25px;
            text-decoration: underline;
          }
          .item {
            font-size: 30px;
            line-height: 40px;
            font-weight: 600;
            color: #0d47a1;
          }
        </style>
      </head>
      <body>
        <div class="notepad">
          <div class="header">Taj Hotel Kitchen Order - Urgent</div>
          <div class="item">• Tomato (Hybrid) 25 kg</div>
          <div class="item">• Potato 15 kg</div>
          <div class="item">• Onion 10 kg</div>
          <div class="item">• Banana 3 dozen</div>
        </div>
      </body>
      </html>
    `
  },
  {
    filename: 'condition2_angled.png',
    title: 'Condition 2: Photo Taken at an Angle with Perspective Skew',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Kalam:wght@700&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 40px;
            background: #2b2b2b;
            font-family: 'Kalam', cursive, sans-serif;
            perspective: 800px;
          }
          .sheet {
            background: #fafafa;
            width: 480px;
            padding: 45px;
            border-radius: 6px;
            box-shadow: 10px 20px 30px rgba(0,0,0,0.4);
            transform: rotate(-6deg) rotateX(15deg) skewX(-4deg);
            background-image: radial-gradient(circle at 80% 20%, rgba(255,255,255,0.8), rgba(240,240,240,0.9));
          }
          h2 {
            font-size: 28px;
            color: #333;
            margin: 0 0 15px 0;
          }
          .line {
            font-size: 26px;
            line-height: 38px;
            color: #111;
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h2>Morning Dispatch (Store 4)</h2>
          <div class="line">Tomato Country 12 kg</div>
          <div class="line">Potato 30 kg</div>
          <div class="line">Onion 20 kg</div>
        </div>
      </body>
      </html>
    `
  },
  {
    filename: 'condition3_blurry_smudge.png',
    title: 'Condition 3: Uneven Lighting and Slight Blur/Smudge',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #4a4031;
            font-family: 'Patrick Hand', cursive;
          }
          .paper {
            background: linear-gradient(135deg, #eee8d5 0%, #b58900 120%);
            width: 500px;
            padding: 40px;
            border-radius: 4px;
            box-shadow: 4px 6px 15px rgba(0,0,0,0.3);
            filter: blur(0.8px);
          }
          h3 {
            font-size: 32px;
            margin-top: 0;
            color: #268bd2;
          }
          .item {
            font-size: 28px;
            line-height: 36px;
            color: #073642;
          }
          .shadow-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(45deg, rgba(0,0,0,0.25) 0%, transparent 60%);
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div class="paper" style="position: relative;">
          <div class="shadow-overlay"></div>
          <h3>Cafe Daily Order</h3>
          <div class="item">1. Banana 5 dozen</div>
          <div class="item">2. Onion 8 kg</div>
          <div class="item">3. Potato 12 kg</div>
        </div>
      </body>
      </html>
    `
  },
  {
    filename: 'condition4_crossed_out.png',
    title: 'Condition 4: Note with Crossed-Out Items and Correction Scribble',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #eee;
            font-family: 'Caveat', cursive;
          }
          .box {
            background: #fff;
            width: 520px;
            padding: 35px;
            border: 2px dashed #999;
          }
          .header {
            font-size: 32px;
            color: #222;
            margin-bottom: 20px;
          }
          .item {
            font-size: 32px;
            line-height: 42px;
          }
          .strike {
            text-decoration: line-through;
            color: #d32f2f;
            opacity: 0.6;
          }
          .correction {
            color: #2e7d32;
            font-weight: bold;
            margin-left: 10px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="header">Order Note - Chef Anand</div>
          <div class="item"><span class="strike">Tomato 10 kg</span> <span class="correction">→ Tomato (Hybrid) 20 kg</span></div>
          <div class="item"><span class="strike">Cabbage 5 kg (CANCELLED)</span></div>
          <div class="item">Potato 15 kg</div>
          <div class="item">Banana 2 dozen</div>
        </div>
      </body>
      </html>
    `
  },
  {
    filename: 'condition5_clustered_stream.png',
    title: 'Condition 5: Messy Single-Line Stream Without Line Breaks',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Indie+Flower&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 30px;
            background: #dcdde1;
            font-family: 'Indie Flower', cursive;
          }
          .ticket {
            background: #fff;
            width: 560px;
            padding: 30px;
            border: 1px solid #718093;
            box-shadow: 3px 5px 12px rgba(0,0,0,0.15);
          }
          .memo {
            font-size: 28px;
            line-height: 40px;
            color: #2f3640;
            word-wrap: break-word;
          }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div style="font-size: 24px; color: #718093; margin-bottom: 10px;">Quick Scribble Slip</div>
          <div class="memo">
            need today urgently: tomato hybrid 18kg and potato 22kg, onion 14kg also banana 6dz send fast
          </div>
        </div>
      </body>
      </html>
    `
  }
];

async function generateImages() {
  console.log('Launching Puppeteer browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 500, deviceScaleFactor: 2 });

  for (const t of templates) {
    console.log(`Generating ${t.filename} (${t.title})...`);
    await page.setContent(t.html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const outPath = path.join(FIXTURES_DIR, t.filename);
    await page.screenshot({ path: outPath, type: 'png' });
    const stats = fs.statSync(outPath);
    console.log(`✓ Saved ${t.filename} (${stats.size} bytes)`);
  }

  await browser.close();
  console.log('All 5 test images generated successfully!');
}

generateImages().catch(err => {
  console.error('Error generating test images:', err);
  process.exit(1);
});
