// La présence de Stalker dans le QG : Claude Code qui travaille avec moi sur le Mac.
// Usage (crochets de Claude Code) : node scripts/presence-claude.mjs actif [projet]
//                                   node scripts/presence-claude.mjs fin
// Le projet par défaut vient du dossier courant (qg → QG, PROJET_TERRA → Terra…).
// Le laissez-passer est lu dans le trousseau du Mac (qg-bypass) : jamais affiché, jamais écrit sur le disque.
// Toujours silencieux et toujours sortie 0 : un crochet ne doit jamais bloquer Claude Code ni l'encombrer.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const URL_PRESENCE = 'https://mon-qg.vercel.app/api/agents/presence';
export const DELAI_MS = 5000;

/** Les noms des projets, comme dans le coffre Obsidian. */
const NOMS = { qg: 'QG', PROJET_TERRA: 'Terra', mon_portfolio: 'Portfolio', app_livraison: 'Livreo', 'boutique-shop': 'Boutique Shop', BotTrading: 'Trading', APP_PRO: 'App Pro' };

export function nomDuProjet(dossier) {
  const d = basename(String(dossier ?? '').replace(/\/+$/, ''));
  return Object.hasOwn(NOMS, d) ? NOMS[d] : d;
}

/** La requête pour « actif » ou « fin » ; null pour une autre commande. */
export function construireRequete(commande, projet, bypass) {
  if (commande !== 'actif' && commande !== 'fin') return null;
  const actif = commande === 'actif';
  const corps = { agent: 'stalker', actif, ...(actif && projet ? { projet } : {}) };
  return {
    url: URL_PRESENCE,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
      body: JSON.stringify(corps),
      redirect: 'manual',
    },
  };
}

function laissezPasser() {
  return execFileSync('security', ['find-generic-password', '-s', 'qg-bypass', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: DELAI_MS }).trim();
}

async function principal() {
  const [commande, projet] = process.argv.slice(2);
  if (!construireRequete(commande)) return;
  const bypass = laissezPasser();
  if (!bypass) return;
  const req = construireRequete(commande, projet || nomDuProjet(process.cwd()), bypass);
  await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(DELAI_MS) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(() => {}).finally(() => process.exit(0));
}
