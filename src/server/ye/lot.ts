// Le passage de Ye, première moitié : le QG prépare le lot de la semaine (`a-comparer`). Pour chaque fiche du portfolio
// liée (par son lien GitHub) à un dépôt perso qui a de nouveaux commits : la fiche (textes masqués), les commits, le
// README, les dépendances, les adresses du dépôt (preuves d'un lien de démo), l'arborescence, la dernière note de
// séance. Mêmes règles de lecture et de masquage que Paul. Et les projets absents du portfolio : un dépôt perso actif
// qu'aucune fiche ne suit (au plus 2 par passage), lu de la même façon, avec les images que Ye peut choisir.
// Rien n'est écrit ici.
import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { listerDepots } from '../light/sources';
import { messageCourt } from '../lea/rapport';
import { listeCourte } from '../lea/etiquette';
import { masquerPaul } from '../paul/secrets';
import { arbreCourt, derniereSeance, PREMIER_PASSAGE_MS } from '../paul/lot';
import {
  commitsDepuisDate, commitsDepuisMarque, fichiersDuCommit, lireArbre, lireContenu, lireTexte, teteDeBranche, type CommitBrut, type EntreeArbre,
} from '../paul/github';
import type { CommitPaul, DocLu } from '../paul/types';
import { depotDeLien, lirePortfolio, type FicheBrute, type Portfolio } from './sanity';
import {
  avecVerrou, CLES_YE, JOUR, lireDepotsFiches, lireMarque, lireMeta, lireNouvelles, lireReponsesAbsents, noterEchec, noterPassage, poserMarque,
  viderLot, type MetaLotYe, type ReserveAbsent, type ReserveFiche, type ReponseAbsent,
} from './stockage';
import type { ChampTexte, Competence, FicheLue, LotYe, ProjetAbsentYe, ProjetLotYe } from './types';

export type DepsYe = {
  fetch: typeof fetch;
  envoyer: (texte: string, boutons?: { texte: string; donnee: string }[][]) => Promise<unknown>;
  /** GITHUB_LECTURE_PERSO. */
  jeton: string | undefined;
  /** SANITY_ECRITURE_PORTFOLIO, ici seulement pour lire (les brouillons ne se voient qu'avec une clé). */
  sanity: string | undefined;
  echeance?: number;
};

/**
 * Les fiches sans lien GitHub (dépôt privé) et leur dépôt : gardés ici, dans le QG privé, jamais dans Sanity (le dataset
 * du portfolio est public). Les fiches créées par Ye s'y ajoutent dans Upstash (`ye:depots`).
 */
export const DEPOTS_FICHES: Readonly<Record<string, string>> = {
  'project-boutique-stores': 'mon-compte/boutique-shop',
  'project-qg': 'mon-compte/qg',
  'project-livreo-livraison': 'mon-compte/app_livraison',
  'project-projet-terra': 'mon-compte/PROJET_TERRA',
};
/** Jamais proposés comme projets absents : le portfolio lui-même. */
export const DEPOTS_EXCLUS: ReadonlySet<string> = new Set(['mon-compte/mon_portfolio']);
/** Projets absents remis au plus par passage (les plus récemment poussés d'abord). */
export const MAX_ABSENTS = 2;
/** « Pas maintenant » : reproposé au bout de 4 semaines. */
export const PLUS_TARD_MS = 28 * JOUR;
const DEPUIS_ABSENT_MS = 90 * JOUR;
const COMMITS_ABSENT = 30;
const MAX_IMAGES = 40;

const RESERVE_MS = 50 * 60_000;
const ECHEANCE_MS = 240_000;
const MAX_README = 16 * 1024;
const MAX_SEANCE = 6 * 1024;
const MAX_ARBRE = 200;
const DETAILS_COMMITS = 20;
export const CHAMPS_TEXTE: readonly ChampTexte[] = ['kind', 'kindEn', 'status', 'description', 'descriptionEn', 'liveUrl'];
/** Les hébergeurs où un projet se déploie : une adresse du README chez eux prouve un site en ligne. */
const HOTES_DEPLOIEMENT = /(?:^|\.)(?:vercel\.app|netlify\.app|pages\.dev|github\.io|onrender\.com)$/i;
/** Les adresses qui ne prouvent jamais un site en ligne. */
const HOTES_IGNORES = /^(?:github\.com|www\.github\.com|raw\.githubusercontent\.com|img\.shields\.io|localhost|127\.0\.0\.1)$/i;

