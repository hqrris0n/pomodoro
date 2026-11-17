// Take a screenshot of a running page, for reviewing visual work.
//
//   npm run shot -- <url> <out.png> [width] [height] [waitMs]
//
// Example (with `npx vite --port 5201` running):
//   npm run shot -- http://localhost:5201/#demo/BrewScene /tmp/scene.png 390 844
import { chromium } from '@playwright/test';

const [url, out, width = '1280', height = '800', waitMs = '600'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: npm run shot -- <url> <out.png> [width] [height] [waitMs]');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on('pageerror', (error) => console.error('page error:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console error:', message.text());
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
