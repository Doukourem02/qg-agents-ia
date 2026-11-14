import type { KV } from './memoire';
import type { Bouton } from './telegram';
import type { Lecture } from './crise/lecture';
import { hhmm, type Sujet } from '@/data/crise';
import {
  cibler, confirmationIgnore, confirmationReprise, dansGroupe, groupesDe, libelle, texteBouton, vueIgnores,
  type Groupe, type Ignore, type VueSilence,
} from '@/data/silence';
import type { Commande } from './telegram-commandes';

// « C'est connu, ignore » et la pause générale des alertes, rangés dans Upstash (spec : décision du patron, 12 novembre).
//   silence:ignores  table clé du problème → Ignore (JSON) : ce que le patron a dit d'ignorer ; une entrée disparaît d'elle-
//                    même quand le problème change vraiment (site revenu ou nouvelle panne, point vu, faille corrigée).
//   silence:pause    table `json` → { jusqua, depuis } : la pause générale (48 h au plus).
//   silence:attente  liste : les alertes gardées pendant la pause (30 au plus), dites en un message à la fin.
// Pendant la pause, seuls les messages qui demandent une réponse (Oui/Non, Valider) et le compte rendu de 08:15 partent :
// ceux-là n'utilisent jamais `envoyerAlerte`. Aucun texte de message n'est journalisé.

export const CLES_SILENCE = { ignores: 'silence:ignores', pause: 'silence:pause', attente: 'silence:attente' } as const;
const CHAMP = 'json';
const ATTENTE_MAX = 30;
const LIGNES_FIN = 10;

export type Envoyer = (texte: string, boutons?: Bouton[] | Bouton[][]) => Promise<unknown>;
export type Reponse = { texte: string; boutons?: Bouton[][] };

function lire<T>(brut: string | undefined | null): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

// ───────────── Les ignorés ─────────────

export async function lireIgnores(kv: KV): Promise<Ignore[]> {
  return Object.values(await kv.hgetall(CLES_SILENCE.ignores)).flatMap(v => lire<Ignore>(v) ?? []);
}

/** Un problème est ignoré si le patron l'a dit, et, pour un site, pour cette panne-là (une nouvelle panne revient). */
export const estIgnore = (ignores: readonly Ignore[], s: Pick<Sujet, 'cle' | 'genre' | 'depuis'>) =>
  ignores.some(i => i.cle === s.cle && (s.genre !== 'site' || i.depuis === s.depuis));

export async function ignorer(kv: KV, sujets: readonly Sujet[], now: number) {
  for (const s of sujets) {
    const propre: Sujet = { ...s };
    delete propre.regle; delete propre.ignore;
    await kv.hset(CLES_SILENCE.ignores, s.cle, JSON.stringify({ ...propre, ignoreDepuis: now } satisfies Ignore));
  }
}

/** Retire les ignorés du groupe ; renvoie ceux retirés. */
export async function reprendre(kv: KV, ids: readonly string[]): Promise<Ignore[]> {
  const retires = (await lireIgnores(kv)).filter(i => ids.some(id => dansGroupe(id, i)));
  for (const i of retires) await kv.hdel(CLES_SILENCE.ignores, i.cle);
  return retires;
}

/**
 * Le retour automatique : un ignoré dont le problème n'est plus là (ou a changé : nouvelle panne) est oublié. Une source
 * illisible ne fait rien oublier. Appelé à chaque passage du suivi des réunions.
 */
export async function nettoyerIgnores(kv: KV, ignores: readonly Ignore[], lu: Lecture): Promise<Ignore[]> {
  const restent: Ignore[] = [];
  for (const i of ignores) {
    const encore = lu.illisibles.includes(i.genre) || lu.sujets.some(s => s.cle === i.cle && (s.genre !== 'site' || s.depuis === i.depuis));
    if (encore) restent.push(i);
    else await kv.hdel(CLES_SILENCE.ignores, i.cle);
  }
  return restent;
}

// ───────────── La pause générale ─────────────

type Pause = { jusqua: number; depuis: number };

/** La fin de la pause en cours ; null sans pause (ou pause échue). */
export async function pauseEnCours(kv: KV, now: number): Promise<number | null> {
  const p = lire<Pause>((await kv.hmget(CLES_SILENCE.pause, [CHAMP]))[CHAMP]);
  return p && p.jusqua > now ? p.jusqua : null;
}

