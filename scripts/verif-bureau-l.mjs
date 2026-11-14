// Vérifie au navigateur le bureau de L : ouvert depuis la fiche de L, ses trois colonnes, la ligne LinkedIn,
// fermé par Échap ; en format large et en format téléphone (390 × 844). Lecture seule : aucun choix de sujet,
// aucun dépôt de fichier (les envois vers /api/l/sujet et /api/l/stats sont bloqués par sécurité).
// Une seconde capture montre le panneau rempli avec des données d'exemple servies par le navigateur
// (la vraie réponse de /api/l est remplacée, rien n'est écrit sur le serveur).
// Usage : node scripts/verif-bureau-l.mjs <dossier> [adresse]  (par défaut http://localhost:3000, avec pnpm dev lancé)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:3000';
if (!out) { console.error('Usage : node scripts/verif-bureau-l.mjs <dossier> [adresse]'); process.exit(2); }
mkdirSync(out, { recursive: true });

const maintenant = Date.now();
const EXEMPLE = {
  linkedin: { connecte: true, nom: 'patron', expire: maintenant + 45 * 86_400_000 },
  proposition: {
    id: 'exemple', semaine: '2026-W46', choix: 1, rediges: [1],
    sujets: [
      { titre: 'Ce que Next.js 16 change pour un petit projet', angle: 'Trois changements concrets vus en migrant le QG, sans jargon.', format: 'texte' },
      { titre: 'Mon bureau d’agents en pixel art', angle: 'Montrer la page : qui fait quoi, et pourquoi tout passe par un accord.', format: 'capture' },
      { titre: 'Ce que j’ai appris en laissant une IA écrire mes posts', angle: 'Le bon, le moins bon, et la règle « rien ne part sans mon OK ».', format: 'carrousel' },
    ],
  },
  posts: [
    { id: 'p1', sujet: 'Mon bureau d’agents en pixel art', texte: 'J’ai construit un bureau où travaillent mes agents.\n\nChacun a sa pièce, ses outils, et rien ne part sans mon accord.', hashtags: ['#IA', '#NextJS', '#pixelart'], statut: 'en accord', quand: maintenant - 3_600_000, aVisuel: true },
    { id: 'p2', sujet: 'Pourquoi je garde la main sur chaque publication', texte: 'Un agent propose, je décide.', hashtags: ['#IA'], statut: 'pret', quand: maintenant - 3 * 86_400_000, aVisuel: false },
    { id: 'p3', sujet: 'Trois semaines avec une équipe d’agents', texte: 'Bilan honnête de trois semaines.', hashtags: ['#retour'], statut: 'publie', quand: maintenant - 9 * 86_400_000, url: 'https://www.linkedin.com/', aVisuel: false },
  ],
  bilan: {
    id: 'b1', statsId: 's1', semaine: '2026-W45', quand: maintenant - 86_400_000,
    resume: 'Une bonne semaine : le post avec capture a doublé les impressions habituelles.',
    chiffres: [
      { nom: 'Impressions', valeur: '4 812', evolution: '+38 %' }, { nom: 'Abonnés', valeur: '1 204', evolution: '+21' },
      { nom: 'Réactions', valeur: '163', evolution: '+12 %' }, { nom: 'Taux d’engagement', valeur: '3,4 %', evolution: '-0,2 pt' },
    ],
    marche: ['Les captures de la page : deux fois plus de clics.', 'Les posts publiés le mardi matin.'],
    lecteurs: ['Développeurs web (42 %)', 'Fondateurs de petites équipes'],
    ajustements: ['Plus de visuels, moins de texte seul.', 'Une question ouverte en fin de post.'],
  },
  statsEnAttente: 1,
};

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
let ok = true;
const verifier = (nom, cond) => { console.log(`${cond ? 'OK ' : 'ÉCHEC'} ${nom}`); if (!cond) ok = false; };

