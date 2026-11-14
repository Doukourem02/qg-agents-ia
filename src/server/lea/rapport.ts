// Léa : les morceaux purs du passage — ce que le serveur garde d'un lot remis, la validation stricte du rapport de la
// routine, les phrases des constats de clés et le message Telegram. Sans réseau, sans stockage.

import { Refus } from '../qg';
import { masquer, reperer } from './cles';
import { listeCourte } from './etiquette';
import type { Constat, GenreCle, Gravite, TrouvailleCle } from './types';

export const TITRE_TELEGRAM = '🔎 Léa · à corriger vite';
export const LIEN_BUREAU = 'https://mon-qg.vercel.app/?bureau=lea';
/** Graves de l'IA envoyés au plus par passage ; les autres restent dans le bureau (« + N autres »). */
export const MAX_GRAVES_IA = 5;
export const MAX_CONSTATS = 20;
const MAX_TEXTE = 300;
const MAX_LIGNE_TELEGRAM = 180;
/** Au-delà, le message est coupé en plusieurs (Telegram en refuse plus de 4 096 ; le titre, « + N » et le lien ne sont jamais coupés). */
export const MAX_MESSAGE_TELEGRAM = 3800;
const MAX_MESSAGE_COMMIT = 200;
const GRAVITES: readonly Gravite[] = ['grave', 'moyen', 'mineur'];

/** Ce que le serveur garde d'un commit remis à la routine : aucune différence de code, seulement de quoi valider et résumer. */
export type CommitReserve = {
  sha: string; message: string; date: number;
  /** Les fichiers de ce commit vraiment envoyés à la routine, avec leur différence (un constat de l'IA doit en nommer un). */
  fichiers: string[];
  enPartie: string[]; clesNonVerifiees: string[]; rienACoder?: true;
  /** Nombre de clés trouvées par le serveur dans ce commit (pour le résumé « K points »). */
  cles: number;
};
export type ProjetReserve = { depot: string; depuis: string; commits: CommitReserve[]; reecrit?: true };
/**
 * `nonLus` : projets que GitHub n'a pas laissé lire en entier pendant la préparation (le passage ne sera pas complet) ;
 * `illisibles` : leurs noms courts (sans le compte).
 */
export type Reserve = { id: string; quand: number; projets: ProjetReserve[]; nonLus?: number; illisibles?: string[] };

export type AvisValide = Pick<Constat, 'depot' | 'sha' | 'message' | 'fichier' | 'ligne' | 'gravite' | 'quoi' | 'conseil'>;
export type ProjetValide = { depot: string; jusqua: string; commits: CommitReserve[]; reecrit?: true };
export type RapportValide = { projets: ProjetValide[]; constats: AvisValide[] };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

// --- Textes libres (message de commit, phrases de l'IA) --------------------------------------

const ENTETE = '@@ -0,0 +1 @@';

/** Un texte libre avec chaque secret reconnu masqué (chaque ligne passée comme ligne de contexte d'un patch). */
export function masquerTexte(texte: string): string {
  const faux = [ENTETE, ...texte.split('\n').map(l => ' ' + l)].join('\n');
  return masquer(faux).split('\n').slice(1).map(l => l.slice(1)).join('\n');
}

/** Les secrets d'un texte libre (message de commit), avec leur numéro de ligne. */
export function repererTexte(texte: string): TrouvailleCle[] {
  return reperer('', [ENTETE, ...texte.split('\n').map(l => '+' + l)].join('\n'));
}

/** Première ligne du message, masquée, 200 caractères au plus. */
export const messageCourt = (message: string) => masquerTexte(message.split('\n')[0] ?? '').trim().slice(0, MAX_MESSAGE_COMMIT);

// --- Les phrases des constats du serveur ------------------------------------------------------

/** Quoi et conseil pour une clé trouvée par le serveur : le genre seulement, jamais le secret. */
export function phraseCle(genre: GenreCle): { quoi: string; conseil: string } {
  if (genre === 'fichier .env') {
    return { quoi: 'fichier .env ajouté au dépôt', conseil: 'le retirer du dépôt, l\'ajouter à .gitignore et remplacer les secrets qu\'il contient' };
  }
  if (genre === 'secret dans un .env') {
    return { quoi: 'secret poussé par erreur dans un fichier .env', conseil: 'le retirer du dépôt et le remplacer (le considérer comme compromis)' };
  }
  if (genre.startsWith('clé')) return { quoi: `${genre} poussée par erreur`, conseil: 'la retirer du dépôt et la remplacer (la considérer comme compromise)' };
  return { quoi: `${genre} poussé par erreur`, conseil: 'le retirer du dépôt et le remplacer (le considérer comme compromis)' };
}

