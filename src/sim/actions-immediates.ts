// Les consignes que le QG exécute tout de suite, reconnues par le code (jamais par le modèle) dans le message de
// Le patron, sur Telegram comme dans la barre de mission : « vérifie mes sites » (Luffy), « refais le tour de sécurité »
// (Zoro), « mets Ye en pause cette semaine », « reprends Paul ». Une question (« mes sites sont en ligne ? ») ou une
// négation (« ne vérifie pas… ») n'est jamais une action. Fonctions pures, partagées par le serveur et la page.
// Heure d'Abidjan = UTC.

import { AGENTS_REELS } from '@/data/reels';

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;

export type ActionImmediate =
  | { type: 'luffy-verifier' }
  | { type: 'zoro-verifier' }
  /** `jusqua` null : jusqu'à ce que le patron le reprenne. */
  | { type: 'pause-agent'; agent: string; jusqua: number | null }
  | { type: 'reprendre-agent'; agent: string };

/** Minuscules, sans accents, apostrophes et tirets en espaces ; « ? » gardé. */
const norme = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9?]+/g, ' ').replace(/\s+/g, ' ').trim();

export const NOMS_REELS: Record<string, string> = {
  L: 'L', light: 'Light', clara: 'Clara', mafe: 'Mafe', luffy: 'Luffy', isaac: 'Isaac', zoro: 'Zoro', lea: 'Léa', paul: 'Paul', ye: 'Ye', feu: 'Feu',
};
const FEMININ = ['clara', 'mafe', 'lea', 'ye'];

/** Les vrais agents nommés dans le message. « L » seul et en majuscule (« l » est partout en minuscules). */
export function agentsNommes(brut: string): string[] {
  const t = ` ${norme(brut)} `;
  return (AGENTS_REELS as readonly string[]).filter(id => (id === 'L'
    ? /(^|[\s,(«"])L($|[\s,.!?:;)»"])/.test(brut)
    : t.includes(` ${norme(NOMS_REELS[id])} `)));
}

/** Les mots qu'on dit avant la consigne (« salut Kuroro, vérifie… », « Luffy, refais… »). */
const AVANT = /^((salut|bonjour|bonsoir|hello|coucou|hey|yo|kuroro|lucifer|patron|chef|boss|stp|svp|alors|bon|ok|okay|et|puis|maintenant|donc|allez|dis|eh|oh|luffy|zoro) )+/;
const POLIE = /^(tu peux|tu pourrais|peux tu|pourrais tu|tu veux bien|est ce que tu peux|est ce que tu pourrais|stp|svp|merci de)\b/;
const QUESTION_DEBUT = /^(pourquoi|comment|quand|combien|qui|quoi|ou|est ce|qu est ce|c est quoi|quel|quelle|quels|quelles|as tu|a t il|a t elle|y a t il)\b/;
const NEGATION = /\b(ne|n) (\w+ ){0,3}(pas|plus|jamais|rien)\b|\bpas besoin\b|\binutile de\b|\bsurtout pas\b/;

/** Une question n'est jamais une consigne ; « tu peux vérifier mes sites ? » en est une. */
export function estQuestion(brut: string): boolean {
  const t = norme(brut).replace(AVANT, '');
  if (POLIE.test(t)) return false;
  return QUESTION_DEBUT.test(t) || /\?\s*$/.test(t);
}

const VERIFIER = /\b(verifie[rsz]?|reverifie[rsz]?|verif|verification|check|checke[rsz]?|teste[rsz]?|controle[rsz]?|regarde[rsz]?|scanne[rsz]?|sonde[rsz]?|refaire|refais le tour|relance[rsz]?|lance[rsz]?|jette un oeil|passe en revue|repasse|(?:re)?fai(?:s|t|tes)? (?:un|une|le|la) (?:tour|point|verif|verification|controle|check|test))\b/;
const CIBLE_LUFFY = /\b(sites?|luffy|en ligne|vigie)\b/;
const CIBLE_ZORO = /\b(securite|failles?|vulnerabilites?|zoro)\b/;
/** Ce qui fait d'une phrase autre chose qu'une vérification (« ajoute un site », « un post sur la sécurité »). */
const AUTRE_TRAVAIL = /\b(ajoute[rsz]?|retire[rsz]?|supprime[rsz]?|enleve[rsz]?|post|posts|linkedin|article|readme|fiche|fiches|redige[rsz]?|ecris|ecrire|mail|mails)\b/;

const PAUSE = /^(pause|suspends?|suspendre)\b|\b(mets?|mettre|remets?|remettre|place[rsz]?|passe[rsz]?)\b.*\ben pause\b|\ben pause (cette|pour|jusqu|pendant|aujourd|ce|des|a partir)\b|\bsuspends?\b|\bsuspendre\b/;
const REPRISE = /\b(reprends?|reprendre|reprenez|reactive[rsz]?|reactiver)\b|\bremets?\b.*\b(en route|en marche|en service|au travail)\b|\bsors?\b.*\bde (la )?pause\b|\bfin de (la )?pause\b|\bplus en pause\b/;
/** La pause générale des alertes reste aux commandes de Telegram (src/server/telegram-commandes.ts). */
const ALERTES = /\b(alertes?|notifications?|messages?|silence)\b/;

const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, quinze: 15 };
const minuit = (t: number) => t - (((t % JOUR) + JOUR) % JOUR);

