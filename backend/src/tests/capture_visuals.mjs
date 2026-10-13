import puppeteer from 'puppeteer';
import fs from 'node:fs';

async function capture() {
  if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots', { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Desktop
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://[::1]:5173', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'screenshots/p2_auth_desktop.png' });

  // Auto-login via script evaluation directly using ApiClient token in localStorage
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessSlug: 'greenfield-fresh',
      email: 'sunil@greenfield.app',
      password: 'password123'
    })
  });
  const data = await loginRes.json();
  if (data.token) {
    await page.evaluate((tok) => {
      localStorage.setItem('orderledger_token', tok);
    }, data.token);
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    // Dashboard Desktop
    await page.screenshot({ path: 'screenshots/p2_dashboard_desktop.png' });

    // Reports View
    const reportsBtn = await page.$x("//button[contains(., 'Reports')]");
    if (reportsBtn[0]) {
      await reportsBtn[0].click();
      await new Promise(r => setTimeout(r, 800));
      await page.screenshot({ path: 'screenshots/p2_reports_desktop.png' });
    }

    // Tablet
    await page.setViewport({ width: 768, height: 1024 });
    await page.screenshot({ path: 'screenshots/p2_reports_tablet.png' });

    // Mobile
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: 'screenshots/p2_reports_mobile.png' });
  }

  console.log('Visual verification screenshots captured successfully!');
  await browser.close();
}

capture().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