export async function mettrePause(kv: KV, jusqua: number, now: number) {
  await kv.hset(CLES_SILENCE.pause, CHAMP, JSON.stringify({ jusqua, depuis: now } satisfies Pause));
}

/** Garde une alerte pour la fin de la pause (30 au plus : les plus anciennes partent d'abord). */
export async function garder(kv: KV, texte: string) {
  await kv.lpush(CLES_SILENCE.attente, texte.slice(0, 600));
  await kv.ltrim(CLES_SILENCE.attente, 0, ATTENTE_MAX - 1);
}

/**
 * Une alerte (Luffy, Léa, Zoro, réunion de crise) : envoyée tout de suite, ou gardée pendant la pause. Gardée vaut
 * « partie » pour l'appelant (rien ne repart en double au passage suivant).
 */
export async function envoyerAlerte(kv: KV, envoyer: Envoyer, texte: string, boutons?: Bouton[] | Bouton[][], now = Date.now()) {
  if (await pauseEnCours(kv, now)) { await garder(kv, texte); return; }
  await envoyer(texte, boutons);
}

/** Le message de fin de pause : ce qui a été gardé, en 10 lignes au plus. */
function texteFinPause(gardes: string[], debut: string): string {
  if (!gardes.length) return `${debut} Rien n'est arrivé pendant la pause.`;
  const lignes = gardes.flatMap(g => g.split('\n').filter(Boolean).slice(0, 2).map(l => `• ${l}`));
  const montres = lignes.slice(0, LIGNES_FIN);
  const reste = lignes.length - montres.length;
  return [`${debut} Pendant la pause :`, ...montres, ...(reste > 0 ? [`• et ${reste} de plus dans la page`] : [])].join('\n');
}

/** Arrête la pause et rend ce qui a été gardé (du plus ancien au plus récent). */
async function viderPause(kv: KV): Promise<string[]> {
  const gardes = (await kv.lrange(CLES_SILENCE.attente, 0, -1)).reverse();
  await kv.del(CLES_SILENCE.attente);
  await kv.del(CLES_SILENCE.pause);
  return gardes;
}

/**
 * La pause est échue : un seul message dit ce qui a été gardé, puis tout reprend. Telegram en échec : la pause reste
 * notée comme échue et le message repart au passage suivant (rien n'est perdu).
 */
export async function finirPauseEchue(kv: KV, envoyer: Envoyer, now: number): Promise<boolean> {
  const p = lire<Pause>((await kv.hmget(CLES_SILENCE.pause, [CHAMP]))[CHAMP]);
  if (!p || p.jusqua > now) return false;
  const gardes = (await kv.lrange(CLES_SILENCE.attente, 0, -1)).reverse();
  try {
    await envoyer(texteFinPause(gardes, '🔔 Fin de la pause des alertes.'));
  } catch {
    console.error('silence : message de fin de pause pas parti');
    return false;
  }
  await viderPause(kv);
  return true;
}

/** Ce que la page montre : les ignorés (par groupe, depuis quand) et la pause. */
export async function vueSilence(kv: KV, now: number): Promise<VueSilence> {
  return { ignores: vueIgnores(await lireIgnores(kv)), pause: await pauseEnCours(kv, now) };
}

/** Une ligne courte pour le compte rendu du matin : « ignorés : API Livreo, 13 failles critiques de Zoro ». */
export const ligneIgnores = (v: VueSilence | null): string | null => {
  if (!v) return null;
  const morceaux = [
    ...(v.ignores.length ? [`ignorés : ${v.ignores.map(i => i.libelle).join(', ')}`] : []),
    ...(v.pause ? [`alertes en pause jusqu'à ${hhmm(v.pause)}`] : []),
  ];
  return morceaux.length ? morceaux.join(' ; ') : null;
};

// ───────────── Les commandes de Telegram ─────────────

export type DepsSilence = {
  envoyer: Envoyer;
  /** La lecture des vraies alertes (Upstash) ; remplaçable dans les tests. */
  lire: (kv: KV, now: number) => Promise<Lecture>;
  /** Juste après un « ignore » : le suivi des réunions (une réunion dont tout est ignoré se termine tout de suite). */
  apres?: (now: number) => Promise<unknown>;
};

const ligneBoutons = (gs: readonly Groupe[], prefixe: 'ign' | 'rep', verbe: string): Bouton[][] =>
  gs.map(g => [{ texte: texteBouton(g, verbe), donnee: `${prefixe}:${g.id}` }]);

