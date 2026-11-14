// Captures du QG dans plusieurs formats d'écran (large et haut), pour vérifier les finitions.
// Usage : node scripts/formats.mjs [url] [dossier]   (par défaut http://localhost:3000 et captures/formats)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? 'captures/formats';
mkdirSync(out, { recursive: true });
const FORMATS = [
  ['16-9', 1200, 675, 2], ['16-10', 1440, 900, 2], ['ultra-large', 2560, 1080, 1],
  ['tablette-haut', 820, 1180, 2], ['telephone', 390, 844, 3],
];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [nom, w, h, dpr] of FORMATS) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: nom !== '16-9' && w < 900 });
  p.on('pageerror', e => errs.push(`${nom}: ${e}`)); p.on('console', m => m.type() === 'error' && errs.push(`${nom}: ${m.text()}`));
  await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500);
  await p.screenshot({ path: `${out}/${nom}.png` });
  if (w < 900) {
    await p.getByRole('button', { name: /^Équipe/ }).click(); await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${nom}-equipe.png` });
    await p.getByRole('button', { name: /^L Community/ }).click(); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/${nom}-fiche.png` });
  }
  await p.close();
}
console.log(errs.length ? errs.join('\n') : 'Aucune erreur');
await b.close();