/** La fin d'une pause d'agent : « cette semaine » (lundi 00:00), « aujourd'hui », « jusqu'à jeudi », « 3 jours » ; null : jusqu'à la reprise. */
export function finPauseAgent(brut: string, now: number): number | null {
  const t = norme(brut);
  const m0 = minuit(now);
  if (/\b(cette semaine|pour la semaine|jusqu a la fin de la semaine|jusqu a la semaine prochaine)\b/.test(t)) {
    const jour = new Date(now).getUTCDay(); // 0 = dimanche
    return m0 + ((8 - jour) % 7 || 7) * JOUR;
  }
  if (/\bjusqu a apres demain\b/.test(t)) return m0 + 2 * JOUR;
  if (/\b(aujourd hui|pour la journee|ce soir|jusqu a ce soir|jusqu a demain)\b/.test(t)) return m0 + JOUR;
  const jour = t.match(/\bjusqu (?:a|au) (dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/);
  if (jour) {
    const cible = JOURS_SEMAINE.indexOf(jour[1]);
    return m0 + ((cible - new Date(now).getUTCDay() + 7) % 7 || 7) * JOUR;
  }
  const n = '(\\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|quinze)';
  const duree = t.match(new RegExp(`\\b${n} (jours?|semaines?|h|heures?)\\b`));
  if (duree) {
    const nb = duree[1] in NOMBRES ? NOMBRES[duree[1]] : Number(duree[1]);
    const unite = duree[2].startsWith('j') ? JOUR : duree[2].startsWith('s') ? 7 * JOUR : H;
    if (nb > 0) return now + nb * unite;
  }
  return null;
}

/** Les actions immédiates du message ; [] : une mission ordinaire, une question ou une conversation. */
export function lireActionsImmediates(brut: string, now: number): ActionImmediate[] {
  if (!brut.trim() || brut.length > 300) return [];
  if (estQuestion(brut)) return [];
  const t = norme(brut).replace(/\?/g, ' ').trim();
  if (NEGATION.test(t)) return [];
  const nommes = agentsNommes(brut);

  // pause et reprise d'un agent : un seul vrai agent nommé, et pas les alertes (la pause générale de Telegram)
  if (!ALERTES.test(t) && nommes.length === 1) {
    const agent = nommes[0];
    if (PAUSE.test(t) && !REPRISE.test(t)) return [{ type: 'pause-agent', agent, jusqua: finPauseAgent(brut, now) }];
    if (REPRISE.test(t) && !PAUSE.test(t)) return [{ type: 'reprendre-agent', agent }];
  }

  // les vérifications : un verbe et ce qu'il faut vérifier ; jamais si un autre agent est nommé ou s'il s'agit d'un autre travail
  if (!VERIFIER.test(t) || AUTRE_TRAVAIL.test(t) || PAUSE.test(t) || REPRISE.test(t)) return [];
  const autres = nommes.filter(id => id !== 'luffy' && id !== 'zoro');
  if (autres.length) return [];
  const out: ActionImmediate[] = [];
  if (CIBLE_LUFFY.test(t)) out.push({ type: 'luffy-verifier' });
  if (CIBLE_ZORO.test(t)) out.push({ type: 'zoro-verifier' });
  return out;
}

/** L'agent dont c'est le rôle. */
export const agentDe = (a: ActionImmediate) => (a.type === 'luffy-verifier' ? 'luffy' : a.type === 'zoro-verifier' ? 'zoro' : a.agent);

const hm = (t: number) => new Date(t).toISOString().slice(11, 16);
/** « aujourd’hui à 18:00 », « demain à 00:00 », « lundi 16 à 00:00 ». */
export function quandEnMots(t: number, now: number): string {
  const ecart = Math.floor(t / JOUR) - Math.floor(now / JOUR), d = new Date(t);
  const jour = ecart === 0 ? 'aujourd’hui' : ecart === 1 ? 'demain' : `${JOURS_SEMAINE[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${jour} à ${hm(t)}`;
}

/** « jusqu’à lundi 16 à 00:00 », ou « jusqu’à ce que tu la reprennes ». */
export const finEnMots = (agent: string, jusqua: number | null, now: number) =>
  jusqua === null ? `jusqu’à ce que tu ${FEMININ.includes(agent) ? 'la' : 'le'} reprennes` : `jusqu’à ${quandEnMots(jusqua, now)}`;

export type Canal = 'telegram' | 'page';

/** Ce que le QG répond tout de suite, avant le résultat (écrit par le code). */
export function annonce(a: ActionImmediate, canal: Canal, now: number): string {
  const ou = canal === 'telegram' ? 'ici' : 'sur Telegram';
  switch (a.type) {
    case 'luffy-verifier': return `Luffy vérifie tes sites maintenant : le résultat arrive ${ou} dans une minute.`;
    case 'zoro-verifier': return `Zoro refait le tour de sécurité maintenant (quelques minutes) : le résultat arrive ${ou}.`;
    case 'pause-agent': {
      const nom = NOMS_REELS[a.agent] ?? a.agent, le = FEMININ.includes(a.agent) ? 'la' : 'le';
      return `D’accord : ${nom} est en pause ${finEnMots(a.agent, a.jusqua, now)}. Ses passages prévus d’ici là sont sautés (« en pause (par toi) » dans le calendrier) et ses missions l’attendent. Écris « reprends ${nom} » pour ${le} reprendre avant.`;
    }
    case 'reprendre-agent': {
      const nom = NOMS_REELS[a.agent] ?? a.agent;
      return `${nom} reprend : ses prochains passages ont lieu comme prévu.`;
    }
  }
}