// --- Morceaux purs ---------------------------------------------------------------------------------

/** Les noms des dépendances d'un package.json (dependencies et devDependencies) et son `homepage`. */
export function lirePackage(texte: string): { dependances: string[]; homepage: string | null } {
  try {
    const p = JSON.parse(texte) as Record<string, unknown>;
    const noms = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : []);
    return {
      dependances: [...new Set([...noms(p.dependencies), ...noms(p.devDependencies)])].slice(0, 150),
      homepage: typeof p.homepage === 'string' ? p.homepage : null,
    };
  } catch {
    return { dependances: [], homepage: null };
  }
}

/** Une adresse comparable : https, sans « / » final. */
export const normaliserUrl = (u: string) => u.trim().replace(/[).,;:!?]+$/, '').replace(/\/+$/, '');

/** Les adresses https d'un texte (README, homepage…), sans GitHub ni badges : les seules preuves d'un lien de démo. */
export function adresses(texte: string): string[] {
  const out = new Set<string>();
  for (const m of texte.matchAll(/https:\/\/[^\s<>"'`)\]]+/g)) {
    const u = normaliserUrl(m[0]);
    try { if (!HOTES_IGNORES.test(new URL(u).hostname)) out.add(u); } catch { /* adresse illisible */ }
  }
  return [...out].slice(0, 50);
}

const domaine = (h: string) => h.toLowerCase().replace(/^www\./, '');

/**
 * Les preuves d'un site en ligne : le `homepage` du package.json, le domaine du CNAME, et les adresses du README
 * chez un hébergeur de déploiement (*.vercel.app, *.netlify.app, *.pages.dev, *.github.io, *.onrender.com) ou sur le
 * domaine du homepage ou du CNAME. Un lien de documentation ou d'outil (nextjs.org, vercel.com/new) ne prouve rien.
 */
export function preuves(readme: string, homepage: string | null, cname: string | null): string[] {
  const out = new Set<string>();
  const domaines = new Set<string>();
  for (const u of homepage ? adresses(homepage) : []) { out.add(u); domaines.add(domaine(new URL(u).hostname)); }
  const c = cname?.trim().toLowerCase() ?? '';
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c)) { out.add(`https://${c}`); domaines.add(domaine(c)); }
  for (const u of adresses(readme)) {
    const h = new URL(u).hostname;
    if (HOTES_DEPLOIEMENT.test(h) || domaines.has(domaine(h))) out.add(u);
  }
  return [...out];
}

/** Une fiche lue, textes masqués ; `masques` dit lesquels ont changé (jamais réécrits). */
export function ficheLue(f: FicheBrute, competences: Competence[]): FicheLue {
  const masques: ChampTexte[] = [];
  const t: Record<ChampTexte, string> = { kind: '', kindEn: '', status: '', description: '', descriptionEn: '', liveUrl: '' };
  const brut: Record<ChampTexte, string> = { kind: f.kind, kindEn: f.kindEn, status: f.status, description: f.description, descriptionEn: f.descriptionEn, liveUrl: f.liveUrl };
  for (const c of CHAMPS_TEXTE) {
    t[c] = masquerPaul(brut[c]);
    if (t[c] !== brut[c]) masques.push(c);
  }
  const noms = new Map(competences.map(s => [s.id, s.name]));
  return {
    id: f.id, rev: f.rev, titre: masquerPaul(f.title), ...t, masques,
    technologies: f.technologies.flatMap(r => (noms.has(r._ref) ? [{ id: r._ref, name: noms.get(r._ref)! }] : [])),
  };
}

const couper = (t: string, max: number) => (t.length <= max ? { texte: t, coupe: false } : { texte: t.slice(0, max), coupe: true });

// --- Lire un dépôt (commun aux fiches et aux projets absents) ---------------------------------------

const commitsLus = (commits: CommitBrut[]): CommitPaul[] =>
  commits.map(c => ({ sha: c.sha, court: c.sha.slice(0, 7), message: messageCourt(masquerPaul(c.message)), date: c.date }));

