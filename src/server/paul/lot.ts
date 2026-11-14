// Le passage de Paul, première moitié : le QG prépare le lot de la semaine (`a-documenter`). Pour chaque projet actif
// avec de nouveaux commits : les commits, README.md et CLAUDE.md (contenu et sha du blob), l'arborescence, les scripts,
// les noms des variables d'environnement, la dernière note de séance. Tout passe au repérage des clés de Léa et est
// masqué avant de partir ; 60 Ko au plus par projet. Réseau injecté ; rien n'est écrit sur GitHub ici.
import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { listerDepots } from '../light/sources';
import { estFichierEnv } from '../lea/cles';
import { messageCourt } from '../lea/rapport';
import { masquerPaul as masquerTexte } from './secrets';
import { nomCourt } from '../lea/etiquette';
import { extraireBloc } from './bloc';
import {
  commitsDepuisDate, commitsDepuisMarque, fichiersDuCommit, lireArbre, lireContenu, lireTexte, teteDeBranche,
  MAX_COMMITS, type CommitBrut, type Contenu, type EntreeArbre,
} from './github';
import {
  avecVerrou, CLES_PAUL, JOUR, lireMarque, lireMeta, noterEchec, noterPassage, phraseEchec, poserMarque, resumePassage, viderLot, type MetaLot, type ReserveProjet,
} from './stockage';
import type { CommitPaul, DocLu, LotPaul, ProjetLotPaul, Scripts } from './types';

export type DepsPaul = {
  fetch: typeof fetch;
  /** L'envoi Telegram (texte et rangées de boutons). */
  envoyer: (texte: string, boutons?: { texte: string; donnee: string }[][]) => Promise<unknown>;
  /** La clé de lecture GITHUB_LECTURE_PERSO. */
  jeton: string | undefined;
  /** Échéance de la préparation du lot en ms (240 s par défaut) ; réglable pour les tests. */
  echeance?: number;
};

const MIN = 60_000;
/** Premier passage (ou marque-page introuvable) : seulement les 7 derniers jours. */
export const PREMIER_PASSAGE_MS = 7 * JOUR;
/** Un lot remis il y a moins de 50 min attend encore son rapport. */
const RESERVE_MS = 50 * MIN;
const ECHEANCE_MS = 240_000;
/** Plafond par projet, tout compris. */
export const MAX_PROJET = 60 * 1024;
/** Plafond de chaque fichier lu (README, CLAUDE.md) : au-delà, coupé et dit. */
const MAX_DOC = 24 * 1024;
const MAX_SEANCE = 8 * 1024;
const MAX_ARBRE = 300;
const MAX_SCRIPTS = 40;
const MAX_LIGNE_SCRIPT = 200;
/** Commits dont on lit la liste des fichiers (les plus récents). */
const DETAILS_COMMITS = 20;
const IGNORES = new Set(['node_modules', '.git', '.next', 'dist', 'build']);
const MODELES_ENV = ['.env.example', '.env.sample', '.env.template'];
/** Le début du message des commits écrits par le QG après un « Valider » (voir ecriture.ts). */
export const PREFIXE_COMMIT_PAUL = 'Paul (Archiviste) :';

// --- Morceaux purs ---------------------------------------------------------------------------------

/** Les noms des variables d'un modèle .env (jamais leurs valeurs). */
export function nomsVariables(texte: string): string[] {
  const noms = texte.split('\n').flatMap(l => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return m ? [m[1]] : [];
  });
  return [...new Set(noms)].slice(0, 100);
}

const ligneScript = (nom: string, commande: string) => masquerTexte(`${nom} : ${commande}`.replace(/\s+/g, ' ').trim()).slice(0, MAX_LIGNE_SCRIPT);

