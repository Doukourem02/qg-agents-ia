import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { listerDepots } from '../light/sources';
import { estFichierCle, estFichierEnv, masquer, reperer } from './cles';
import { commitsDepuis, estBinaire, fichierIgnore, lireCommit, teteDeBranche } from './github';
import {
  MAX_GRAVES_IA, messageCourt, paquetsTelegram, phraseCle, phraseNonLus, repererTexte, resumeRapport, validerRapport,
  type CommitReserve, type ProjetReserve, type ProjetValide, type RapportValide, type Reserve,
} from './rapport';
import { MARQUEUR_LISTE_COUPEE, nomCourt } from './etiquette';
import type { CommitLot, Constat, FichierLot, IssueTentative, Lot, ProjetLot, Relecture, Tentative, TrouvailleCle } from './types';

// Le passage de Léa (modèle de Light) : le serveur prépare un lot de commits pour la routine (`a-relire`), repère
// lui-même les clés poussées par erreur (constats graves, Telegram tout de suite), puis reçoit l'avis de la routine
// (`rapport`), range les constats, prévient pour le grave et avance les marque-pages. Réseau et envoi injectés.
// Un secret n'est jamais recopié : les différences sont masquées avant d'être rendues, et le serveur ne garde
// aucune différence de code (seulement les commits, les chemins et les constats).

export type DepsLea = {
  fetch: typeof fetch;
  envoyer: (texte: string) => Promise<unknown>;
  jeton: string | undefined;
  /** Échéance de la préparation du lot en ms (240 s par défaut) ; réglable pour les tests. */
  echeance?: number;
};

export const CLES_LEA = {
  /** Hash `sha` : dernier commit relu de la branche par défaut. */
  vu: (depot: string) => `lea:vu:${depot}`,
  /** Hash : `json` = le lot remis (sans différences), `fait` = id du dernier lot rendu. */
  lot: 'lea:lot',
  /** Hash id → Constat (60 jours). */
  constats: 'lea:constats',
  /** Liste des relectures (les plus récentes en tête). */
  relectures: 'lea:relectures',
  /** Hash `quand` : dernier passage complet. */
  passage: 'lea:passage',
  /** Hash id → quand : constats déjà passés par Telegram (envoyés, ou comptés dans « + N autres »). Seul suivi de l'envoi. */
  envoyes: 'lea:envoyes',
  /** Hash `json` : le dernier essai (Tentative) — complet, projets illisibles, relu en partie, rapport refusé, lot remis sans rapport. */
  tentative: 'lea:tentative',
  /** Valeur : le jeton du passage qui tient le verrou. */
  verrou: 'lea:verrou',
};

const MIN = 60_000;
const JOUR = 86_400_000;
const RESERVE_MS = 50 * MIN;
const BUDGET = 150 * 1024;
const ECHEANCE_MS = 240_000;
const VERROU_S = 280;
const GARDE_CONSTATS_MS = 60 * JOUR;
const GARDE_ENVOYES_MS = 90 * JOUR;
const RELECTURES_MAX = 200;
const CHAMP = 'json';
const FICHIER_MESSAGE = '(message du commit)';
const NOTE = {
  env: 'fichier .env : jamais envoyé (le serveur y a cherché les clés)',
  tropGros: 'différence de plus de 40 Ko : non envoyée',
  lotPlein: 'non envoyé : ce commit est trop lourd pour un seul passage',
  nonFourni: 'GitHub ne donne pas la différence de ce fichier',
  coupee: 'liste des fichiers coupée par GitHub (plus de 300)',
  renomme: 'renommé, contenu inchangé',
  supprime: 'supprimé : rien à relire',
  cle: 'non envoyé : fichier de clé',
};
/** Tout fichier dont le nom commence par « .env » (modèles .env.example compris) : sa différence n'est jamais envoyée. */
const nomEnv = (chemin: string) => chemin.slice(chemin.lastIndexOf('/') + 1).startsWith('.env');

function lire<T>(brut: string | undefined | null): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

// --- Lectures (aussi pour la page, tâche 5) ----------------------------------------------------

export async function lireMarque(kv: KV, depot: string): Promise<string | null> {
  return (await kv.hmget(CLES_LEA.vu(depot), ['sha'])).sha ?? null;
}
const poserMarque = (kv: KV, depot: string, sha: string) => kv.hset(CLES_LEA.vu(depot), 'sha', sha);