/** Les boutons « Ignorer » d'un message d'alerte : un par problème (site, Léa, Zoro). */
export const boutonsIgnorer = (sujets: readonly Sujet[]): Bouton[][] => ligneBoutons(groupesDe(sujets), 'ign', 'Ignorer');

/** Les problèmes ouverts maintenant, pas encore ignorés. */
async function ouverts(kv: KV, deps: DepsSilence, now: number): Promise<Sujet[]> {
  const [lu, ignores] = await Promise.all([deps.lire(kv, now), lireIgnores(kv)]);
  return lu.sujets.filter(s => !estIgnore(ignores, s));
}

/** Ignore les groupes, confirme, puis laisse le suivi fermer la réunion si plus rien ne la justifie. */
async function faireIgnorer(kv: KV, groupes: Groupe[], deps: DepsSilence, now: number): Promise<null> {
  await ignorer(kv, groupes.flatMap(g => g.sujets), now);
  await deps.envoyer(confirmationIgnore(groupes));
  await deps.apres?.(now).catch(() => console.error('silence : suivi des réunions impossible'));
  return null;
}

const QUOI_IGNORER = 'Qu\'est-ce que je ne dois plus te signaler ? Touche un bouton (rien ne change sans ton choix).';

/**
 * « ignore Livreo » (texte libre) : la cible est reconnue par le code ; un doute → des boutons, jamais une supposition.
 * Renvoie le texte de la réponse, null si tout est déjà parti, ou `kuroro` (rien d'ouvert et rien de nommé : c'est une
 * conversation, « t'inquiète pas, ça va »).
 */
export async function commandeIgnorer(kv: KV, texte: string, deps: DepsSilence, now: number): Promise<Reponse | null | 'kuroro'> {
  const l = await ouverts(kv, deps, now);
  const c = cibler(texte, l);
  const tous = groupesDe(l);
  switch (c.quoi) {
    case 'groupes': return faireIgnorer(kv, c.groupes, deps, now);
    case 'tout': return tous.length ? faireIgnorer(kv, tous, deps, now) : { texte: 'Rien d\'ouvert en ce moment : rien à ignorer.' };
    case 'doute': return {
      texte: `J'ai plusieurs choses à ce nom : ${c.groupes.map(libelle).join(' ; ')}. Laquelle ignorer ?`,
      boutons: [...ligneBoutons(c.groupes, 'ign', 'Ignorer'), [{ texte: 'Ignorer tout ça', donnee: `ign:${c.tout.id}` }]],
    };
    case 'rien': return tous.length
      ? { texte: `Je ne vois rien d'ouvert pour « ${c.mots} » en ce moment. Ce qui est ouvert : ${tous.map(libelle).join(' ; ')}.`, boutons: ligneBoutons(tous, 'ign', 'Ignorer') }
      : { texte: `Je ne vois rien d'ouvert pour « ${c.mots} » en ce moment : rien à ignorer.` };
    case 'vague': return tous.length ? { texte: QUOI_IGNORER, boutons: ligneBoutons(tous, 'ign', 'Ignorer') } : 'kuroro';
  }
}

/** « reprends Livreo » : la cible est cherchée parmi les ignorés. */
export async function commandeReprendre(kv: KV, texte: string, now: number): Promise<Reponse> {
  const ignores = await lireIgnores(kv);
  const c = cibler(texte, ignores);
  const tous = groupesDe(ignores);
  const pause = await pauseEnCours(kv, now);
  switch (c.quoi) {
    case 'groupes': case 'doute': {
      // reprendre n'est jamais risqué : un nom pour plusieurs agents (« reprends qg ») les reprend tous
      await reprendre(kv, c.quoi === 'groupes' ? c.groupes.map(g => g.id) : [c.tout.id]);
      return { texte: confirmationReprise(c.groupes) };
    }
    case 'tout': {
      if (!tous.length && !pause) return { texte: 'Rien n\'est ignoré et les alertes ne sont pas en pause.' };
      await reprendre(kv, ['*']);
      const fin = pause ? texteFinPause(await viderPause(kv), 'Les alertes reprennent.') : '';
      return { texte: [tous.length ? confirmationReprise(tous) : '', fin].filter(Boolean).join('\n\n') };
    }
    case 'rien': return tous.length
      ? { texte: `Je n'ignore rien qui s'appelle « ${c.mots} ». J'ignore : ${tous.map(libelle).join(' ; ')}.`, boutons: ligneBoutons(tous, 'rep', 'Reprendre') }
      : { texte: 'Je n\'ignore rien en ce moment.' };
    case 'vague': {
      if (tous.length === 1) { await reprendre(kv, [tous[0].id]); return { texte: confirmationReprise(tous) }; }
      return tous.length
        ? { texte: 'Que dois-je reprendre ?', boutons: ligneBoutons(tous, 'rep', 'Reprendre') }
        : { texte: pause ? 'Je n\'ignore rien. Pour la pause des alertes, écris « reprends les alertes ».' : 'Je n\'ignore rien en ce moment.' };
    }
  }
}

