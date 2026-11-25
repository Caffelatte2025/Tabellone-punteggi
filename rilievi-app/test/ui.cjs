const { chromium } = require('playwright');
(async () => {
  const G = process.argv[2], out = process.argv[3];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1340, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => { errs.push('DIALOG: ' + d.message()); d.accept(); });
  await p.goto('http://localhost:4173/');
  await p.waitForTimeout(800);
  for (const n of ['st1', 'st2', 'st3']) {
    await p.setInputFiles('#fileInput', `${G}/${n}.e57`);
    await p.waitForFunction((k) => { const s = window.__rilievi.stations; return s.length >= k && document.querySelector('#busy').hidden; }, n === 'st1' ? 1 : +n[2], { timeout: 120000 });
    await p.waitForTimeout(500);
    if (n !== 'st1') {
      await p.waitForFunction(() => { const s = window.__rilievi.stations.at(-1); return s.rms != null && document.querySelector('#busy').hidden; }, null, { timeout: 120000 });
      console.log(n, await p.textContent('#alignStatus'));
      if (n === 'st3') await p.screenshot({ path: `${out}/align.png` });
      await p.click('#btnAccept');
    }
  }
  await p.click('#btnFrame');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/plan.png` });
  await p.click('#segView button[data-v="3d"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/3d.png` });
  console.log('stazioni', JSON.stringify(await p.evaluate(() => window.__rilievi.stations.map((s) => [s.name, s.status, s.rms && +(s.rms*1000).toFixed(1)]))));
  // ricarica: persistenza
  await p.reload(); await p.waitForTimeout(2500);
  console.log('dopo reload', await p.evaluate(() => window.__rilievi.stations.length));
  console.log('errori', errs);
  await b.close();
})();