/** Les constats gardés, les plus récents d'abord. */
export async function lireConstats(kv: KV): Promise<Constat[]> {
  const tous = Object.values(await kv.hgetall(CLES_LEA.constats)).flatMap(v => lire<Constat>(v) ?? []);
  return tous.sort((a, b) => b.quand - a.quand || a.id.localeCompare(b.id));
}

/** Les relectures récentes (les plus récentes d'abord). */
export async function lireRelectures(kv: KV, n = 50): Promise<Relecture[]> {
  return (await kv.lrange(CLES_LEA.relectures, 0, n - 1)).flatMap(v => lire<Relecture>(v) ?? []);
}

/** Heure du dernier passage complet (rapport accepté, ou rien de nouveau à relire), ou null. */
export async function dernierPassage(kv: KV): Promise<number | null> {
  const v = Number((await kv.hmget(CLES_LEA.passage, ['quand'])).quand);
  return Number.isFinite(v) && v > 0 ? v : null;
}
const noterPassage = (kv: KV, now: number) => kv.hset(CLES_LEA.passage, 'quand', String(now));

/** Le dernier essai de Léa (ce qui n'a pas marché, s'il n'était pas complet), ou null. */
export async function lireTentative(kv: KV): Promise<Tentative | null> {
  return lire<Tentative>((await kv.hmget(CLES_LEA.tentative, [CHAMP]))[CHAMP]);
}

/**
 * Note le dernier essai et écrit l'état de Léa. Un essai raté est journalisé (nombres et noms courts des projets
 * seulement) quand il change de nature : un problème qui dure ne remplit pas le journal toutes les heures.
 */
async function noterEssai(
  kv: KV, now: number, issue: IssueTentative, depots: string[], etat: { statut: 'termine' | 'erreur'; tache: string }, journal?: boolean,
): Promise<void> {
  const avant = await lireTentative(kv);
  const t: Tentative = { quand: now, issue, nonLus: depots.length, depots };
  await kv.hset(CLES_LEA.tentative, CHAMP, JSON.stringify(t));
  const change = !avant || avant.issue !== issue || avant.depots.join('|') !== depots.join('|');
  await ecrireEtat(kv, { agent: 'lea', ...etat, outil: 'GH' }, now, { journal: journal ?? (issue !== 'complet' && change) });
}

/** « Vu » depuis la page : ne change que le statut (l'envoi Telegram est suivi à part, dans lea:envoyes). Faux si le constat n'existe pas. */
export async function marquerVu(kv: KV, id: string): Promise<boolean> {
  const c = lire<Constat>((await kv.hmget(CLES_LEA.constats, [id]))[id]);
  if (!c) return false;
  if (c.statut !== 'vu') await kv.hset(CLES_LEA.constats, id, JSON.stringify({ ...c, statut: 'vu' }));
  return true;
}

// --- Stockage interne ------------------------------------------------------------------------------

async function lireReserve(kv: KV): Promise<{ reserve: Reserve | null; fait: string | null }> {
  const h = await kv.hmget(CLES_LEA.lot, [CHAMP, 'fait']);
  return { reserve: lire<Reserve>(h[CHAMP]), fait: h.fait ?? null };
}

/** Ajoute les constats nouveaux (une identité déjà connue n'est jamais réécrite) et oublie ceux de plus de 60 jours. */
async function ajouterConstats(kv: KV, constats: Constat[], now: number): Promise<void> {
  if (constats.length === 0) return;
  const existants = await kv.hgetall(CLES_LEA.constats);
  for (const [id, v] of Object.entries(existants)) {
    const c = lire<Constat>(v);
    if (!c || c.quand < now - GARDE_CONSTATS_MS) await kv.hdel(CLES_LEA.constats, id);
  }
  const vus = new Set(Object.keys(existants));
  for (const c of constats) {
    if (vus.has(c.id)) continue;
    vus.add(c.id);
    await kv.hset(CLES_LEA.constats, c.id, JSON.stringify(c));
  }
}

