// Renders the procedural model thumbnails into ../assets/thumbs/*.jpg
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');
const { launch } = require('./browser');

(async () => {
  const root = __dirname;
  const out = path.resolve(root, '..', 'assets', 'thumbs');
  fs.mkdirSync(out, { recursive: true });
  const { server, port } = await serve(root);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const only = process.argv[2] ? `?only=${process.argv[2]}` : '';
  await page.goto(`http://127.0.0.1:${port}/thumbs.html${only}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
  const results = await page.evaluate(() => window.__results);
  for (const r of results) {
    if (r.error) { console.log('FAILED', r.name, r.error); continue; }
    const buf = Buffer.from(r.data.split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, r.name), buf);
    console.log('wrote', r.name, Math.round(buf.length / 1024) + 'kB');
  }
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