async function page(nom, w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  p.on('pageerror', e => errs.push(`${nom}: ${e}`)); p.on('console', m => m.type() === 'error' && errs.push(`${nom}: ${m.text()}`));
  // lecture seule : on ne choisit rien et on ne dépose rien, même par erreur
  await p.route(/\/api\/l\/(sujet|stats)/, r => { errs.push(`${nom}: envoi bloqué vers ${r.request().url()}`); return r.abort(); });
  await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
  return p;
}

/** Ouvre la fiche de L depuis l'onglet Équipe, puis le bureau de L. */
async function ouvrirBureau(p) {
  await p.getByRole('button', { name: /^Équipe/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^L Community/ }).click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /^Le bureau de L/ }).click(); await p.waitForTimeout(1500);
}

async function colonnes(p, nom) {
  for (const t of ['Sujets de la semaine', 'Posts', 'Bilan']) {
    verifier(`${nom} : colonne « ${t} »`, await p.getByRole('heading', { name: new RegExp(`^${t}`) }).count() === 1);
  }
  const ligne = await p.getByText(/^(LinkedIn connecté|LinkedIn non connecté|Pas de connexion au serveur\.)/).count();
  verifier(`${nom} : ligne LinkedIn`, ligne === 1);
  verifier(`${nom} : fiche fermée`, await p.getByPlaceholder('Confier une mission à L…').count() === 0);
}

async function tientALecran(p, nom, w, h) {
  const r = await p.getByRole('heading', { name: 'Le bureau de L' }).locator('xpath=ancestor::div[contains(@class,"qg-panel")]').boundingBox();
  verifier(`${nom} : panneau à l'écran (${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)} × ${Math.round(r.height)})`,
    r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 0.5 && r.y + r.height <= h + 0.5);
  const debord = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  verifier(`${nom} : pas de défilement horizontal`, !debord);
}

// ── format large, état réel du serveur
const large = await page('large', 1440, 810);
await ouvrirBureau(large);
await colonnes(large, 'large');
await tientALecran(large, 'large', 1440, 810);
await large.screenshot({ path: `${out}/bureau-l.png` });
await large.keyboard.press('Escape'); await large.waitForTimeout(1500);
verifier('large : fermé par Échap', await large.getByRole('heading', { name: 'Le bureau de L' }).count() === 0);

// ── format large, données d'exemple (servies par le navigateur)
await large.route(/\/api\/l$/, r => r.fulfill({ json: EXEMPLE }));
await large.route(/\/api\/l\/visuel\//, r => r.fulfill({ contentType: 'image/png', body: readFileSync(new URL('../public/reference/plan-open-space.png', import.meta.url)) }));
await ouvrirBureau(large);
await large.getByRole('button', { name: /Mon bureau d’agents en pixel art/ }).click(); await large.waitForTimeout(800);
verifier('exemple : « Choisir » absent une fois un sujet choisi', await large.getByRole('button', { name: 'Choisir' }).count() === 0);
verifier('exemple : texte du post déplié', await large.getByText(/^J’ai construit un bureau/).count() === 1);
await large.screenshot({ path: `${out}/bureau-l-exemple.png` });
await large.close();

// ── format téléphone
const tel = await page('téléphone', 390, 844);
await ouvrirBureau(tel);
await colonnes(tel, 'téléphone');
await tientALecran(tel, 'téléphone', 390, 844);
await tel.screenshot({ path: `${out}/bureau-l-telephone.png` });
await tel.route(/\/api\/l$/, r => r.fulfill({ json: EXEMPLE }));
await tel.keyboard.press('Escape'); await tel.waitForTimeout(1500);
await ouvrirBureau(tel);
await tientALecran(tel, 'téléphone exemple', 390, 844);
await tel.screenshot({ path: `${out}/bureau-l-telephone-exemple.png` });
await tel.close();

console.log(errs.length ? errs.join('\n') : 'Aucune erreur');
await b.close();
process.exit(ok && !errs.length ? 0 : 1);