/** Le verrou porte un jeton au hasard : un passage n'efface que son propre verrou (jamais celui d'un passage suivant, si le sien a expiré). */
async function avecVerrou<T>(kv: KV, faire: () => Promise<T>): Promise<T> {
  const jeton = crypto.randomUUID();
  if (!(await kv.setnx(CLES_LEA.verrou, jeton, VERROU_S))) throw new Refus('Léa est déjà en plein passage : réessaie dans quelques minutes', 503);
  try {
    return await faire();
  } finally {
    await (async () => { if ((await kv.get(CLES_LEA.verrou)) === jeton) await kv.del(CLES_LEA.verrou); })().catch(() => undefined);
  }
}

// --- Telegram --------------------------------------------------------------------------------------

/**
 * Envoie les constats graves ouverts pas encore passés par Telegram : toutes les clés du serveur, les graves de l'IA
 * 5 au plus — les autres sont annoncés « + N autres dans le bureau » et ne partent jamais. Un long envoi part en
 * plusieurs messages. Seul lea:envoyes est écrit (le constat lui-même n'est jamais réécrit : un « Vu » n'est pas perdu).
 * Un message qui échoue n'est pas marqué : ses constats (et ceux des messages suivants) repartiront au passage suivant.
 * Renvoie le nombre de constats envoyés.
 */
async function prevenir(kv: KV, deps: DepsLea, now: number): Promise<number> {
  const deja = await kv.hgetall(CLES_LEA.envoyes);
  for (const [id, v] of Object.entries(deja)) if (Number(v) < now - GARDE_ENVOYES_MS) await kv.hdel(CLES_LEA.envoyes, id);
  const graves = (await lireConstats(kv))
    .filter(c => c.gravite === 'grave' && c.statut === 'ouvert' && !(c.id in deja))
    .sort((a, b) => a.quand - b.quand || a.id.localeCompare(b.id));
  const serveur = graves.filter(c => c.source === 'serveur');
  const ia = graves.filter(c => c.source === 'lea');
  const montres = [...serveur, ...ia.slice(0, MAX_GRAVES_IA)];
  if (montres.length === 0) return 0;
  const annonces = ia.slice(MAX_GRAVES_IA);
  const paquets = paquetsTelegram(montres, annonces.length);
  let envoyes = 0;
  for (const [i, p] of paquets.entries()) {
    try {
      await deps.envoyer(p.texte);
    } catch {
      console.error('lea : envoi Telegram échoué, nouvel essai au prochain passage');
      return envoyes;
    }
    const ids = i === paquets.length - 1 ? [...p.ids, ...annonces.map(c => c.id)] : p.ids;
    for (const id of ids) await kv.hset(CLES_LEA.envoyes, id, String(now));
    envoyes += p.ids.length;
  }
  return envoyes;
}

// --- Préparer le lot ------------------------------------------------------------------------------

type CommitPrepare = { envoi: CommitLot; garde: CommitReserve; taille: number; constats: Constat[] };

const constatCle = (depot: string, sha: string, message: string, fichier: string, t: TrouvailleCle, now: number): Constat => ({
  // Identité : dépôt + sha + fichier + ligne + genre (jamais le secret ni son empreinte).
  id: `cle|${depot}|${sha}|${fichier}|${t.ligne ?? '-'}|${t.genre}`,
  depot, sha, message, fichier, ligne: t.ligne, gravite: 'grave', ...phraseCle(t.genre), source: 'serveur', quand: now, statut: 'ouvert',
});

/**
 * Un commit lu sur GitHub → ce qui part à la routine (différences masquées ; jamais un .env, un fichier ignoré ou de
 * plus de 40 Ko), ce que le serveur en garde, sa taille envoyée et les clés trouvées (dans tous les fichiers, ignorés
 * compris, et dans le message du commit).
 */