/** Les fichiers qu'une raison peut citer : README, arborescence courte, package.json, CNAME, note de séance. */
function cheminsCitables(arbre: string[], racine: Set<string>, cheminSeance: string | null): Set<string> {
  const chemins = new Set<string>(['README.md']);
  for (const a of arbre) chemins.add(a.replace(/\/$/, ''));
  for (const x of ['package.json', 'CNAME', cheminSeance]) if (x && (racine.has(x) || x === cheminSeance)) chemins.add(x);
  return chemins;
}

/** README (masqué, coupé), arborescence, dépendances, preuves d'un site en ligne, dernière note de séance, au commit `sha`. */
async function lireContexte(f: typeof fetch, jeton: string, depot: string, sha: string, fin: AbortSignal) {
  const [readme, arbre] = await Promise.all([lireContenu(f, jeton, depot, 'README.md', sha, fin), lireArbre(f, jeton, depot, sha, fin)]);
  const enPartie: string[] = [];
  const entrees: EntreeArbre[] = arbre ?? [];
  if (!arbre) enPartie.push('arborescence (illisible)');
  const racine = new Set(entrees.filter(e => !e.dossier && !e.chemin.includes('/')).map(e => e.chemin));
  let docReadme: DocLu = { present: false };
  if (readme?.present) {
    const masque = readme.texte === null ? '' : masquerPaul(readme.texte);
    const { texte, coupe } = couper(masque, MAX_README);
    docReadme = { present: true, sha: readme.sha, contenu: texte, ...(coupe || readme.texte === null ? { enPartie: true as const } : {}) };
    if (coupe) enPartie.push('README.md');
  }
  const pkg = racine.has('package.json') ? await lireTexte(f, jeton, depot, 'package.json', sha, fin) : null;
  const { dependances, homepage } = pkg ? lirePackage(pkg) : { dependances: [], homepage: null };
  const cname = racine.has('CNAME') ? await lireTexte(f, jeton, depot, 'CNAME', sha, fin) : null;
  const urls = preuves(docReadme.present ? docReadme.contenu : '', homepage ? masquerPaul(homepage) : null, cname);
  const cheminSeance = derniereSeance(entrees);
  const texteSeance = cheminSeance ? await lireTexte(f, jeton, depot, cheminSeance, sha, fin) : null;
  const seance = cheminSeance && texteSeance !== null ? { chemin: masquerPaul(cheminSeance), contenu: couper(masquerPaul(texteSeance), MAX_SEANCE).texte } : null;
  return { docReadme, entrees, racine, dependances: dependances.map(masquerPaul), urls, seance, cheminSeance, enPartie };
}

const IMAGE = /\.(?:png|jpe?g|webp)$/i;
/** Jamais une capture : dépendances, builds, projets natifs, icônes, logos, favicons… */
const PAS_UNE_CAPTURE = /(?:^|\/)(?:node_modules|\.next|dist|build|ios|android|\.expo|\.git)(?:\/|$)|favicon|icon|logo|apple-touch|splash|sprite|avatar|badge|og-image|opengraph/i;
const CAPTURE = /captures?|screenshots?|screens?|demo|preview|apercu|aper[çc]u/i;

/**
 * Les images du dépôt que Ye peut choisir pour une fiche : d'abord celles que le README affiche, puis celles d'un
 * dossier de captures, puis les autres ; jamais une icône, un logo ou une image de build.
 */
export function imagesCandidates(entrees: EntreeArbre[], readme: string): string[] {
  const toutes = entrees.filter(e => !e.dossier && IMAGE.test(e.chemin) && !PAS_UNE_CAPTURE.test(e.chemin)).map(e => e.chemin);
  const presentes = new Set(toutes);
  const citees: string[] = [];
  for (const m of readme.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?|<img[^>]+src=["']([^"']+)["']/gi)) {
    const brut = (m[1] ?? m[2] ?? '').replace(/^\.\//, '').replace(/^\//, '');
    let c = brut;
    try { c = decodeURIComponent(brut); } catch { /* chemin tel quel */ }
    if (presentes.has(c) && !citees.includes(c)) citees.push(c);
  }
  const rang = (c: string) => (citees.includes(c) ? 0 : CAPTURE.test(c) ? 1 : 2);
  return [...toutes].sort((a, b) => rang(a) - rang(b) || (rang(a) === 0 ? citees.indexOf(a) - citees.indexOf(b) : a.localeCompare(b))).slice(0, MAX_IMAGES);
}

