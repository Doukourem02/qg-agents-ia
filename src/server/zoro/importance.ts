import type { Important, Partie, Tour } from './types';

// Ce qui mérite Telegram (spec § 6 et § 9) et le message du mardi. Fonctions pures, sans réseau.
// Les clés (`cle`) restent les mêmes d'une semaine à l'autre : c'est ce qui permet le rappel « toujours : … ».

const JOUR = 86_400_000;
const PROJET_ACTIF_JOURS = 90;
const CI_ACTIF_JOURS = 30;
const MAC_ACTIF_JOURS = 90;
const MAC_ATTENTE_JOURS = 7;
export const MAC_VIEUX_JOURS = 2;
const LIGNES_MAX = 12;

export const TITRE_MESSAGE = '🛡️ Zoro · tour de sécurité du mardi';
export const LIEN_BUREAU = 'https://mon-qg.vercel.app/?bureau=zoro';

const PARTIES: { partie: Partie; titre: string }[] = [
  { partie: 'failles', titre: 'Failles' },
  { partie: 'ci', titre: 'Tests' },
  { partie: 'cles', titre: 'Clés' },
  { partie: 'mac', titre: 'Sur ton Mac' },
];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 7 novembre » (heure UTC = Abidjan) ; l'année seulement si ce n'est pas celle de `now`. */
function date(ms: number, now: number): string {
  const d = new Date(ms);
  const annee = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}${annee}`;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
const jours = (n: number) => pluriel(n, 'jour', 'jours');

/** Retire caractères de contrôle, retours à la ligne et caractères invisibles (sens d'écriture, etc.) ; coupe à 80. */
export function nettoyer(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, 80);
}

/** Les points importants du tour, dans l'ordre des parties : failles, tests, clés, Mac. */
export function importants(t: Omit<Tour, 'importants'>, now: number): Important[] {
  const sortie: Important[] = [];

  // Failles : critiques ou hautes, dépendance de production directe, projet actif. Une par (dépôt, id).
  for (const p of t.projets) {
    if (now - p.pousse > PROJET_ACTIF_JOURS * JOUR) continue;
    const vues = new Set<string>();
    for (const f of p.failles ?? []) {
      if (!f.directeProd || (f.gravite !== 'critique' && f.gravite !== 'haute') || vues.has(f.id)) continue;
      vues.add(f.id);
      sortie.push({ cle: `faille:${p.depot}:${f.id}`, partie: 'failles', projet: p.depot, texte: `faille ${f.gravite} dans ${f.paquet} ${f.version}` });
    }
  }

  // Tests : branche par défaut rouge d'un projet poussé dans les 30 derniers jours (illisible → jamais).
  for (const p of t.projets) {
    if (p.ci.etat !== 'rouge' || now - p.pousse > CI_ACTIF_JOURS * JOUR) continue;
    sortie.push({ cle: `ci:${p.depot}`, partie: 'ci', projet: p.depot, texte: `tests en échec depuis le ${date(p.ci.depuis, now)}` });
  }

  // Clés : bientôt expirée (≤ 14 jours) ou expirée. « Sans date » et « non connecté » : page seulement.
  for (const c of t.cles) {
    if (c.etat === 'bientot' && c.expire !== null) {
      sortie.push({ cle: `cle:${c.nom}`, partie: 'cles', projet: c.nom, texte: `expire dans ${jours(Math.max(1, Math.ceil((c.expire - now) / JOUR)))}` });
    } else if (c.etat === 'expiree') {
      sortie.push({ cle: `cle:${c.nom}`, partie: 'cles', projet: c.nom, texte: 'a expiré, à renouveler' });
    }
  }

  // Mac : seulement un rapport de moins de 2 jours ; dossiers git lus en entier et actifs (< 90 jours).
  const mac = t.mac;
  if (mac && !t.macVieux && now - mac.quand <= MAC_VIEUX_JOURS * JOUR) {
    for (const d of mac.dossiers) {
      if (!d.git || d.illisible) continue;
      const actif = [d.dernierCommit, d.plusAncienNonEnregistre].some(x => x !== null && now - x < MAC_ACTIF_JOURS * JOUR);
      if (!actif) continue;
      const attente = (x: number | null) => (x !== null && now - x > MAC_ATTENTE_JOURS * JOUR ? Math.floor((now - x) / JOUR) : null);
      const ajouter = (genre: string, texte: string) => sortie.push({ cle: `mac:${d.nom}:${genre}`, partie: 'mac', projet: d.nom, texte });
      const nonEnregistres = d.nonEnregistres > 0 ? attente(d.plusAncienNonEnregistre) : null;
      if (nonEnregistres !== null) {
        ajouter('nonEnregistres', `${pluriel(d.nonEnregistres, 'changement pas enregistré', 'changements pas enregistrés')} depuis ${jours(nonEnregistres)}`);
      }
      // Sans distant, tous les commits sont « non poussés » : une seule alerte, celle du distant.
      const nonPousses = d.distant && d.nonPousses > 0 ? attente(d.plusAncienNonPousse) : null;
      if (nonPousses !== null) {
        ajouter('nonPousses', `${pluriel(d.nonPousses, 'commit pas encore envoyé', 'commits pas encore envoyés')} en ligne depuis ${jours(nonPousses)}`);
      }
      if (!d.distant) ajouter('sansDistant', 'aucune copie en ligne (pas de dépôt distant)');
    }
  }
  return sortie;
}

/** « 1 faille critique et 2 hautes » (les textes de failles commencent par « faille <gravité> »). */
function compteFailles(liste: Important[]): string {
  const critiques = liste.filter(i => i.texte.startsWith('faille critique')).length;
  const hautes = liste.length - critiques;
  const morceaux: string[] = [];
  if (critiques) morceaux.push(pluriel(critiques, 'faille critique', 'failles critiques'));
  if (hautes) morceaux.push(critiques ? pluriel(hautes, 'haute', 'hautes') : pluriel(hautes, 'faille haute', 'failles hautes'));
  return morceaux.join(' et ');
}

function parProjet(liste: Important[]): [string, Important[]][] {
  const m = new Map<string, Important[]>();
  for (const i of liste) m.set(i.projet, [...(m.get(i.projet) ?? []), i]);
  return [...m];
}

/**
 * Le message du mardi (texte simple) ; null si rien d'important. Une ligne par projet et par partie ; ce qui était déjà
 * signalé tient en une ligne « toujours : … » par projet. Au plus 12 lignes, le reste « + N autres dans la page » :
 * tous les points nouveaux passent avant les rappels, pour qu'un nouveau ne soit jamais caché derrière un « toujours ».
 * `pasLu` : la ligne « Pas lu cette fois : … » (resumeNonLu), ajoutée quand une partie n'a pas été lue.
 */
export function messageTelegram(imp: Important[], dejaSignales: Set<string>, pasLu?: string | null): string | null {
  if (imp.length === 0) return null;
  const nouvelles: { partie: Partie; texte: string }[] = [];
  const rappels: { partie: Partie; texte: string }[] = [];
  for (const { partie } of PARTIES) {
    const ici = imp.filter(i => i.partie === partie);
    const resume = (l: Important[]) => (partie === 'failles' ? compteFailles(l) : l.map(i => nettoyer(i.texte)).join(', '));
    for (const [projet, l] of parProjet(ici.filter(i => !dejaSignales.has(i.cle)))) {
      nouvelles.push({ partie, texte: `${nettoyer(projet)} : ${resume(l)}` });
    }
    for (const [projet, l] of parProjet(ici.filter(i => dejaSignales.has(i.cle)))) {
      rappels.push({ partie, texte: partie === 'failles' ? `toujours : ${resume(l)} dans ${nettoyer(projet)}` : `toujours : ${nettoyer(projet)}, ${resume(l)}` });
    }
  }
  const lignes = [...nouvelles, ...rappels];

  const montrees = lignes.slice(0, LIGNES_MAX);
  const reste = lignes.length - montrees.length;
  const sortie = [TITRE_MESSAGE];
  for (const { partie, titre } of PARTIES) {
    const l = montrees.filter(x => x.partie === partie);
    if (l.length) sortie.push('', titre, ...l.map(x => `• ${x.texte}`));
  }
  if (reste > 0) sortie.push('', `+ ${reste} ${reste > 1 ? 'autres' : 'autre'} dans la page`);
  if (pasLu) sortie.push('', pasLu);
  sortie.push('', LIEN_BUREAU);
  return sortie.join('\n');
}