function preparerCommit(depot: string, c: CommitLot, now: number): CommitPrepare {
  const message = messageCourt(c.message);
  const trouvailles: { fichier: string; t: TrouvailleCle }[] = repererTexte(c.message).map(t => ({ fichier: FICHIER_MESSAGE, t }));
  const fichiers: FichierLot[] = [];
  const enPartie: string[] = [];
  const clesNonVerifiees: string[] = [];
  let taille = 0;
  for (const f of c.fichiers) {
    if (f.patch) for (const t of reperer(f.chemin, f.patch)) trouvailles.push({ fichier: f.chemin, t });
    const ajoute = f.statut === 'added' || f.statut === 'renamed';
    // Un .env ajouté au dépôt, ou un fichier renommé en .env, est en lui-même un constat grave.
    if (estFichierEnv(f.chemin) && ajoute) trouvailles.push({ fichier: f.chemin, t: { ligne: null, genre: 'fichier .env' } });
    // Un fichier de clé ajouté aussi, sauf si la clé est déjà repérée ligne par ligne, un .pem lisible sans clé privée
    // (un certificat) ou un .key : souvent une présentation Keynote (binaire) ; un .key texte n'alerte que si une clé y est trouvée.
    const parLignesSeulement = /\.key$/i.test(f.chemin) || (!!f.patch && /\.pem$/i.test(f.chemin));
    if (estFichierCle(f.chemin) && ajoute && !parLignesSeulement && !trouvailles.some(x => x.fichier === f.chemin && x.t.genre === 'clé privée')) {
      trouvailles.push({ fichier: f.chemin, t: { ligne: null, genre: 'clé privée' } });
    }
    // Rien d'ajouté à lire (renommage pur, suppression) ou binaire : pas de clé lisible possible.
    const sansAjout = !f.patch && (f.statut === 'renamed' || f.statut === 'removed');
    if (f.clesNonVerifiees && !sansAjout && !estBinaire(f.chemin)) clesNonVerifiees.push(f.chemin);
    if (fichierIgnore(f.chemin)) continue;
    const base: FichierLot = { chemin: f.chemin, ...(f.statut ? { statut: f.statut } : {}) };
    if (nomEnv(f.chemin)) {
      fichiers.push({ ...base, enPartie: 'non fourni', note: NOTE.env });
      enPartie.push(f.chemin);
    } else if (estFichierCle(f.chemin)) {
      // Jamais envoyé à la routine (le serveur y a cherché les clés) ; une suppression n'a rien à relire.
      if (f.statut === 'removed') fichiers.push({ ...base, note: NOTE.supprime });
      else { fichiers.push({ ...base, enPartie: 'non fourni', note: NOTE.cle }); enPartie.push(f.chemin); }
    } else if (f.enPartie === 'trop gros') {
      fichiers.push({ ...base, enPartie: 'trop gros', note: NOTE.tropGros });
      enPartie.push(f.chemin);
    } else if (!f.patch && f.statut === 'renamed') {
      fichiers.push({ ...base, note: NOTE.renomme });
    } else if (!f.patch && f.statut === 'removed') {
      fichiers.push({ ...base, note: NOTE.supprime });
    } else if (!f.patch) {
      fichiers.push({ ...base, enPartie: 'non fourni', note: f.chemin === MARQUEUR_LISTE_COUPEE ? NOTE.coupee : NOTE.nonFourni });
      enPartie.push(f.chemin);
    } else {
      const patch = masquer(f.patch);
      fichiers.push({ ...base, patch });
      taille += patch.length;
    }
  }
  const rienACoder = c.rienACoder || c.fichiers.length === 0 ? { rienACoder: true as const } : {};
  return {
    envoi: { sha: c.sha, message, date: c.date, fichiers, ...rienACoder },
    garde: {
      // Seulement les fichiers dont la différence part vraiment : un constat de l'IA ne peut nommer qu'eux.
      sha: c.sha, message, date: c.date, fichiers: fichiers.filter(f => f.patch).map(f => f.chemin),
      enPartie, clesNonVerifiees, cles: trouvailles.length, ...rienACoder,
    },
    taille,
    constats: trouvailles.map(({ fichier, t }) => constatCle(depot, c.sha, message, fichier, t, now)),
  };
}

/** Commit seul plus lourd que tout le lot : les différences au-delà du budget sont retirées (« trop gros »). */
function rogner(p: CommitPrepare): void {
  let cumul = 0;
  for (const f of p.envoi.fichiers) {
    if (!f.patch) continue;
    if (cumul + f.patch.length <= BUDGET) { cumul += f.patch.length; continue; }
    delete f.patch;
    f.enPartie = 'trop gros';
    f.note = NOTE.lotPlein;
    p.garde.enPartie.push(f.chemin);
    p.garde.fichiers = p.garde.fichiers.filter(chemin => chemin !== f.chemin);
  }
  p.taille = cumul;
}

