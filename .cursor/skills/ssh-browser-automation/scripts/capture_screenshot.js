/**
 * Capture page screenshot to PNG. Run from project root or skill dir.
 * Requires: npx playwright install chromium (once)
 * Usage: node scripts/capture_screenshot.js <url> [output.png]
 */

const { chromium } = require('playwright');
const url = process.argv[2] || 'https://example.com';
const out = process.argv[3] || 'screenshot.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
  console.log('OK:', out);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