/** Un dépôt actif est absent du portfolio sauf s'il est suivi par une fiche, exclu, un fork, ou que j'ai répondu « Jamais » ou « Pas maintenant » (il y a moins de 4 semaines). */
export function estAbsent(complet: string, fork: boolean, suivis: Set<string>, reponses: Map<string, ReponseAbsent>, enAttente: Set<string>, now: number): boolean {
  const c = complet.toLowerCase();
  if (fork || DEPOTS_EXCLUS.has(c) || suivis.has(c) || enAttente.has(c)) return false;
  const r = reponses.get(c);
  if (r?.statut === 'jamais') return false;
  if (r?.statut === 'plus-tard' && now - r.quand < PLUS_TARD_MS) return false;
  return true;
}

async function lireAbsent(deps: DepsYe, jeton: string, depot: string, now: number, fin: AbortSignal): Promise<{ projet?: ProjetAbsentYe; reserve?: ReserveAbsent }> {
  const f = deps.fetch;
  const tete = await teteDeBranche(f, jeton, depot, fin);
  if (!tete || tete === 'vide') return {};
  const commits = await commitsDepuisDate(f, jeton, depot, tete.branche, now - DEPUIS_ABSENT_MS, fin);
  if (!commits || commits.length === 0) return {};
  const { docReadme, entrees, racine, dependances, urls, seance, cheminSeance, enPartie } = await lireContexte(f, jeton, depot, tete.sha, fin);
  const details = commitsLus(commits.slice(0, COMMITS_ABSENT));
  const arbre = arbreCourt(entrees).slice(0, MAX_ARBRE);
  const images = imagesCandidates(entrees, docReadme.present ? docReadme.contenu : '').map(masquerPaul);
  const projet: ProjetAbsentYe = {
    depot, nom: masquerPaul(depot.split('/')[1] ?? depot), branche: tete.branche, tete: tete.sha,
    commits: details, readme: docReadme, dependances, urls, arbre, images, seance, enPartie,
  };
  return {
    projet,
    reserve: {
      depot, tete: tete.sha, shas: details.map(c => c.sha), chemins: [...cheminsCitables(arbre, racine, cheminSeance)], urls, dependances,
      commits: details.map(c => ({ sha: c.sha, message: c.message })), images,
    },
  };
}

// --- Une fiche --------------------------------------------------------------------------------------

type Lu = { projet?: ProjetLotYe; reserve?: ReserveFiche; manque?: true };

async function lireProjet(
  kv: KV, deps: DepsYe, jeton: string, depot: string, fiche: FicheBrute, portfolio: Portfolio, now: number, fin: AbortSignal,
): Promise<Lu> {
  const f = deps.fetch;
  const tete = await teteDeBranche(f, jeton, depot, fin);
  if (tete === 'vide') return {};
  if (!tete) return { manque: true };
  const marque = await lireMarque(kv, depot);
  if (marque === tete.sha) return {};
  let commits: CommitBrut[] | null;
  let reecrit = false;
  if (marque) {
    const r = await commitsDepuisMarque(f, jeton, depot, marque, tete.branche, fin);
    if (r === null) return { manque: true };
    if (r === 'introuvable') { reecrit = true; commits = await commitsDepuisDate(f, jeton, depot, tete.branche, now - PREMIER_PASSAGE_MS, fin); } else commits = r.commits;
  } else commits = await commitsDepuisDate(f, jeton, depot, tete.branche, now - PREMIER_PASSAGE_MS, fin);
  if (!commits) return { manque: true };
  if (commits.length === 0) { await poserMarque(kv, depot, tete.sha); return {}; }

  const ctx = await lireContexte(f, jeton, depot, tete.sha, fin);
  const { docReadme, entrees, racine, dependances, urls, seance, cheminSeance, enPartie } = ctx;

  const details = commitsLus(commits);
  for (let i = 0; i < Math.min(DETAILS_COMMITS, details.length); i += 5) {
    const tranche = details.slice(i, Math.min(i + 5, DETAILS_COMMITS));
    const fichiers = await Promise.all(tranche.map(c => (fin.aborted ? null : fichiersDuCommit(f, jeton, depot, c.sha, fin))));
    tranche.forEach((c, k) => { const x = fichiers[k]; if (x) c.fichiers = x.slice(0, 50).map(masquerPaul); });
  }

  const lue = ficheLue(fiche, portfolio.competences);
  const projet: ProjetLotYe = {
    fiche: lue, depot, branche: tete.branche, tete: tete.sha, depuis: reecrit ? null : marque, ...(reecrit ? { reecrit: true as const } : {}),
    commits: details, readme: docReadme, dependances, urls, arbre: arbreCourt(entrees).slice(0, MAX_ARBRE),
    seance, brouillon: portfolio.brouillons.some(b => b === `drafts.${fiche.id}` || (b.startsWith('versions.') && b.endsWith(`.${fiche.id}`))), enPartie,
  };
  const chemins = cheminsCitables(projet.arbre, racine, cheminSeance);
  for (const c of details) for (const x of c.fichiers ?? []) chemins.add(x);
  return {
    projet,
    reserve: {
      ficheId: fiche.id, rev: fiche.rev, titre: lue.titre, depot, tete: tete.sha,
      actuel: { kind: lue.kind, kindEn: lue.kindEn, status: lue.status, description: lue.description, descriptionEn: lue.descriptionEn, liveUrl: lue.liveUrl, technologies: fiche.technologies },
      masques: lue.masques, shas: details.map(c => c.sha), chemins: [...chemins], urls, dependances,
      commits: details.map(c => ({ sha: c.sha, message: c.message })),
    },
  };
}