/** `manque` : GitHub n'a pas répondu pour une partie de ce projet (il n'a pas été lu en entier). */
type ProjetPrepare = { envoi?: ProjetLot; garde?: ProjetReserve; constats: Constat[]; manque?: true };

/**
 * Un projet : sans marque-page → posé sur sa tête (rien d'ancien n'est relu) ; sinon ses nouveaux commits, du plus
 * ancien au plus récent, tant qu'ils tiennent dans le lot (commits entiers). GitHub qui ne répond pas → le projet
 * attend le passage suivant, marque-page intact, et `manque` le signale (jamais confondu avec « rien de nouveau »).
 * Un dépôt vide (sans branche) n'est pas une panne.
 */
async function preparerProjet(kv: KV, deps: DepsLea, jeton: string, depot: string, now: number, fin: AbortSignal, lot: { taille: number }): Promise<ProjetPrepare> {
  const constats: Constat[] = [];
  const tete = await teteDeBranche(deps.fetch, jeton, depot, fin);
  if (tete === 'vide') return { constats };
  if (!tete) return { constats, manque: true };
  const marque = await lireMarque(kv, depot);
  if (!marque) { await poserMarque(kv, depot, tete.sha); return { constats }; }
  if (tete.sha === marque) return { constats };
  const nouveaux = await commitsDepuis(deps.fetch, jeton, depot, marque, tete.branche, fin);
  if (!nouveaux) return { constats, manque: true };
  // Rien entre la marque et la tête (branche revenue en arrière, ou historique réécrit sans commit récent) : la marque suit la tête.
  if (nouveaux.shas.length === 0) { await poserMarque(kv, depot, tete.sha); return { constats }; }

  const commits: CommitPrepare[] = [];
  let manque = false;
  for (const sha of nouveaux.shas) {
    const lu = fin.aborted ? null : await lireCommit(deps.fetch, jeton, depot, sha, fin);
    if (!lu) { manque = true; break; }
    const p = preparerCommit(depot, lu, now);
    constats.push(...p.constats); // repéré même s'il attend le passage suivant : l'alerte part tout de suite
    if (lot.taille + p.taille > BUDGET) {
      if (lot.taille > 0) break; // gardé pour plus tard
      rogner(p);
    }
    lot.taille += p.taille;
    commits.push(p);
  }
  if (commits.length === 0) return { constats, ...(manque ? { manque: true as const } : {}) };
  const reecrit = nouveaux.reecrit ? { reecrit: true as const } : {};
  return {
    envoi: { depot, depuis: marque, commits: commits.map(c => c.envoi), ...reecrit },
    garde: { depot, depuis: marque, commits: commits.map(c => c.garde), ...reecrit },
    constats,
    ...(manque ? { manque: true as const } : {}),
  };
}

/**
 * `a-relire` : le lot à relire, ou `{ lot: null }` (rien de nouveau : passage complet seulement si chaque projet a pu
 * être lu ; sinon essai « projets illisibles »), ou `{ lot: null, attente: true }`
 * si un lot remis il y a moins de 50 min n'a pas encore été rendu. Passé ce délai, l'essai est noté « lot remis sans
 * rapport » et le lot est préparé à nouveau (mêmes commits, puisque les marque-pages n'ont pas bougé) sous un nouvel
 * identifiant. Un lot sans aucune différence à relire (que des fichiers ignorés, .env, clés, renommages…) n'est pas
 * remis : le serveur l'accepte lui-même, comme un rapport sans constat, et rend `{ lot: null }`.
 */