// --- Validation du rapport ---------------------------------------------------------------------

/** Une adresse écrite par l'IA ne devient jamais un lien cliquable (Telegram, page) : « https:// » → « hxxps:// ». */
export const neutraliserLiens = (t: string) => t.replace(/\bhttp(s?):\/\//gi, 'hxxp$1://');

function texte(v: unknown, nom: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Refus(`${nom} : un texte non vide est attendu`, 422);
  const t = v.trim();
  if (t.length > MAX_TEXTE) throw new Refus(`${nom} : ${MAX_TEXTE} caractères au plus`, 422);
  return neutraliserLiens(masquerTexte(t));
}

/**
 * Validation stricte du rapport de la routine contre le lot remis (déjà reconnu par son identifiant).
 * `projets` : [{ depot, jusqua? }] — `jusqua` est un sha du lot pour ce projet (par défaut le dernier) ; un projet absent
 * garde son marque-page ; une liste vide est refusée quand le lot a des projets. Un constat doit nommer un projet du
 * rapport, un commit relu (jusqu'à `jusqua` compris) et un fichier de ce commit dont la différence a été envoyée. Les textes sont masqués (l'IA pourrait recopier un secret que le repérage ne connaît pas).
 * Forme fausse → 400 ; contenu hors du lot → 422. Les messages ne recopient jamais une valeur reçue.
 */
export function validerRapport(corps: Record<string, unknown>, reserve: Reserve): RapportValide {
  if (!Array.isArray(corps.projets)) throw new Refus('« projets » : une liste est attendue ([{ depot, jusqua? }])', 400);
  const bruts = corps.constats ?? [];
  if (!Array.isArray(bruts)) throw new Refus('« constats » : une liste est attendue', 400);
  if (bruts.length > MAX_CONSTATS) throw new Refus(`« constats » : ${MAX_CONSTATS} au plus par passage`, 422);
  if (corps.projets.length === 0 && reserve.projets.length > 0) {
    throw new Refus('« projets » est vide : donne chaque projet relu avec son « jusqua » (un projet que tu n\'as pas pu lire n\'y figure pas)', 422);
  }

  const projets: ProjetValide[] = corps.projets.map((x, i) => {
    const p = obj(x);
    const r = p && typeof p.depot === 'string' ? reserve.projets.find(q => q.depot === p.depot) : undefined;
    if (!p || !r) throw new Refus(`projets[${i}] : dépôt absent du lot`, 422);
    let fin = r.commits.length - 1;
    if (p.jusqua !== undefined && p.jusqua !== null) {
      fin = r.commits.findIndex(c => c.sha === p.jusqua);
      if (fin < 0) throw new Refus(`projets[${i}] : « jusqua » doit être un commit du lot pour ce dépôt`, 422);
    }
    return { depot: r.depot, jusqua: r.commits[fin].sha, commits: r.commits.slice(0, fin + 1), ...(r.reecrit ? { reecrit: true as const } : {}) };
  });
  if (new Set(projets.map(p => p.depot)).size !== projets.length) throw new Refus('« projets » : un dépôt donné deux fois', 422);

  const constats = bruts.map((x, i): AvisValide => {
    const nom = `constats[${i}]`;
    const a = obj(x);
    if (!a) throw new Refus(`${nom} : un objet est attendu`, 422);
    const p = projets.find(q => q.depot === a.depot);
    if (!p) {
      const dansLeLot = reserve.projets.some(q => q.depot === a.depot);
      throw new Refus(`${nom} : ${dansLeLot ? 'ce dépôt n\'est pas dans « projets » du rapport' : 'dépôt absent du lot'}`, 422);
    }
    const c = p.commits.find(k => k.sha === a.sha);
    if (!c) {
      const plusLoin = reserve.projets.find(q => q.depot === p.depot)!.commits.some(k => k.sha === a.sha);
      throw new Refus(`${nom} : ${plusLoin ? 'commit après « jusqua » (pas compté relu)' : 'commit absent du lot pour ce dépôt'}`, 422);
    }
    if (typeof a.fichier !== 'string' || !c.fichiers.includes(a.fichier)) throw new Refus(`${nom} : fichier dont la différence n'a pas été envoyée pour ce commit`, 422);
    let ligne: number | null = null;
    if (a.ligne !== undefined && a.ligne !== null) {
      if (!Number.isInteger(a.ligne) || (a.ligne as number) < 1 || (a.ligne as number) > 1_000_000) throw new Refus(`${nom} : « ligne » doit être un entier positif`, 422);
      ligne = a.ligne as number;
    }
    if (!GRAVITES.includes(a.gravite as Gravite)) throw new Refus(`${nom} : « gravite » doit être grave, moyen ou mineur`, 422);
    return {
      depot: p.depot, sha: c.sha, message: c.message, fichier: a.fichier, ligne, gravite: a.gravite as Gravite,
      quoi: texte(a.quoi, `${nom}.quoi`), conseil: texte(a.conseil, `${nom}.conseil`),
    };
  });
  return { projets, constats };
}

// --- Telegram ------------------------------------------------------------------------------------

const nettoyer = (t: string) => t.replace(/\s+/g, ' ').trim();

/** « projet · commit · fichier:ligne · phrase », 180 caractères au plus. */
export function ligneTelegram(c: Constat): string {
  const projet = c.depot.slice(c.depot.lastIndexOf('/') + 1);
  const ou = c.ligne === null ? c.fichier : `${c.fichier}:${c.ligne}`;
  const l = `• ${nettoyer(projet)} · ${c.sha.slice(0, 7)} · ${nettoyer(ou)} · ${nettoyer(c.quoi)}`;
  return l.length > MAX_LIGNE_TELEGRAM ? l.slice(0, MAX_LIGNE_TELEGRAM - 1) + '…' : l;
}

/**
 * Les messages : titre, une ligne par constat grave, le lien. Au-delà de ~3 800 caractères, la suite part dans un autre
 * message (titre « (suite) ») ; « + N autres dans le bureau » est dans le dernier. Texte brut. `ids` : les constats de
 * chaque message (marqués envoyés seulement si ce message est parti).
 */
export function paquetsTelegram(montres: Constat[], autres: number): { texte: string; ids: string[] }[] {
  const fin = [...(autres > 0 ? ['', `+ ${autres} ${autres > 1 ? 'autres' : 'autre'} dans le bureau`] : []), '', LIEN_BUREAU];
  const titre = (i: number) => (i === 0 ? TITRE_TELEGRAM : `${TITRE_TELEGRAM} (suite)`);
  const paquets: Constat[][] = [[]];
  for (const c of montres) {
    const p = paquets[paquets.length - 1];
    const taille = [titre(paquets.length - 1), '', ...[...p, c].map(ligneTelegram), ...fin].join('\n').length;
    if (p.length > 0 && taille > MAX_MESSAGE_TELEGRAM) paquets.push([c]);
    else p.push(c);
  }
  return paquets.map((p, i) => ({
    texte: [titre(i), '', ...p.map(ligneTelegram), ...(i === paquets.length - 1 ? fin : ['', LIEN_BUREAU])].join('\n'),
    ids: p.map(c => c.id),
  }));
}

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Une tâche d'état tient en 140 caractères. */
const court = (t: string) => (t.length > 140 ? t.slice(0, 139) + '…' : t);

/** « n'a pas pu lire N projet(s) : a, b ». Noms courts des projets seulement. */
export const phraseNonLus = (n: number, depots: string[] = []) => court(`n'a pas pu lire ${pl(n, 'projet')}${depots.length ? ` : ${listeCourte(depots)}` : ''}`);

/**
 * Le résumé du journal : des nombres seulement, plus les noms courts des projets illisibles, et « relu en partie »
 * quand des projets du lot n'ont pas été relus jusqu'au bout.
 */
export function resumeRapport(commits: number, projets: number, points: number, nonLus = 0, illisibles: string[] = [], partiels: string[] = []): string {
  const morceaux = [`a relu ${pl(commits, 'commit')} dans ${pl(projets, 'projet')}, ${pl(points, 'point')}`];
  if (nonLus > 0) morceaux.push(phraseNonLus(nonLus, illisibles));
  if (partiels.length) morceaux.push(`relu en partie : ${listeCourte(partiels)}`);
  return court(morceaux.join(' ; '));
}