// --- Le lot ------------------------------------------------------------------------------------------

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Le résumé du journal ; un passage où des projets n'ont pas été lus le dit et ne dit jamais « rien à proposer ». */
export function resumePassage(propositions: number, questions: number, refusees: number, nonLus: string[], nouvelles = 0): string {
  const partiel = nonLus.length > 0;
  const quoi = propositions || questions || nouvelles
    ? [propositions ? pl(propositions, 'proposition') : '', nouvelles ? pl(nouvelles, 'nouvelle fiche') : '', questions ? pl(questions, 'question') : ''].filter(Boolean).join(', ')
    : partiel ? 'aucune proposition' : 'rien à proposer';
  const morceaux = [`a comparé la semaine${partiel ? ' en partie' : ''} : ${quoi}`];
  if (refusees) morceaux.push(`${refusees} ${refusees > 1 ? 'refusées' : 'refusée'} par le QG`);
  if (partiel) morceaux.push(`non lus : ${listeCourte(nonLus)}`);
  const t = morceaux.join(' ; ');
  return t.length > 140 ? t.slice(0, 139) + '…' : t;
}

/**
 * `a-comparer` : le lot de la semaine, ou `{ lot: null }` (aucune fiche liée avec de nouveaux commits et aucun projet
 * absent du portfolio : pas de message),
 * ou `{ lot: null, attente: true }` si un lot remis il y a moins de 50 min attend son rapport.
 */
