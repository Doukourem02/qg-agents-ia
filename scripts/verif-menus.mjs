// Vérifie au navigateur que les menus se déplacent à la souris, gardent leur place et que les clics marchent toujours.
// Usage : node scripts/verif-menus.mjs <dossier>  (le serveur doit tourner sur http://localhost:3000)
import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
for (const n of ['Telegram', 'Gmail', 'Notion', 'Spotify']) console.log(n, await p.getByRole('button', { name: n, exact: true }).count());
await p.screenshot({ path: `${out}/avant.png` });
// glisser la barre des outils en saisissant un logo (GitHub) : le menu bouge, aucun panneau ne s'ouvre
const gh = p.getByRole('button', { name: 'GitHub', exact: true });
const r = await gh.boundingBox();
await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down();
for (let i = 1; i <= 10; i++) await p.mouse.move(r.x + r.width / 2 - 30 * i, r.y + r.height / 2 + 25 * i);
await p.mouse.up(); await p.waitForTimeout(400);
const r2 = await gh.boundingBox();
console.log('déplacé de', Math.round(r2.x - r.x), Math.round(r2.y - r.y));
console.log('panneau ouvert après glissé ?', await p.getByText('Dernières utilisations').count());
// glisser la barre de mission par son étiquette Kuroro
const k = p.getByText('Kuroro connaît tout le monde'); const rk = await k.boundingBox();
await p.mouse.move(rk.x + 10, rk.y + 3); await p.mouse.down(); await p.mouse.move(rk.x + 200, rk.y - 150, { steps: 8 }); await p.mouse.up();
const rk2 = await k.boundingBox(); console.log('barre de mission déplacée de', Math.round(rk2.x - rk.x), Math.round(rk2.y - rk.y));
// glisser le plan du bureau tout au bout : il doit rester visible
const pl = p.getByText('PLAN DU BUREAU'); const rp = await pl.boundingBox();
await p.mouse.move(rp.x + 5, rp.y + 3); await p.mouse.down(); await p.mouse.move(rp.x + 3000, rp.y + 3000, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(300);
const rp2 = await p.locator('text=PLAN DU BUREAU').boundingBox(); console.log('plan visible ?', rp2.x < 1440 && rp2.y < 810);
await p.screenshot({ path: `${out}/apres-glisse.png` });
// un simple clic sur un logo ouvre toujours son panneau
await p.getByRole('button', { name: 'Spotify', exact: true }).click(); await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/clic-spotify.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
// la place est retenue après rechargement
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
const r3 = await p.getByRole('button', { name: 'GitHub', exact: true }).boundingBox();
console.log('retenu après rechargement ?', Math.abs(r3.x - r2.x) < 2 && Math.abs(r3.y - r2.y) < 2);
// remettre en place
await p.getByRole('button', { name: /Menus : déplaçables/ }).click(); await p.waitForTimeout(300);
const r4 = await p.getByRole('button', { name: 'GitHub', exact: true }).boundingBox();
console.log('remis en place ?', Math.abs(r4.x - r.x) < 2 && Math.abs(r4.y - r.y) < 2);
console.log(errs.length ? errs.join('\n') : 'Aucune erreur');
await b.close();
