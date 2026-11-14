// Captures de la page au format exact de mes plans (1200 × 675 points en Retina = 2400 × 1350), avec et sans le calque du plan.
// Usage : node scripts/captures.mjs [url] [dossier]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? 'captures';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
const erreurs = [];
page.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', e => erreurs.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/calme.png` });
await page.keyboard.press('c');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/calme-calque.png` });
await page.keyboard.press('c'); // calque « pleine journée »
// la page privée suit l'heure d'Abidjan : la pleine journée se voit dans /demo
await page.goto(`${new URL(url).origin}/demo?moment=pleine`, { waitUntil: 'networkidle' });
await page.keyboard.press('c'); await page.keyboard.press('c'); // calque « pleine journée »
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/pleine-calque.png` });
await page.keyboard.press('c'); // calque caché
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/pleine.png` });

console.log(erreurs.length ? `Erreurs :\n${erreurs.join('\n')}` : 'Aucune erreur dans la console');
await browser.close();
