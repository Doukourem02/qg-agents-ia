// Vérifie que le mode démo est filmable, selon la check-list : fenêtre d'au moins 1 400 px,
// des agents qui circulent au bout de 30 s, 3 bulles au plus, un historique pour chaque outil.
// Usage : node scripts/verif-demo.mjs [url] [dossier]   (par défaut http://localhost:3000)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? 'captures/demo';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${url}/demo`, { waitUntil: 'networkidle' });
let maxCirculent = 0, maxBulles = 0;
for (let s = 1; s <= 30; s++) {
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => ({ c: window.__qgDemo?.circulent() ?? -1, b: window.__qgDemo?.bulles() ?? -1 }));
  maxCirculent = Math.max(maxCirculent, r.c); maxBulles = Math.max(maxBulles, r.b);
}
await p.screenshot({ path: `${out}/demo-calme-30s.png` });
const sansHistorique = await p.evaluate(() => window.__qgDemo.outilsSansHistorique());
await p.goto(`${url}/demo?moment=pleine`, { waitUntil: 'networkidle' }); await p.waitForTimeout(4000);
await p.screenshot({ path: `${out}/demo-pleine-journee.png` });
const ok = maxCirculent >= 3 && maxBulles >= 1 && maxBulles <= 3 && sansHistorique.length === 0 && errs.length === 0;
console.log(`Fenêtre 1440 × 900 · agents en déplacement (max sur 30 s) : ${maxCirculent} · bulles (max) : ${maxBulles} · outils sans historique : ${sansHistorique.join(', ') || 'aucun'} · erreurs : ${errs.length}`);
console.log(ok ? 'Mode démo filmable ✔' : `À corriger ✘\n${errs.join('\n')}`);
await b.close();
process.exit(ok ? 0 : 1);
