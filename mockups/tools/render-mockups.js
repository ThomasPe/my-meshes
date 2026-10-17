// Screenshots every NN-*.html mockup in ../ to ../NN-*.png
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');
const { launch } = require('./browser');

(async () => {
  const root = path.resolve(__dirname, '..');
  const pages = fs.readdirSync(root).filter(f => /^\d\d-.*\.html$/.test(f)).sort();
  const only = process.argv[2];
  const { server, port } = await serve(root);
  const browser = await launch();
  for (const file of pages) {
    if (only && !file.includes(only)) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    page.on('pageerror', e => console.log('[pageerror]', file, e.message));
    await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(root, file.replace(/\.html$/, '.png'));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height: 900 } });
    console.log('wrote', path.basename(out), Math.round(fs.statSync(out).size / 1024) + 'kB');
    await page.close();
  }
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