export async function preparerLot(kv: KV, deps: DepsLea, now: number): Promise<{ lot: Lot | null; attente?: true }> {
  const jeton = deps.jeton;
  if (!jeton) throw new Refus('la clé GitHub GITHUB_LECTURE_PERSO manque sur le serveur : Léa ne peut rien lire', 503);
  return avecVerrou(kv, async () => {
    const { reserve } = await lireReserve(kv);
    if (reserve && now - reserve.quand < RESERVE_MS) return { lot: null, attente: true as const };
    if (reserve) {
      // Remis il y a plus de 50 min, jamais rendu : la page le dit, et il ne vaut plus (ses commits sont redonnés ci-dessous).
      const depots = reserve.projets.map(p => nomCourt(p.depot));
      await kv.hdel(CLES_LEA.lot, CHAMP);
      await noterEssai(kv, now, 'lot remis sans rapport', depots, { statut: 'erreur', tache: 'lot remis sans rapport' });
    }

    const fin = AbortSignal.timeout(deps.echeance ?? ECHEANCE_MS);
    let depots: Awaited<ReturnType<typeof listerDepots>>;
    try { depots = await listerDepots(deps.fetch, jeton, 'perso', now, fin); } catch {
      throw new Refus('GitHub ne répond pas : nouvel essai au prochain passage', 503);
    }
    const taille = { taille: 0 };
    const envoi: ProjetLot[] = [];
    const garde: ProjetReserve[] = [];
    const constats: Constat[] = [];
    const illisibles: string[] = [];
    for (const [i, d] of depots.entries()) {
      // Coupé par l'échéance : les projets restants ne sont pas lus.
      if (fin.aborted) { illisibles.push(...depots.slice(i).map(x => nomCourt(x.complet))); break; }
      const p = await preparerProjet(kv, deps, jeton, d.complet, now, fin, taille);
      constats.push(...p.constats);
      if (p.manque) illisibles.push(nomCourt(d.complet));
      if (p.envoi && p.garde) { envoi.push(p.envoi); garde.push(p.garde); }
    }
    const nonLus = illisibles.length;
    await ajouterConstats(kv, constats, now);

    if (envoi.length === 0) {
      // « Rien de nouveau » seulement si tout a été lu : sinon pas de passage complet (Léa finira « bloquée » si ça dure).
      if (nonLus === 0) {
        await noterPassage(kv, now);
        await noterEssai(kv, now, 'complet', [], { statut: 'termine', tache: 'rien de nouveau à relire' }, false);
      } else {
        await noterEssai(kv, now, 'projets illisibles', illisibles, { statut: 'erreur', tache: phraseNonLus(nonLus, illisibles) });
      }
      await prevenir(kv, deps, now);
      return { lot: null };
    }
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const nouvelle: Reserve = { id, quand: now, projets: garde, ...(nonLus > 0 ? { nonLus, illisibles } : {}) };
    if (!envoi.some(p => p.commits.some(c => c.fichiers.some(f => f.patch)))) {
      // Aucune différence à relire : rien à demander à la routine. Le serveur accepte le lot lui-même, comme un rapport
      // sans constat qui relit chaque projet jusqu'au bout.
      const v: RapportValide = { projets: garde.map(g => ({ depot: g.depot, jusqua: g.commits[g.commits.length - 1].sha, commits: g.commits, ...(g.reecrit ? { reecrit: true as const } : {}) })), constats: [] };
      await enregistrer(kv, deps, now, nouvelle, v);
      return { lot: null };
    }
    await kv.hset(CLES_LEA.lot, CHAMP, JSON.stringify(nouvelle));
    await ecrireEtat(kv, { agent: 'lea', statut: 'au travail', tache: 'relit les pushes', outil: 'GH' }, now, { journal: false });
    await prevenir(kv, deps, now);
    return { lot: { id, quand: now, projets: envoi } };
  });
}

// --- Le rapport ------------------------------------------------------------------------------------

const unique = (l: string[]) => [...new Set(l)];

function relecture(p: ProjetValide, now: number): Relecture {
  return {
    depot: p.depot, quand: now,
    commits: p.commits.map(c => ({ sha: c.sha, message: c.message })),
    enPartie: unique(p.commits.flatMap(c => c.enPartie)),
    clesNonVerifiees: unique(p.commits.flatMap(c => c.clesNonVerifiees)),
    rienACoder: p.commits.filter(c => c.rienACoder).length,
    ...(p.reecrit ? { reecrit: true as const } : {}),
  };
}

/**
 * Range un lot relu (par la routine, ou par le serveur quand il n'y avait rien à relire) : constats, marque-pages des
 * projets donnés, relectures, Telegram, état et journal. Passage complet seulement si chaque projet a pu être lu à la
 * préparation (`nonLus`) ET si chaque projet du lot a été relu jusqu'à son dernier commit ; sinon l'essai dit
 * « projets illisibles » ou « relu en partie ».
 */