const quandFin = (jusqua: number, now: number) => {
  const jour = (t: number) => Math.floor(t / 86_400_000);
  return jour(jusqua) === jour(now) ? hhmm(jusqua) : jour(jusqua) === jour(now) + 1 ? `demain ${hhmm(jusqua)}` : `après-demain ${hhmm(jusqua)}`;
};

/** Les boutons quand la durée de la pause manque. */
const BOUTONS_PAUSE: Bouton[][] = [[
  { texte: '1 h', donnee: 'pse:60' }, { texte: '2 h', donnee: 'pse:120' }, { texte: 'Jusqu\'à demain 8 h', donnee: 'pse:d8' },
]];

export async function commandePause(kv: KV, jusqua: number | null, now: number): Promise<Reponse> {
  if (jusqua === null) return { texte: 'Une pause des alertes pour combien de temps ?', boutons: BOUTONS_PAUSE };
  await mettrePause(kv, jusqua, now);
  return {
    texte: `D'accord : pas d'alertes jusqu'à ${quandFin(jusqua, now)}. Les questions qui attendent ta réponse et le compte `
      + 'rendu de 08:15 passent quand même ; le reste t\'attend pour la fin de la pause. Écris « reprends les alertes » pour l\'arrêter avant.',
  };
}

export async function commandeFinPause(kv: KV, now: number): Promise<Reponse> {
  if (!(await pauseEnCours(kv, now))) return { texte: 'Les alertes ne sont pas en pause.' };
  return { texte: texteFinPause(await viderPause(kv), 'Les alertes reprennent.') };
}

/** Une commande reconnue par le code (src/server/telegram-commandes.ts). */
export async function traiterCommande(kv: KV, c: Commande, deps: DepsSilence, now: number): Promise<Reponse | null | 'kuroro'> {
  switch (c.type) {
    case 'ignorer': return commandeIgnorer(kv, c.texte, deps, now);
    case 'reprendre': return commandeReprendre(kv, c.texte, now);
    case 'pause': return commandePause(kv, c.jusqua, now);
    case 'fin-pause': return commandeFinPause(kv, now);
    case 'pause-trop-longue': return { texte: 'Une pause dure 48 h au plus. Écris par exemple « pas d\'alertes pendant 2 h » ou « silence jusqu\'à demain 8 h ».' };
  }
}

/** Un bouton : `ign:<groupe>`, `rep:<groupe>`, `pse:<minutes>|d8`. */
export async function boutonSilence(kv: KV, donnee: string, deps: DepsSilence, now: number): Promise<Reponse | null> {
  const [quoi, ...reste] = donnee.split(':');
  const id = reste.join(':');
  if (quoi === 'ign') {
    const l = (await ouverts(kv, deps, now)).filter(s => dansGroupe(id, s));
    if (!l.length) return { texte: 'Plus rien d\'ouvert de ce côté : rien à ignorer.' };
    // le groupe du bouton, tel qu'il est maintenant (un point de Léa ajouté depuis le message compte aussi)
    return faireIgnorer(kv, [{ id, sujets: l }], deps, now);
  }
  if (quoi === 'rep') {
    const retires = await reprendre(kv, [id]);
    return { texte: retires.length ? confirmationReprise(groupesDe(retires)) : 'Ce n\'était déjà plus ignoré.' };
  }
  if (quoi === 'pse') {
    const minuit = now - (now % 86_400_000);
    const jusqua = id === 'd8' ? minuit + 86_400_000 + 8 * 3_600_000 : now + Number(id) * 60_000;
    if (!Number.isFinite(jusqua) || jusqua <= now || jusqua - now > 48 * 3_600_000) return { texte: 'Je n\'ai pas compris cette durée.' };
    return commandePause(kv, jusqua, now);
  }
  return null;
}
