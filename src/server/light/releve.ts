// Le relevé du matin : versions utilisées (GitHub) contre dernières versions (npm) et fins de support (endoflife.date).
// Aucun nom de projet ne doit atteindre `etiquette` ni `texteAnonyme` : seuls `texte` (Telegram) et `nomsInterdits` les connaissent.
import type { KV } from '../memoire';
import { CATALOGUE_PROJETS } from '../l/memoire';
import { ecartMajeur, OUTILS_SUIVIS, serieMajeure, versionMin, type Version } from './versions';
import {
  dernieresVersions, finsDeSupport, lecturesCandidates, listerDepots, lireManifestes, PRODUITS_FIN_DE_SUPPORT,
  type Cycle, type Lecture, type Manifeste, type Recup,
} from './sources';

export const CLES_LIGHT = {
  releves: 'light:releves', etiquettes: 'light:etiquettes', alertes: 'light:alertes', messages: 'light:messages',
} as const;

export type Genre = 'app mobile' | 'site' | 'serveur' | 'extension' | 'projet';
export type Ligne = {
  depot: string; etiquette: string; fichier: string; genre: Genre; paquet: string; utilisee: string; derniere?: string; ecart: number;
};
export type Alerte = { cle: string; type: 'majeure' | 'retard' | 'fin'; texte: string; texteAnonyme: string };
export type Releve = {
  jour: string; quand: number; lignes: Ligne[]; alertes: Alerte[]; lectures: Lecture[];
  comptesNonLus: ('perso' | 'pro')[]; nomsInterdits: string[];
  /** Écrits par `rapport` : le résumé de Light et les lectures qu'il a choisies. */
  resume?: string; choix?: { titre: string; url: string; pourquoi: string }[];
};
export type DepsReleve = {
  fetch: Recup; jetons: { perso?: string; pro?: string };
  /** Échéance commune du relevé (par défaut 200 s, sous la limite de 300 s de Vercel). */
  echeance?: AbortSignal;
};

const JOURS_CONSERVES = 8;
const BUDGET_MS = 200_000;
const PREAVIS_FIN_MS = 90 * 86_400_000;
const PRODUIT_DE: Record<string, string> = { node: 'nodejs', next: 'nextjs', 'react-native': 'react-native' };

export const jourDe = (now: number) => new Date(now).toISOString().slice(0, 10);

function lire<T>(brut: unknown): T {
  return (typeof brut === 'string' ? JSON.parse(brut) : brut) as T;
}

export async function releveDuJour(kv: KV, jour: string): Promise<Releve | null> {
  const brut = (await kv.hgetall(CLES_LIGHT.releves))[jour];
  return brut ? lire<Releve>(brut) : null;
}

/** Le jour d'envoi d'une clé d'alerte (valeur posée : l'heure en ms, ou un jour AAAA-MM-JJ). */
function jourEnvoi(v: string | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? jourDe(n) : null;
}

const lettre = (i: number) => (i < 26 ? `projet ${String.fromCharCode(65 + i)}` : `projet ${i + 1}`);

/** « projet A », « projet B »… dans l'ordre d'arrivée ; une étiquette donnée n'est jamais réattribuée. */
export async function etiquetteDe(kv: KV, depot: string): Promise<string> {
  const connues = await kv.hgetall(CLES_LIGHT.etiquettes);
  if (connues[depot]) return connues[depot];
  const etiquette = lettre(Object.keys(connues).length);
  await kv.hset(CLES_LIGHT.etiquettes, depot, etiquette);
  return etiquette;
}

/** Mots trop courants pour être interdits seuls (un morceau de nom comme « app » bloquerait le français ordinaire). */
const MOTS_GENERIQUES = new Set([
  'app', 'apps', 'web', 'mobile', 'api', 'server', 'backend', 'frontend', 'admin', 'site', 'client', 'core', 'front', 'back',
  'extension', 'shop', 'store', 'test', 'demo', 'next', 'react', 'expo', 'node', 'packages',
  'projet', 'project', 'projects', 'driver', 'clone', 'portfolio', 'mon', 'my', 'config',
]);

