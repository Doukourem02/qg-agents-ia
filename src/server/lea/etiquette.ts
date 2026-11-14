import type { Constat, Relecture, Tentative } from './types';

// Ce que la page et le serveur partagent pour Léa : aucun import de valeur (la page ne doit embarquer aucun code serveur).
// Seulement des types, des constantes et des fonctions pures.

/**
 * Ce que la page affiche pour Léa. `absente` : aucun passage complet depuis 3 h (ou jamais). `tentative` : comment
 * s'est fini son dernier essai (ce qui n'a pas marché, s'il n'était pas complet).
 */
export type VueLea = { passage: number | null; absente: boolean; constats: Constat[]; relectures: Relecture[]; tentative: Tentative | null };

/** Sans passage complet depuis 3 h, Léa est comptée bloquée. */
export const ABSENTE_APRES = 3 * 3_600_000;

export const absente = (passage: number | null, now: number): boolean => passage === null || now - passage >= ABSENTE_APRES;

/** Les constats graves que je n'ai pas encore marqués « Vu ». */
export const gravesOuverts = (constats: Constat[]): Constat[] => constats.filter(c => c.gravite === 'grave' && c.statut === 'ouvert');

/** Un constat qui compte encore : à corriger (graves puis moyens) ou petite remarque (mineurs), jamais un constat déjà vu. */
export function groupesConstats(constats: Constat[]): { aCorriger: Constat[]; remarques: Constat[] } {
  const ouverts = constats.filter(c => c.statut === 'ouvert');
  const rang = (c: Constat) => (c.gravite === 'grave' ? 0 : 1);
  return {
    aCorriger: ouverts.filter(c => c.gravite !== 'mineur').sort((a, b) => rang(a) - rang(b) || b.quand - a.quand),
    remarques: ouverts.filter(c => c.gravite === 'mineur'),
  };
}

/** L'id d'un constat tel que le serveur le fabrique : `cle|…` (clé trouvée par le serveur) ou `ia|…` (relue par l'IA). */
export const ID_CONSTAT = /^(cle|ia)\|[^\n]{1,400}$/;

/** Le nom court d'un dépôt (« compte/nom » → « nom »). */
export const nomCourt = (depot: string) => depot.slice(depot.lastIndexOf('/') + 1);

/** « a, b, c et 2 autres » : trois noms au plus. */
export function listeCourte(noms: string[], max = 3): string {
  if (noms.length <= max) return noms.join(', ');
  const reste = noms.length - max;
  return `${noms.slice(0, max).join(', ')} et ${reste} ${reste > 1 ? 'autres' : 'autre'}`;
}

/** Le marqueur « … » de lireCommit : GitHub a coupé la liste des fichiers (plus de 300). */
export const MARQUEUR_LISTE_COUPEE = '…';
/** Un fichier tel qu'on l'affiche : le marqueur « … » devient « liste coupée par GitHub ». */
export const nomFichier = (chemin: string) => (chemin === MARQUEUR_LISTE_COUPEE ? 'liste coupée par GitHub' : chemin);

/** Ce qui n'a pas marché au dernier essai, en une phrase ; null si l'essai était complet. */
export function phraseTentative(t: Tentative | null): string | null {
  if (!t) return null;
  const projets = (n: number) => `${n} ${n > 1 ? 'projets' : 'projet'}`;
  const noms = t.depots.length ? ` : ${listeCourte(t.depots)}` : '';
  switch (t.issue) {
    case 'complet': return null;
    case 'projets illisibles': return `N'a pas pu lire ${projets(t.nonLus)}${noms}.`;
    case 'relu en partie': return `Relu en partie${noms} ; la suite au prochain passage.`;
    case 'rapport refusé': return 'Son dernier rapport a été refusé ; le lot sera redonné.';
    case 'lot remis sans rapport': return 'Lot remis sans rapport.';
  }
}

/** La même chose en note d'agent (minuscule, sans point final), seulement pour un essai raté de moins de 3 h. */
export function noteTentative(t: Tentative | null, now: number): string | null {
  const p = t && now - t.quand < ABSENTE_APRES ? phraseTentative(t) : null;
  return p ? p[0].toLowerCase() + p.slice(1).replace(/\.$/, '') : null;
}

/** Le sha en version courte, comme sur GitHub. */
export const shaCourt = (sha: string) => sha.slice(0, 7);

/** « fichier:ligne », ou le seul fichier quand la ligne n'est pas connue. */
export const endroit = (c: Pick<Constat, 'fichier' | 'ligne'>) => (c.ligne === null ? c.fichier : `${c.fichier}:${c.ligne}`);