/** Les scripts d'un projet, lus dans package.json, pyproject.toml ou un Makefile. Null si rien de lisible. */
export function scriptsDe(source: Scripts['source'], texte: string): Scripts | null {
  let lignes: string[] = [];
  if (source === 'package.json') {
    try {
      const s = (JSON.parse(texte) as { scripts?: unknown }).scripts;
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        lignes = Object.entries(s as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => ligneScript(k, v as string));
      }
    } catch { return null; }
  } else if (source === 'pyproject.toml') {
    let dedans = false;
    for (const l of texte.split('\n')) {
      const t = l.trim();
      if (t.startsWith('[')) { dedans = t === '[project.scripts]' || t === '[tool.poetry.scripts]'; continue; }
      const m = dedans ? /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(t) : null;
      if (m) lignes.push(ligneScript(m[1], m[2].replace(/^["']|["']$/g, '')));
    }
  } else {
    for (const l of texte.split('\n')) {
      const m = /^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:(?!=)/.exec(l);
      if (m && !m[1].startsWith('.')) lignes.push(masquerTexte(m[1]));
    }
    lignes = [...new Set(lignes)];
  }
  return lignes.length ? { source, lignes: lignes.slice(0, MAX_SCRIPTS) } : null;
}

/** L'arborescence sur 2 niveaux (dossiers suivis de « / »), sans node_modules, .git, .next, dist, build. */
export function arbreCourt(entrees: EntreeArbre[]): string[] {
  return entrees
    .filter(e => { const p = e.chemin.split('/'); return p.length <= 2 && !p.some(x => IGNORES.has(x)); })
    .map(e => masquerTexte(e.dossier ? `${e.chemin}/` : e.chemin))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_ARBRE);
}

/** La dernière note de séance (`docs/seances/*.md`, la plus récente par son nom, qui commence par la date). */
export function derniereSeance(entrees: EntreeArbre[]): string | null {
  const notes = entrees.filter(e => !e.dossier && /^docs\/seances\/[^/]+\.md$/i.test(e.chemin)).map(e => e.chemin);
  return notes.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

/** Coupe un texte à `max` octets environ, sur une fin de ligne. */
function couper(texte: string, max: number): { texte: string; coupe: boolean } {
  if (texte.length <= max) return { texte, coupe: false };
  const t = texte.slice(0, max);
  const i = t.lastIndexOf('\n');
  return { texte: i > max / 2 ? t.slice(0, i + 1) : t, coupe: true };
}

/** Un fichier lu → ce qui part (contenu masqué, coupé au-delà de 24 Ko). */
function docLu(c: Contenu): DocLu {
  if (!c.present) return { present: false };
  if (c.texte === null) return { present: true, sha: c.sha, contenu: '', enPartie: true };
  const masque = masquerTexte(c.texte);
  const { texte, coupe } = couper(masque, MAX_DOC);
  // `masque` : le texte envoyé n'est pas le vrai (un secret y a été masqué) — il ne peut pas être réécrit en entier
  return { present: true, sha: c.sha, contenu: texte, ...(coupe ? { enPartie: true as const } : {}), ...(masque !== c.texte ? { masque: true as const } : {}) };
}

const taille = (p: ProjetLotPaul) => JSON.stringify(p).length;

/**
 * 60 Ko au plus par projet : on coupe d'abord la note de séance, puis l'arborescence, puis les fichiers des commits
 * (les plus anciens d'abord), puis les commits les plus anciens, puis CLAUDE.md, puis le README. Chaque coupe est dite
 * dans `enPartie`. La fonction modifie et rend le projet.
 */
export function plafonner(p: ProjetLotPaul, max = MAX_PROJET): ProjetLotPaul {
  const dire = (quoi: string) => { if (!p.enPartie.includes(quoi)) p.enPartie.push(quoi); };
  if (taille(p) <= max) return p;
  if (p.seance) {
    const exces = taille(p) - max;
    const reste = p.seance.contenu.length - exces - 100;
    if (reste > 500) p.seance = { ...p.seance, contenu: couper(p.seance.contenu, reste).texte };
    else p.seance = null;
    dire('note de séance');
  }
  while (taille(p) > max && p.arbre.length) { p.arbre = p.arbre.slice(0, Math.floor(p.arbre.length / 2)); dire('arborescence'); }
  for (let i = p.commits.length - 1; i >= 0 && taille(p) > max; i--) {
    if (p.commits[i].fichiers) { delete p.commits[i].fichiers; dire('fichiers des commits'); }
  }
  while (taille(p) > max && p.commits.length > 1) { p.commits.pop(); p.commitsCoupes = (p.commitsCoupes ?? 0) + 1; dire('commits'); }
  for (const cle of ['claude', 'readme'] as const) {
    const d = p[cle];
    if (taille(p) <= max || !d.present) continue;
    const exces = taille(p) - max;
    p[cle] = { ...d, contenu: couper(d.contenu, Math.max(0, d.contenu.length - exces - 100)).texte, enPartie: true };
    dire(cle === 'readme' ? 'README.md' : 'CLAUDE.md');
  }
  return p;
}

// --- Un projet --------------------------------------------------------------------------------------

type Lu = { projet?: ProjetLotPaul; reserve?: ReserveProjet; manque?: true };

async function detailsCommits(deps: DepsPaul, jeton: string, depot: string, commits: CommitBrut[], fin: AbortSignal): Promise<CommitPaul[]> {
  const sortie: CommitPaul[] = commits.map(c => ({ sha: c.sha, court: c.sha.slice(0, 7), message: messageCourt(masquerTexte(c.message)), date: c.date }));
  for (let i = 0; i < Math.min(DETAILS_COMMITS, sortie.length); i += 5) {
    const tranche = sortie.slice(i, Math.min(i + 5, DETAILS_COMMITS));
    const fichiers = await Promise.all(tranche.map(c => (fin.aborted ? null : fichiersDuCommit(deps.fetch, jeton, depot, c.sha, fin))));
    tranche.forEach((c, k) => { const f = fichiers[k]; if (f) c.fichiers = f.slice(0, 50).map(x => masquerTexte(x)); });
  }
  return sortie;
}

/**
 * Un projet : nouveaux commits depuis le marque-page (ou les 7 derniers jours au premier passage, ou si le marque-page
 * est introuvable). Sans nouveau commit, rien (le marque-page suit la tête). GitHub qui ne répond pas → `manque`
 * (le projet attend le passage suivant, marque-page intact).
 */
async function lireProjet(kv: KV, deps: DepsPaul, jeton: string, depot: string, now: number, fin: AbortSignal): Promise<Lu> {
  const f = deps.fetch;
  const tete = await teteDeBranche(f, jeton, depot, fin);
  if (tete === 'vide') return {};
  if (!tete) return { manque: true };
  const marque = await lireMarque(kv, depot);
  if (marque === tete.sha) return {};
  let commits: CommitBrut[] | null;
  let coupes = 0, reecrit = false;
  if (marque) {
    const r = await commitsDepuisMarque(f, jeton, depot, marque, tete.branche, fin);
    if (r === null) return { manque: true };
    if (r === 'introuvable') {
      reecrit = true;
      commits = await commitsDepuisDate(f, jeton, depot, tete.branche, now - PREMIER_PASSAGE_MS, fin);
    } else { commits = r.commits; coupes = r.coupes; }
  } else {
    commits = await commitsDepuisDate(f, jeton, depot, tete.branche, now - PREMIER_PASSAGE_MS, fin);
  }
  if (!commits) return { manque: true };
  // Les commits de Paul lui-même (après un « Valider ») ne relancent pas un passage.
  commits = commits.filter(c => !c.message.startsWith(PREFIXE_COMMIT_PAUL));
  if (commits.length === 0) { await poserMarque(kv, depot, tete.sha); return {}; }

  const [readme, claude, arbre] = await Promise.all([
    lireContenu(f, jeton, depot, 'README.md', tete.sha, fin),
    lireContenu(f, jeton, depot, 'CLAUDE.md', tete.sha, fin),
    lireArbre(f, jeton, depot, tete.sha, fin),
  ]);
  // Sans le sha du README et du CLAUDE.md, aucune proposition ne pourrait être écrite sans risque : le projet attend.
  if (!readme || !claude) return { manque: true };
  const enPartie: string[] = [];
  if (!arbre) enPartie.push('arborescence (illisible)');
  if (coupes > 0 || ((!marque || reecrit) && commits.length >= MAX_COMMITS)) enPartie.push('commits');
  const entrees = arbre ?? [];
  const racine = new Set(entrees.filter(e => !e.dossier && !e.chemin.includes('/')).map(e => e.chemin));

  const details = await detailsCommits(deps, jeton, depot, commits, fin);
  if (details.length > DETAILS_COMMITS) enPartie.push('fichiers des commits');

  let scripts: Scripts | null = null;
  const sourceScripts = (['package.json', 'pyproject.toml', 'Makefile'] as const).find(s => racine.has(s));
  if (sourceScripts) {
    const t = await lireTexte(f, jeton, depot, sourceScripts, tete.sha, fin);
    if (t !== null) scripts = scriptsDe(sourceScripts, t);
  }
  // Un modèle (.env.example…), jamais un vrai .env : seulement les noms des variables.
  const modele = MODELES_ENV.find(m => racine.has(m) && !estFichierEnv(m));
  const texteModele = modele ? await lireTexte(f, jeton, depot, modele, tete.sha, fin) : null;
  const variables = texteModele ? nomsVariables(texteModele) : [];
  const cheminSeance = derniereSeance(entrees);
  const texteSeance = cheminSeance ? await lireTexte(f, jeton, depot, cheminSeance, tete.sha, fin) : null;
  let seance: ProjetLotPaul['seance'] = null;
  if (cheminSeance && texteSeance !== null) {
    const { texte, coupe } = couper(masquerTexte(texteSeance), MAX_SEANCE);
    seance = { chemin: masquerTexte(cheminSeance), contenu: texte };
    if (coupe) enPartie.push('note de séance');
  }

  const docReadme = docLu(readme), docClaude = docLu(claude);
  const bloc = docClaude.present ? extraireBloc(docClaude.contenu) : null;
  const projet = plafonner({
    depot, branche: tete.branche, tete: tete.sha, depuis: reecrit ? null : marque, ...(reecrit ? { reecrit: true as const } : {}),
    commits: details, ...(coupes > 0 ? { commitsCoupes: coupes } : {}),
    readme: docReadme, claude: docClaude, blocActuel: typeof bloc === 'string' ? bloc : null, agents: racine.has('AGENTS.md'),
    scripts, arbre: arbreCourt(entrees), variables, seance,
    enPartie: [...enPartie, ...(docReadme.present && docReadme.enPartie ? ['README.md'] : []), ...(docClaude.present && docClaude.enPartie ? ['CLAUDE.md'] : [])],
  });
  const chemins = new Set<string>(['README.md', 'CLAUDE.md']);
  for (const a of projet.arbre) chemins.add(a.replace(/\/$/, ''));
  for (const c of projet.commits) for (const x of c.fichiers ?? []) chemins.add(x);
  for (const x of [sourceScripts, modele, cheminSeance]) if (x) chemins.add(x);
  if (projet.agents) chemins.add('AGENTS.md');
  return {
    projet,
    reserve: {
      depot, branche: tete.branche, tete: tete.sha, shas: projet.commits.map(c => c.sha), chemins: [...chemins],
      readme: projet.readme, claude: projet.claude, arbreLu: arbre !== null,
      racine: entrees.filter(e => !e.chemin.includes('/')).map(e => e.chemin),
    },
  };
}

// --- Le lot ------------------------------------------------------------------------------------------

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * `a-documenter` : le lot de la semaine, ou `{ lot: null }` (aucun projet avec de nouveaux commits : passage complet,
 * pas de message), ou `{ lot: null, attente: true }` si un lot remis il y a moins de 50 min n'a pas encore été rendu.
 * Passé ce délai, l'ancien lot ne vaut plus et un nouveau est préparé (mêmes commits : les marque-pages n'ont pas bougé).
 */
export async function preparerLot(kv: KV, deps: DepsPaul, now: number): Promise<{ lot: LotPaul | null; attente?: true }> {
  const jeton = deps.jeton;
  if (!jeton) throw new Refus('la clé GitHub GITHUB_LECTURE_PERSO manque sur le serveur : Paul ne peut rien lire', 503);
  return avecVerrou(kv, async () => {
    const { meta } = await lireMeta(kv);
    if (meta && now - meta.quand < RESERVE_MS) return { lot: null, attente: true as const };
    if (meta) await viderLot(kv);

    const fin = AbortSignal.timeout(deps.echeance ?? ECHEANCE_MS);
    let depots: Awaited<ReturnType<typeof listerDepots>>;
    try { depots = await listerDepots(deps.fetch, jeton, 'perso', now, fin); } catch {
      throw new Refus('GitHub ne répond pas : nouvel essai au prochain passage', 503);
    }
    const projets: ProjetLotPaul[] = [];
    const reserves: ReserveProjet[] = [];
    const illisibles: string[] = [];
    for (const [i, d] of depots.entries()) {
      if (fin.aborted) { illisibles.push(...depots.slice(i).map(x => nomCourt(x.complet))); break; }
      const lu = await lireProjet(kv, deps, jeton, d.complet, now, fin);
      if (lu.manque) illisibles.push(nomCourt(d.complet));
      if (lu.projet && lu.reserve) { projets.push(lu.projet); reserves.push(lu.reserve); }
    }

    if (projets.length === 0 && illisibles.length > 0 && illisibles.length === depots.length) {
      // Aucun projet lu : un passage raté, pas « en partie » (le créneau du jeudi reste raté, la page dit pourquoi).
      await noterEchec(kv, { quand: now, illisibles });
      await ecrireEtat(kv, { agent: 'paul', statut: 'erreur', tache: phraseEchec(illisibles), outil: 'GH' }, now);
      return { lot: null };
    }
    if (projets.length === 0) {
      // Rien à documenter : pas de message. Passage complet seulement si tout a pu être lu.
      // Des projets illisibles (d'autres lus sans nouveauté) : un passage incomplet, dit comme tel (jamais « rien à proposer »).
      await noterPassage(kv, { quand: now, relus: 0, propositions: 0, refusees: 0, illisibles });
      await ecrireEtat(kv, { agent: 'paul', statut: illisibles.length ? 'erreur' : 'termine', tache: resumePassage(0, 0, 0, illisibles), outil: 'GH' }, now);
      return { lot: null };
    }
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const m: MetaLot = { id, quand: now, depots: reserves.map(r => r.depot), illisibles };
    for (const r of reserves) await kv.hset(CLES_PAUL.lot, `p:${r.depot}`, JSON.stringify(r));
    await kv.hset(CLES_PAUL.lot, 'meta', JSON.stringify(m));
    await ecrireEtat(kv, { agent: 'paul', statut: 'au travail', tache: `relit la semaine de ${pl(projets.length, 'projet')}`, outil: 'GH' }, now, { journal: false });
    return { lot: { id, quand: now, projets } };
  });
}