/** Les morceaux d'un nom : coupé sur - _ . / @ et sur les majuscules (camelCase). */
const morceaux = (nom: string) => nom.split(/[-_./@\s]+/).flatMap(m => m.split(/(?<=[a-z0-9])(?=[A-Z])/));

/** Morceaux jamais interdits seuls : les mots génériques, les outils suivis (`@repo/typescript-config`) et la config d'un monorepo. */
const MORCEAUX_PERMIS = new Set([
  ...MOTS_GENERIQUES, ...OUTILS_SUIVIS.flatMap(o => [o, ...morceaux(o)]).map(m => m.toLowerCase()),
  'nodejs', 'eslint', 'tsconfig',
]);

/**
 * Tout ce qui ne doit jamais atteindre la page : noms complets (dépôt, dernier segment du dépôt, `name` de package.json,
 * catalogue de L) et chaque morceau de 4 lettres et plus d'un nom de dépôt ou de package.json, hors mots génériques.
 */
export function nomsInterdits(lignes: Pick<Ligne, 'depot'>[], noms: string[]): string[] {
  const tous = new Set<string>();
  const ajouter = (n: string) => {
    const m = n.trim().toLowerCase();
    if (MOTS_GENERIQUES.has(m)) return;
    if (m.length > 3 || (m.length === 3 && !MOTS_GENERIQUES.has(m))) tous.add(m);
  };
  const ajouterMorceaux = (n: string) => {
    for (const m of morceaux(n)) { const x = m.toLowerCase(); if (x.length >= 4 && !MORCEAUX_PERMIS.has(x)) tous.add(x); }
  };
  for (const n of [...lignes.map(l => l.depot), ...noms]) {
    ajouter(n);
    if (n.includes('/')) ajouter(n.split('/').pop() ?? '');
    ajouterMorceaux(n);
  }
  CATALOGUE_PROJETS.forEach(ajouter);
  return [...tous];
}

/** Suit la numérotation d'Expo (SDK), pas la sienne : ni retard ni majeure, la ligne reste sur la page. */
const SANS_RETARD = new Set(['expo-router']);

const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** L'URL décodée (pour qu'un nom encodé en %xx soit vu), ou telle quelle si elle ne se décode pas. */
export function urlDecodee(url: string): string {
  try { return decodeURIComponent(url); } catch { return url; }
}

/** Le premier nom interdit trouvé (mots entiers, sans casse ni accents), sinon null. */
export function contientNomInterdit(texte: string, interdits: string[]): string | null {
  const t = normaliser(texte);
  for (const nom of interdits) {
    const mots = normaliser(nom).split(/[^a-z0-9]+/).filter(Boolean);
    if (!mots.length) continue;
    const re = new RegExp(`(?:^|[^a-z0-9])${mots.join('[^a-z0-9]+')}(?=$|[^a-z0-9])`);
    if (re.test(t)) return nom;
  }
  return null;
}

function genreDe(paquets: string[]): Genre {
  const a = (p: string) => paquets.includes(p);
  if (a('expo') || a('react-native')) return 'app mobile';
  if (a('next')) return 'site';
  if (a('express') || a('fastify')) return 'serveur';
  if (a('wxt')) return 'extension';
  return 'projet';
}

function cycleDe(paquet: string, v: Version): string {
  return paquet === 'node' ? String(v.parties[0]) : serieMajeure(v);
}

type Lu = { depot: string; compte: 'perso' | 'pro'; manifestes: Manifeste[] };

