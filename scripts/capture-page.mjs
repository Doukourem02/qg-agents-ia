// Capture la page (le serveur doit tourner sur http://localhost:3000).
// Usage : node scripts/capture-page.mjs <fichier.png> [x y largeur hauteur]  (un cadrage en points d'écran, facultatif)
import { chromium } from '@playwright/test';
const [fichier, ...c] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' }); await p.waitForTimeout(3500);
const clip = c.length === 4 ? { x: +c[0], y: +c[1], width: +c[2], height: +c[3] } : undefined;
await p.screenshot({ path: fichier, clip });
if (errs.length) console.log(errs.join('\n'));
await b.close();