/**
 * Ce qu'une relecture dit en clair, ligne par ligne : jamais « propre » quand une partie n'a pas été lue.
 * Les fichiers cités sont ceux du dépôt (page privée) ; jamais un contenu.
 */
export function lignesRelecture(r: Relecture): string[] {
  const l = [r.commits.length === 1 ? '1 enregistrement relu' : `${r.commits.length} enregistrements relus`];
  if (r.reecrit) l.push('historique réécrit : relu sur les dernières 24 h seulement');
  if (r.enPartie.length) l.push(`relu en partie : ${r.enPartie.map(nomFichier).join(', ')}`);
  if (r.clesNonVerifiees.length) l.push(`clés non vérifiées : ${r.clesNonVerifiees.map(nomFichier).join(', ')}`);
  if (r.rienACoder) l.push(r.rienACoder > 1 ? `${r.rienACoder} enregistrements sans code à relire` : 'rien de code à relire');
  return l;
}

const JOUR = 86_400_000;

/**
 * Ce qui n'a pas été relu en entier dans les relectures récentes : celles des 24 h qui précèdent le dernier passage complet
 * (sans passage, rien). Sert à la phrase du Cerveau et à l'en-tête du bureau : même règle des deux côtés.
 */
export function bilanPartiel(relectures: Relecture[], passage: number | null): { enPartie: number; cles: number; reecrit: boolean } {
  const recentes = passage === null ? [] : relectures.filter(r => r.quand > passage - JOUR);
  return {
    enPartie: recentes.reduce((n, r) => n + r.enPartie.length, 0),
    cles: recentes.reduce((n, r) => n + r.clesNonVerifiees.length, 0),
    reecrit: recentes.some(r => !!r.reecrit),
  };
}

/** Les lignes visibles de l'en-tête quand une partie n'a pas été relue en entier. */
export function lignesPartiel(b: ReturnType<typeof bilanPartiel>): string[] {
  const f = (n: number) => `${n} ${n > 1 ? 'fichiers' : 'fichier'}`;
  return [
    ...(b.enPartie ? [`Relu en partie : ${f(b.enPartie)}`] : []),
    ...(b.cles ? [`Clés non vérifiées : ${f(b.cles)}`] : []),
    ...(b.reecrit ? ['Historique réécrit'] : []),
  ];
}

/** Les constats moyens que je n'ai pas encore marqués « Vu ». */
export const moyensOuverts = (constats: Constat[]): Constat[] => constats.filter(c => c.gravite === 'moyen' && c.statut === 'ouvert');

/**
 * Ce que dit la carte de Léa dans le Cerveau, sans jamais afficher « rien à signaler » si quelque chose reste, n'a pas
 * été lu en entier, ou si rien n'a encore été relu. Un essai raté récent dit ce qui n'a pas marché (au lieu de
 * « n'est pas passée depuis … » : elle est passée, mais sans finir).
 */
export function phraseCerveau(v: VueLea, dureeAbsence: string, now: number): string {
  const g = gravesOuverts(v.constats).length, m = moyensOuverts(v.constats).length;
  const partiel = lignesPartiel(bilanPartiel(v.relectures, v.passage)).length > 0;
  const rate = phraseTentative(v.tentative);
  const recent = !!v.tentative && now - v.tentative.quand < ABSENTE_APRES;
  const morceaux = [
    ...(v.absente && v.passage !== null && !(rate && recent) ? [`N'est pas passée depuis ${dureeAbsence}.`] : []),
    ...(rate ? [rate] : []),
    ...(g ? [`${g} ${g > 1 ? 'points graves' : 'point grave'} à corriger.`] : []),
    ...(m ? [`${m} ${m > 1 ? 'points moyens' : 'point moyen'} à regarder.`] : []),
    ...(partiel ? ['Une partie n\'a été relue qu\'en partie.'] : []),
  ];
  if (morceaux.length) return morceaux.join(' ');
  const rienDeRelu = v.relectures.length === 0 && !v.constats.some(c => c.statut === 'ouvert');
  return rienDeRelu ? 'Pas encore de relecture.' : 'Rien à signaler sur les pushes relus.';
}

/** Le message du bureau quand il n'y a rien à corriger : honnête si Léa n'est plus passée. */
export const messageRienACorriger = (absenteDepuis: string | null) =>
  absenteDepuis ? `Rien à corriger dans les relectures reçues (Léa n'est pas passée depuis ${absenteDepuis}).` : 'Rien à corriger pour l’instant.';