export async function calculerReleve(kv: KV, deps: DepsReleve, now: number = Date.now()): Promise<Releve> {
  const comptesNonLus: ('perso' | 'pro')[] = [];
  const lus: Lu[] = [];
  const fin = deps.echeance ?? AbortSignal.timeout(BUDGET_MS);

  const comptes = await Promise.all((['perso', 'pro'] as const).map(async compte => {
    const jeton = deps.jetons[compte];
    // Pas de jeton = compte volontairement non suivi (choix du patron le 9 novembre 2026 pour « pro ») : rien à signaler.
    if (!jeton) return { compte, depots: [] };
    try { return { compte, depots: await listerDepots(deps.fetch, jeton, compte, now, fin) }; }
    catch { return { compte, depots: null }; }
  }));

  const aLire: { depot: string; compte: 'perso' | 'pro' }[] = [];
  for (const c of comptes) {
    if (!c.depots) { comptesNonLus.push(c.compte); continue; }
    for (const d of c.depots) aLire.push({ depot: d.complet, compte: c.compte });
  }

  // Les dépôts en parallèle ; au sein d'un dépôt, `lireManifestes` est séquentiel. Un dépôt qui échoue est sauté.
  const resultats = await Promise.all(aLire.map(async ({ depot, compte }): Promise<Lu | null> => {
    try {
      const manifestes = (await lireManifestes(deps.fetch, deps.jetons[compte]!, depot, fin)).filter(m => m.usages.length > 0);
      return { depot, compte, manifestes };
    } catch { return null; }
  }));
  for (const r of resultats) if (r) lus.push(r);

  const paquets = [...new Set(lus.flatMap(l => l.manifestes.flatMap(m => m.usages.map(u => u.paquet))))].filter(p => p !== 'node');
  const dernieres = await dernieresVersions(deps.fetch, paquets, fin);
  const derniereV = (p: string): Version | undefined => (dernieres[p] ? versionMin(dernieres[p]) ?? undefined : undefined);

  const produits = PRODUITS_FIN_DE_SUPPORT.filter(prod => lus.some(l => l.manifestes.some(m => m.usages.some(u => PRODUIT_DE[u.paquet] === prod))));
  const cycles: Cycle[] = produits.length ? await finsDeSupport(deps.fetch, produits, fin) : [];

  // Étiquettes, dans l'ordre d'arrivée (séquentiel pour rester déterministe).
  const lignes: Ligne[] = [];
  const noms: string[] = aLire.map(a => a.depot);
  for (const l of lus) {
    if (!l.manifestes.length) continue;
    const etiquette = await etiquetteDe(kv, l.depot);
    for (const m of l.manifestes) {
      if (m.nom) noms.push(m.nom);
      const genre = genreDe(m.usages.map(u => u.paquet));
      for (const u of m.usages) {
        const der = u.paquet === 'node' ? undefined : derniereV(u.paquet);
        lignes.push({
          depot: l.depot, etiquette, fichier: m.fichier, genre, paquet: u.paquet, utilisee: u.version.brut,
          ...(der ? { derniere: der.parties.join('.') } : {}),
          ecart: der ? ecartMajeur(u.version, der) : 0,
        });
      }
    }
  }
  const interdits = nomsInterdits(lignes, noms);

  // --- Alertes ---
  const alertes = new Map<string, Alerte>();
  const poser = (a: Alerte) => {
    if (alertes.has(a.cle)) return;
    // Garde-fou : un texte anonyme qui laisserait passer un nom est remplacé par une phrase neutre.
    if (contientNomInterdit(a.texteAnonyme, interdits)) a = { ...a, texteAnonyme: 'Une alerte sur un projet, à voir dans Telegram.' };
    alertes.set(a.cle, a);
  };

  const parPaquet = new Map<string, Version[]>();
  for (const l of lus) for (const m of l.manifestes) for (const u of m.usages) {
    if (u.paquet === 'node') continue;
    parPaquet.set(u.paquet, [...(parPaquet.get(u.paquet) ?? []), u.version]);
  }
  const paquetsQuiOntBouge: string[] = [];
  for (const [paquet, versions] of parPaquet) {
    const der = derniereV(paquet);
    if (!der) continue;
    const cle = (v: Version) => (v.parties[0] > 0 ? v.parties[0] : v.parties[1]);
    const plusHaute = versions.reduce((a, b) => (cle(b) > cle(a) || (cle(b) === cle(a) && b.parties[0] === 0 && a.parties[0] > 0) ? b : a));
    if (versions.some(v => ecartMajeur(v, der) >= 1)) paquetsQuiOntBouge.push(paquet);
    if (!SANS_RETARD.has(paquet) && versions.every(v => ecartMajeur(v, der) >= 1) && ecartMajeur(plusHaute, der) >= 1) {
      const serie = serieMajeure(der);
      poser({
        cle: `majeure:${paquet}:${serie}`, type: 'majeure',
        texte: `${paquet} ${serie} est sorti.`, texteAnonyme: `${paquet} ${serie} est sorti.`,
      });
    }
  }

  for (const l of lignes) {
    if (l.ecart < 2 || !l.derniere || SANS_RETARD.has(l.paquet)) continue;
    if (versionMin(l.utilisee)!.parties[0] === 0) continue; // série 0.x : l'écart reste sur la page, sans alerte
    const serieUtilisee = serieMajeure(versionMin(l.utilisee)!);
    poser({
      cle: `retard:${l.depot}:${l.fichier}:${l.paquet}:${serieUtilisee}`, type: 'retard',
      texte: `${l.depot} (${l.fichier}) : ${l.paquet} ${l.utilisee}, dernière ${l.derniere}, ${l.ecart} majeurs de retard.`,
      texteAnonyme: `${l.etiquette} : ${l.paquet} ${l.utilisee}, dernière ${l.derniere}, ${l.ecart} majeurs de retard.`,
    });
  }

  const limite = now + PREAVIS_FIN_MS;
  for (const l of lus) for (const m of l.manifestes) for (const u of m.usages) {
    const produit = PRODUIT_DE[u.paquet];
    if (!produit) continue;
    const cycle = cycles.find(c => c.produit === produit && c.cycle === cycleDe(u.paquet, u.version));
    if (!cycle?.fin || Date.parse(cycle.fin) > limite) continue;
    const passe = Date.parse(cycle.fin) <= now;
    const quand = cycle.fin === '1970-01-01' ? 'est terminé' : passe ? `s'est terminé le ${cycle.fin}` : `se termine le ${cycle.fin}`;
    const nomProduit = { nodejs: 'Node.js', nextjs: 'Next.js', 'react-native': 'React Native' }[produit] ?? produit;
    const texte = `Le support de ${nomProduit} ${cycle.cycle} ${quand}.`;
    poser({ cle: `fin:${produit}:${cycle.cycle}`, type: 'fin', texte: `${texte} Utilisé dans ${l.depot}.`, texteAnonyme: texte });
  }

  // Une clé envoyée aujourd'hui reste dans les alertes du jour (relevé refait : la page garde ce qui a été envoyé).
  const jour = jourDe(now);
  const envoyees = await kv.hgetall(CLES_LIGHT.alertes);
  const restantes = [...alertes.values()].filter(a => !(a.cle in envoyees) || jourEnvoi(envoyees[a.cle]) === jour);

  const lectures = await lecturesCandidates(deps.fetch, deps.jetons.pro ?? deps.jetons.perso, paquetsQuiOntBouge, fin);

  // Relevé refait le même jour : le résumé et les lectures déjà choisies par Light sont gardés.
  const avant = await releveDuJour(kv, jour);
  const garde = avant ? { ...(avant.resume ? { resume: avant.resume } : {}), ...(avant.choix ? { choix: avant.choix } : {}) } : {};
  const releve: Releve = { jour, quand: now, lignes, alertes: restantes, lectures, comptesNonLus, nomsInterdits: interdits, ...garde };
  await kv.hset(CLES_LIGHT.releves, jour, JSON.stringify(releve));

  // Pas de hdel dans KV : au-delà de 8 jours, on réécrit le hash avec les 8 plus récents.
  const tous = await kv.hgetall(CLES_LIGHT.releves);
  const jours = Object.keys(tous).sort();
  if (jours.length > JOURS_CONSERVES) {
    await kv.del(CLES_LIGHT.releves);
    for (const j of jours.slice(-JOURS_CONSERVES)) await kv.hset(CLES_LIGHT.releves, j, typeof tous[j] === 'string' ? tous[j] : JSON.stringify(tous[j]));
  }
  return releve;
}
