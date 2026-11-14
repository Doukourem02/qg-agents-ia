// Vérifie au navigateur que tout est cliquable (onglets, outil, pièce, fiche, mission depuis la fiche) et prend des captures.
// Usage : node scripts/verif-clics.mjs [dossier]  (le serveur doit tourner sur http://localhost:3000)
import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' }); await p.waitForTimeout(3500);
for (const [nom, f] of [['Équipe', 'equipe'], ['Tâches', 'taches'], ['Calendrier', 'calendrier'], ['Cerveau', 'cerveau']]) {
  await p.getByRole('button', { name: new RegExp(`^${nom}`) }).click(); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/onglet-${f}.png` });
}
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.getByRole('button', { name: 'LinkedIn', exact: true }).first().click(); await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/outil-linkedin.png` });
await p.getByRole('button', { name: 'Mac & Outils' }).click(); await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/piece-mac.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
await p.getByRole('button', { name: /^Équipe/ }).click(); await p.waitForTimeout(400);
await p.getByRole('button', { name: /^L Community/ }).click(); await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/fiche-L.png` });
await p.getByPlaceholder('Confier une mission à L…').fill('un post sur Next.js 16'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
await p.getByRole('button', { name: /^Tâches/ }).click(); await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/taches-apres-mission.png` });
console.log(errs.length ? errs.join('\n') : 'Aucune erreur');
await b.close();