export async function preparerLot(kv: KV, deps: DepsYe, now: number): Promise<{ lot: LotYe | null; attente?: true }> {
  const jeton = deps.jeton;
  if (!jeton) throw new Refus('la clé GitHub GITHUB_LECTURE_PERSO manque sur le serveur : Ye ne peut rien lire', 503);
  return avecVerrou(kv, async () => {
    const { meta } = await lireMeta(kv);
    if (meta && now - meta.quand < RESERVE_MS) return { lot: null, attente: true as const };
    if (meta) await viderLot(kv);

    const portfolio = await lirePortfolio(deps.fetch, deps.sanity);
    if (!portfolio) {
      await noterEchec(kv, { quand: now, raison: 'Sanity ne répond pas' });
      await ecrireEtat(kv, { agent: 'ye', statut: 'erreur', tache: 'n\'a pas pu lire le portfolio : Sanity ne répond pas', outil: 'Sa' }, now);
      throw new Refus('Sanity ne répond pas : nouvel essai au prochain passage', 503);
    }
    const fin = AbortSignal.timeout(deps.echeance ?? ECHEANCE_MS);
    let depots: Awaited<ReturnType<typeof listerDepots>>;
    try { depots = await listerDepots(deps.fetch, jeton, 'perso', now, fin); } catch {
      throw new Refus('GitHub ne répond pas : nouvel essai au prochain passage', 503);
    }
    const parNom = new Map(depots.map(d => [d.complet.toLowerCase(), d.complet]));
    const comptes = new Set(depots.map(d => d.complet.split('/')[0].toLowerCase()));
    // le dépôt d'une fiche : son lien GitHub, sinon celui que le QG connaît (dépôt privé, ou fiche créée par Ye)
    const connus: Record<string, string> = { ...DEPOTS_FICHES, ...(await lireDepotsFiches(kv)) };
    const suivis = new Set(Object.values(connus).map(d => d.toLowerCase()));
    let sansLien = 0;
    const projets: ProjetLotYe[] = [];
    const reserves: ReserveFiche[] = [];
    const illisibles: string[] = [];
    let suivies = 0;
    for (const fiche of portfolio.fiches) {
      const lien = depotDeLien(fiche.githubUrl) ?? connus[fiche.id] ?? null;
      if (lien) suivis.add(lien.toLowerCase());
      // Une fiche sans lien GitHub perso n'est pas suivie (et son dépôt n'est jamais nommé).
      if (!lien || !comptes.has(lien.split('/')[0].toLowerCase())) { sansLien++; continue; }
      const depot = parNom.get(lien.toLowerCase());
      if (!depot) continue; // dépôt sans poussée depuis 90 jours : rien de nouveau
      suivies++;
      if (fin.aborted) { illisibles.push(masquerPaul(fiche.title)); continue; }
      const lu = await lireProjet(kv, deps, jeton, depot, fiche, portfolio, now, fin);
      if (lu.manque) illisibles.push(masquerPaul(fiche.title));
      if (lu.projet && lu.reserve) { projets.push(lu.projet); reserves.push(lu.reserve); }
    }

    // les projets absents du portfolio : un dépôt actif qu'aucune fiche ne suit (ni refusé, ni déjà proposé)
    const reponses = await lireReponsesAbsents(kv);
    const enAttente = new Set((await lireNouvelles(kv)).filter(n => n.statut === 'attente').map(n => n.depot.toLowerCase()));
    const candidats = depots
      .filter(d => estAbsent(d.complet, d.fork === true, suivis, reponses, enAttente, now))
      .sort((a, b) => Date.parse(b.pousse) - Date.parse(a.pousse));
    const absents: ProjetAbsentYe[] = [];
    const reservesAbsents: ReserveAbsent[] = [];
    for (const d of candidats) {
      if (absents.length >= MAX_ABSENTS || fin.aborted) break;
      const lu = await lireAbsent(deps, jeton, d.complet, now, fin);
      if (lu.projet && lu.reserve) { absents.push(lu.projet); reservesAbsents.push(lu.reserve); }
    }

    if (projets.length === 0 && absents.length === 0) {
      if (illisibles.length > 0 && illisibles.length === suivies) {
        await noterEchec(kv, { quand: now, raison: `GitHub n'a pas répondu pour ${listeCourte(illisibles)}` });
        await ecrireEtat(kv, { agent: 'ye', statut: 'erreur', tache: `n'a pu lire aucun projet : ${listeCourte(illisibles)} (GitHub n'a pas répondu)`.slice(0, 140), outil: 'Sa' }, now);
        return { lot: null };
      }
      await noterPassage(kv, { quand: now, relus: 0, propositions: 0, questions: 0, refusees: 0, illisibles, sansLien });
      await ecrireEtat(kv, { agent: 'ye', statut: illisibles.length ? 'erreur' : 'termine', tache: resumePassage(0, 0, 0, illisibles), outil: 'Sa' }, now);
      return { lot: null };
    }
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const m: MetaLotYe = { id, quand: now, fiches: reserves.map(r => r.ficheId), absents: reservesAbsents.map(r => r.depot), competences: portfolio.competences, illisibles, sansLien };
    for (const r of reserves) await kv.hset(CLES_YE.lot, `p:${r.ficheId}`, JSON.stringify(r));
    for (const r of reservesAbsents) await kv.hset(CLES_YE.lot, `a:${r.depot.toLowerCase()}`, JSON.stringify(r));
    await kv.hset(CLES_YE.lot, 'meta', JSON.stringify(m));
    const tache = [projets.length ? `compare la semaine de ${pl(projets.length, 'fiche')}` : '', absents.length ? `prépare ${absents.length > 1 ? `${absents.length} projets absents` : '1 projet absent'} du portfolio` : ''].filter(Boolean).join(' ; ');
    await ecrireEtat(kv, { agent: 'ye', statut: 'au travail', tache, outil: 'Sa' }, now, { journal: false });
    return { lot: { id, quand: now, competences: portfolio.competences, projets, absents, sansLien } };
  });
}