async function enregistrer(kv: KV, deps: DepsLea, now: number, reserve: Reserve, v: RapportValide): Promise<{ constats: number; envoyes: number }> {
  const constats: Constat[] = v.constats.map((a, i) => ({
    id: `ia|${reserve.id}|${String(i).padStart(2, '0')}`, ...a, source: 'lea', quand: now, statut: 'ouvert',
  }));
  await ajouterConstats(kv, constats, now);
  for (const p of v.projets) {
    await poserMarque(kv, p.depot, p.jusqua);
    await kv.lpush(CLES_LEA.relectures, JSON.stringify(relecture(p, now)));
  }
  await kv.ltrim(CLES_LEA.relectures, 0, RELECTURES_MAX - 1);
  const nonLus = reserve.nonLus ?? 0;
  const illisibles = reserve.illisibles ?? [];
  // Relu en entier : chaque projet du lot est dans le rapport, jusqu'à son dernier commit.
  const partiels = reserve.projets
    .filter(r => v.projets.find(p => p.depot === r.depot)?.jusqua !== r.commits[r.commits.length - 1].sha)
    .map(r => nomCourt(r.depot));
  if (nonLus === 0 && partiels.length === 0) await noterPassage(kv, now);

  const envoyes = await prevenir(kv, deps, now);
  const commits = v.projets.reduce((n, p) => n + p.commits.length, 0);
  const cles = v.projets.reduce((n, p) => n + p.commits.reduce((k, c) => k + c.cles, 0), 0);
  const tache = resumeRapport(commits, v.projets.length, constats.length + cles, nonLus, illisibles, partiels);
  const [issue, depots]: [IssueTentative, string[]] = nonLus > 0 ? ['projets illisibles', illisibles] : partiels.length ? ['relu en partie', partiels] : ['complet', []];
  await noterEssai(kv, now, issue, depots, { statut: 'termine', tache }, true);
  return { constats: constats.length, envoyes };
}

/**
 * `rapport` : l'avis de la routine sur le lot remis. Validation stricte (voir validerRapport) ; un lot déjà rendu ou
 * remplacé est refusé (409), sans rien écrire ; un rapport faux sur le bon lot est refusé et l'essai noté « rapport
 * refusé » (le lot reste remis : la routine peut corriger et renvoyer). Sinon, voir `enregistrer`.
 */
export async function ecrireRapport(kv: KV, corps: unknown, deps: DepsLea, now: number): Promise<{ ok: true; constats: number; envoyes: number }> {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw new Refus('rapport : un objet JSON est attendu', 400);
  const o = corps as Record<string, unknown>;
  if (typeof o.lot !== 'string' || !o.lot) throw new Refus('« lot » manquant : renvoie l\'identifiant du lot reçu', 400);
  return avecVerrou(kv, async () => {
    const { reserve, fait } = await lireReserve(kv);
    if (fait === o.lot) throw new Refus('ce rapport a déjà été reçu', 409);
    if (!reserve || reserve.id !== o.lot) throw new Refus('lot inconnu ou remplacé : relance « a-relire »', 409);
    let v: RapportValide;
    try {
      v = validerRapport(o, reserve);
    } catch (e) {
      await noterEssai(kv, now, 'rapport refusé', reserve.projets.map(p => nomCourt(p.depot)), { statut: 'erreur', tache: 'rapport refusé' }).catch(() => undefined);
      throw e;
    }
    await kv.hset(CLES_LEA.lot, 'fait', reserve.id);
    await kv.hdel(CLES_LEA.lot, CHAMP);
    const r = await enregistrer(kv, deps, now, reserve, v);
    return { ok: true as const, ...r };
  });
}

/** Les actions de la route d'agent. `corps` : le JSON reçu en POST (undefined en GET). */
export async function traiterActionLea(kv: KV, action: string, corps: unknown, deps: DepsLea, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'a-relire':
      if (corps !== undefined) throw new Refus('« a-relire » se demande en GET', 405);
      return preparerLot(kv, deps, now);
    case 'rapport':
      if (corps === undefined) throw new Refus('le rapport s\'envoie en POST', 405);
      return ecrireRapport(kv, corps, deps, now);
    default:
      throw new Refus('action inconnue', 404);
  }
}
