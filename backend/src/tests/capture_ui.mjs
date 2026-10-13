import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function captureScreenshots() {
  const screenshotsDir = 'D:/Atkind work/orderledger/screenshots';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Test 1: Desktop Viewport (1440x900)
  console.log('Testing Desktop Viewport (1440x900)...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1200));


  // Take screenshot of Login/Register screen
  await page.screenshot({ path: path.join(screenshotsDir, '01_desktop_login.png') });
  console.log('✅ Captured 01_desktop_login.png');

  // Set email and password values cleanly
  await page.evaluate(() => {
    const emailEl = document.querySelector('input[type="email"]');
    const passEl = document.querySelector('input[type="password"]');
    if (emailEl) {
      emailEl.value = 'sunil@greenfield.app';
      emailEl.dispatchEvent(new Event('input', { bubbles: true }));
      emailEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (passEl) {
      passEl.value = 'password123';
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await page.click('button[type="submit"]');



  // Wait for dashboard to load
  await page.waitForSelector('h2');
  await new Promise(r => setTimeout(r, 1500));

  await page.screenshot({ path: path.join(screenshotsDir, '02_desktop_dashboard.png') });
  console.log('✅ Captured 02_desktop_dashboard.png');

  // Navigate to Orders
  const ordersBtn = await page.waitForSelector('button ::-p-text(Orders)');
  if (ordersBtn) await ordersBtn.click();
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotsDir, '03_desktop_orders.png') });
  console.log('✅ Captured 03_desktop_orders.png');

  // Open Order Details Modal
  const eyeBtn = await page.$('button[title="View details"]');
  if (eyeBtn) {
    await eyeBtn.click();
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(screenshotsDir, '04_desktop_order_timeline.png') });
    console.log('✅ Captured 04_desktop_order_timeline.png');
    // Close modal
    const closeBtn = await page.$('button ::-p-text(Close)');
    if (closeBtn) await closeBtn.click();
  }

  // Navigate to Customers
  const custBtn = await page.waitForSelector('button ::-p-text(Customers)');
  if (custBtn) await custBtn.click();
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotsDir, '05_desktop_customers.png') });
  console.log('✅ Captured 05_desktop_customers.png');

  // Test 2: Tablet Viewport (768x1024 - iPad)
  console.log('Testing Tablet Viewport (768x1024)...');
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(screenshotsDir, '06_tablet_customers.png') });
  console.log('✅ Captured 06_tablet_customers.png');

  // Test 3: Mobile Viewport (390x844 - iPhone 14)
  console.log('Testing Mobile Viewport (390x844)...');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: path.join(screenshotsDir, '07_mobile_dashboard_bottom_nav.png') });
  console.log('✅ Captured 07_mobile_dashboard_bottom_nav.png');

  // Navigate to Orders via mobile navigation
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('nav button'));
    const ordersBtn = btns.find(b => b.textContent && b.textContent.includes('Orders'));
    if (ordersBtn) ordersBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));


  await page.screenshot({ path: path.join(screenshotsDir, '08_mobile_orders_list.png') });
  console.log('✅ Captured 08_mobile_orders_list.png');


  await browser.close();
  console.log('\n🎉 ALL RESPONSIVE & CASHEW-STYLE UI SCREENSHOTS CAPTURED SUCCESSFULLY!');
}

captureScreenshots().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
