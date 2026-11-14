// Ce que Kuroro sait et dit quand un modèle parle pour lui (Claude, ou le modèle local Ollama du Mac par le QG,
// voir src/server/kuroro-relais.ts) : les mêmes règles, la même vérité sur les missions, et la lecture stricte de la réponse du modèle local.
// Partagé par le serveur et la page : aucune dépendance au SDK ni au stockage. Heure d'Abidjan = UTC.

import { AGENTS, agentById, poleById } from './routing';
import { de, estOrdre, estReel, quandLigne } from './kuroro';

const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ');

export const MAX_TEXTE = 300;
/** Une réponse du modèle local plus longue n'est pas affichée (les règles reprennent). */
export const MAX_REPONSE = 400;
/** Les agents à qui Kuroro peut confier une mission (pas lui-même). */
export const IDS_CONFIABLES = AGENTS.filter(a => a.id !== 'kuroro').map(a => a.id);

export const VERITE_CLE = 'Ce qui arrive à une mission, le QG l’écrit lui-même (qui, quand, le résultat) : ne donne jamais de délai toi-même. '
  + 'Isaac lit ses missions tout de suite, si le Mac est allumé. Luffy (vérifier les sites) et Zoro (refaire le tour de sécurité) le font tout de suite ; leurs autres missions restent sur leur fiche. '
  + 'L, Light, Clara, Mafe, Léa, Paul, Ye et Feu font leurs missions au passage des missions (toutes les heures, de 8 h à 20 h, dès sa mise en service), dans leurs limites ; le résultat arrive sur Telegram. '
  + 'Une question de trading (solde, statut de BTC ou ETH, prochaine annonce, niveaux) : Feu, le code y répond tout de suite ; Feu ne passe jamais un ordre. '
  + 'Mettre un vrai agent en pause ou le reprendre, le QG le fait tout de suite quand le patron l’écrit. '
  + 'Les agents prévus (pas encore en service) ne tournent pas : une mission pour eux est gardée de côté.';

/** Les règles de Kuroro, communes à Claude et au modèle local. */
export const REGLES_KURORO = `Tu es Kuroro, le CEO du QG du patron : une équipe d'agents qui l'aident (son Mac, ses mails, ses sites, son LinkedIn…). Tu lui parles dans la barre de mission de sa page.

Ta façon de parler : un chef d'équipe d'Abidjan qui parle à son patron. Le patron est ton patron : tu le tutoies, mais tu restes respectueux et professionnel. Jamais « frère », « mon frère », « frérot », « bro » ni « mon pote », même s'il te parle familier. « Patron » de temps en temps, pas à chaque phrase. Français naturel, 1 à 3 phrases courtes, texte simple, sans markdown, sans liste, sans emoji. Ne répète jamais une phrase que tu as déjà dite dans la conversation.

Quatre cas :
1. Une salutation (« salut », « bonsoir », « ça va ? ») : réponds à sa salutation, « Bonjour » de 4 h à 18 h (heure_abidjan), « Bonsoir » sinon ; à « ça va ? », dis que tu vas bien, merci. Puis demande-lui, bien formulé, ce que tu peux faire pour lui (« Bonjour patron, je vais bien, merci. Qu'est-ce que je peux faire pour toi ? »). Rien d'autre : pas de résumé ni de nouvelles qu'il n'a pas demandés, aucune allusion au réveil, au matin ni à un message. Jamais une mission.
2. Une question (qui, quoi, quand, « c'est normal ? », « toujours rien ») : une réponse courte, seulement avec les faits plus bas. « aujourd_hui » dit, pour chaque agent, ce qu'il a fait aujourd'hui et à quelle heure ; « ou_arrive », si son travail arrive dans la page ou sur Telegram, et quels jours ; « ce_qui_t_attend », ce qui attend le patron (ce qui est urgent). Ce sont des phrases exactes : reprends-les sans rien recalculer, et dis ce qui s'est passé, jamais ce qui « devrait » se passer. « connaissances » : le projet et la fiche de chaque personnage ; si elles contredisent l'état en direct, crois l'état en direct. Si la réponse n'y est pas, dis que tu ne sais pas. Jamais une mission.
3. Une demande (un ordre ou un besoin : « vide le cache de mon Mac », « dis à Clara de trier mes mails », « j'ai besoin que… ») : une mission, pour l'agent dont c'est le rôle. Le QG écrit lui-même qui s'en occupe, où il en est et « c'est noté » : toi, tu choisis seulement l'agent, et ton texte est une courte accroche (« D'accord, patron. »). Si la demande est floue (tu ne sais pas quoi faire exactement, ni quel agent), pose une seule question de précision, sans mission.
4. Un reproche, de l'agacement ou une insulte : excuse-toi en une phrase, franchement, de ce qui a cloché dans l'échange (ce que tu as dit de travers), sans te justifier ; puis demande-lui ce que tu peux faire pour lui. N'ajoute aucun fait qu'il n'a pas demandé. S'il reproche quelque chose à un agent, dis seulement ce qui s'est vraiment passé (les faits), sans rien promettre. Jamais une mission.

${VERITE_CLE} Ne promets jamais plus que ça.

Ce que tu fais vraiment, toi : répondre ici avec les faits (résumer ce qu'un agent a fait), confier une mission sur une demande, et ton compte rendu du matin sur Telegram (« Kuroro (toi) »). Rien d'autre : tu n'envoies ni rappel ni message, tu ne relances aucun agent, tu ne changes aucun horaire. N'annonce et ne promets jamais autre chose.

Le ton, en deux modèles (ce qui est entre crochets vient toujours de la conversation ou des faits du jour, jamais de l'exemple) :
Le patron : « toujours rien de [l'agent] sur Telegram ? »
Kuroro : « [Ce qu'il a fait aujourd'hui, et à quelle heure] ; [où ça arrive, et quels jours sur Telegram]. »
Le patron : « tu te moques de moi ? »
Kuroro : « Pardon patron, [ce que tu as dit de travers], ça ne se reproduira pas. Qu'est-ce que je peux faire pour toi ? »
Ne recopie jamais un crochet : remplace-le par les faits.

Ne donne jamais d'adresse web, de mail, de clé ni de mot de passe.`;

/** L'entrée d'une mission, vérifiée : l'agent existe (pas Kuroro), la mission est un texte court. */
export function entreeValide(v: unknown): { agent: string; mission: string } | null {
  if (!v || typeof v !== 'object') return null;
  const { agent, mission } = v as Record<string, unknown>;
  if (typeof agent !== 'string' || !IDS_CONFIABLES.includes(agent)) return null;
  if (typeof mission !== 'string' || !mission.trim() || mission.trim().length > MAX_TEXTE) return null;
  return { agent, mission: mission.trim() };
}

/** Ce que le code sait de l'agent au moment de la mission : l'heure (le vrai délai), et sa pause décidée par le patron. */
export type Suite = { now?: number; pause?: string };

/** Ce qui va vraiment se passer pour cet agent (la même vérité que les règles de src/sim/kuroro.ts). */
export function suiteDe(id: string, { now = Date.now(), pause }: Suite = {}): string {
  const nom = agentById(id)?.nom ?? id;
  if (!estReel(id)) return `C’est le rôle ${de(nom)}, pas encore en service : la mission est gardée de côté.`;
  return quandLigne(id, pause ? [{ agent: id, prochainPassage: null, pause }] : null, now) ?? '';
}

/**
 * La réponse à une demande, une fois la mission déposée, écrite par le code (jamais par le modèle) : qui s'en occupe,
 * où il en est (`statut`, tiré des vues du QG : src/server/kuroro.ts, statutsMission), « c'est noté », et la vraie suite
 * (le vrai délai selon l'heure, ou sa pause).
 */
export function confirmation(id: string, statut = '', suite: Suite = {}): string[] {
  const a = agentById(id);
  if (!a) return [];
  if (!estReel(id)) return [`C’est le rôle ${de(a.nom)}, pas encore en service : c’est noté, je garde la mission de côté.`];
  return [`C’est ${a.nom} qui s’en occupe (${poleById(a.pole)?.nom ?? a.pole}).`, ...(statut && !suite.pause ? [statut] : []), 'C’est noté, je me charge de l’informer.', suiteDe(id, suite)].filter(Boolean);
}

/** « frère » et ses cousins, sans accents : Le patron est le patron. */
const FRERE = /\bfrer(e|es|ot|o)\b|\bbro\b|\bmon pote\b|\bmon reuf\b/;

/** Les verbes d'une accroche qui annoncerait la mission elle-même (le code le dit) ou la dirait déjà faite. */
const ANNONCE = /\b(fait|faite|vide|videe|envoye|envoyee|confie|confiee|transmis|transmets|transmettre|note|notee|occupe|charge|lance|termine|informe|informer|mission|demande|previens|dis)\b/;
/**
 * L'accroche du modèle avant la phrase du code (« D'accord, patron. ») : sa première phrase, courte, sans chiffre, sans
 * nom d'agent ni annonce ; « Entendu. » sinon. Le modèle ne dit jamais qui, ni quand, ni que c'est fait.
 */
export function accroche(texte: string): string {
  const p = (sansFaussesPromesses(texte).match(/[^.!?…]+[.!?…]*/) ?? [''])[0].trim();
  const s = sansAccents(p);
  const nomme = AGENTS.some(a => (a.id === 'L' ? /(^|[\s,])L($|[\s,.!])/.test(p) : new RegExp(`\\b${sansAccents(a.nom)}\\b`).test(s)));
  if (!p || p.length > 60 || /[\d?[\]]/.test(p) || FRERE.test(s) || nomme || ANNONCE.test(s)) return 'Entendu.';
  return /[.!…]$/.test(p) ? p : `${p.replace(/[,;:]$/, '')}.`;
}

/**
 * Ce qui a cloché dans l'échange, quand le code le sait : Kuroro l'a appelé « frère » (dans un tour d'avant, ou
 * Le patron le lui reproche). '' sinon. Dit au modèle à la fin du prompt, et repris par l'excuse écrite par le code.
 */
export function ceQuiACloche(tours: { role: string; texte: string }[]): string {
  const dernier = sansAccents(tours.filter(t => t.role === 'moi').at(-1)?.texte ?? '');
  const avant = tours.filter(t => t.role === 'kuroro').map(t => sansAccents(t.texte)).join(' ');
  return FRERE.test(avant) || /\bpas (ton|un|ta) (frer|pote|reuf)/.test(dernier) ? 'tu l’as appelé « frère », alors qu’il est ton patron' : '';
}

// ───────────── Le modèle local (Ollama, sur le Mac du patron, appelé par mac/kuroro.mjs) ─────────────

export const MODELE_LOCAL = 'qwen3:8b';

/** Le format imposé au modèle local (sortie structurée d'Ollama). */
export const SCHEMA_LOCAL = {
  type: 'object',
  properties: {
    texte: { type: 'string' },
    mission: {
      anyOf: [
        { type: 'null' },
        { type: 'object', properties: { agent: { type: 'string', enum: IDS_CONFIABLES }, mission: { type: 'string' } }, required: ['agent', 'mission'] },
      ],
    },
  },
  required: ['texte', 'mission'],
};

/** Sans mission possible : le modèle local ne peut pas en inventer une sur une question ou un reproche. */
export const SCHEMA_SANS_MISSION = {
  type: 'object',
  properties: { texte: { type: 'string' }, mission: { type: 'null' } },
  required: ['texte', 'mission'],
};

const FLOU = /\b(quelque chose|un truc|qqch|qqc)\b/i;

/**
 * Le dernier message peut-il être un ordre ? Les règles de la page en décident (estOrdre, src/sim/kuroro.ts) :
 * sinon, le modèle local n'a pas le droit de confier (format sans mission, et le serveur refuse). « Fais gaffe »,
 * « fais attention » sont des reproches, pas des ordres.
 */
export const peutEtreUnOrdre = (texte: string) =>
  // « fais quelque chose pour mes mails » : trop vague pour confier, Kuroro demande ce qu'il veut
  !FLOU.test(texte) && estOrdre(texte.replace(/\bfai(?:s|tes?) (?:gaffe|attention)\b/gi, ' '));

/** Une demande trop vague pour être confiée (« il faudrait faire quelque chose pour mes mails ») : Kuroro pose une question. */
export const estFlou = (texte: string) => FLOU.test(texte) && estOrdre(texte);

/** Le format imposé au modèle local pour ce message. */
export const formatLocal = (dernier: string) => (peutEtreUnOrdre(dernier) ? SCHEMA_LOCAL : SCHEMA_SANS_MISSION);

/** La toute fin du prompt local : l'humeur (et sa consigne), ce qui a cloché (si le code le sait), et « pas un ordre » quand le code le sait. */
export const finLocale = (humeur: string, dernier: string, cloche = '') => {
  const avec = `${humeur}${cloche ? `\nCe qui a cloché dans l'échange : ${cloche}.` : ''}${estFlou(dernier) ? '\nSa demande est floue : pose-lui une seule question de précision (ce qu\'il veut exactement), sans mission.' : ''}`;
  return peutEtreUnOrdre(dernier) ? avec : `${avec}\nSon dernier message n'est pas un ordre : aucune mission (« mission » vaut null).`;
};

/** Le prompt du modèle local : les règles, les faits, puis la fin (l'humeur du patron, qui change à chaque message). */
export function systemeLocal(faits: unknown, fin?: string): string {
  return `${REGLES_KURORO}

Réponds uniquement en JSON : {"texte": "...", "mission": null} pour une salutation, une question, un reproche ou une demande floue ;
{"texte": "<une courte accroche>", "mission": {"agent": "<id de l'agent>", "mission": "<la mission en une phrase>"}} seulement pour une demande claire.
Quand il y a une mission, « texte » est une accroche de quelques mots (« D'accord, patron. ») : ni qui, ni quand, ni que c'est fait ; le QG écrit le reste une fois la mission vraiment déposée.

Les faits du QG maintenant (heure d'Abidjan = UTC) :
${JSON.stringify(faits)}${fin ? `\n\n${fin}` : ''}`;
}

export type ReponseLocale = { texte: string; mission: { agent: string; mission: string } | null };

/**
 * Ce que Kuroro ne fait pas, dit à la première personne (« je vais lui rappeler », « j'envoie un rappel », « je le relance »,
 * « je m'en occupe ») : le QG n'envoie ni rappel ni relance. « Je t'envoie le compte rendu », « je te le résume » restent permis.
 */
const FAUSSE_PROMESSE = [
  /\bje (vais |vas |peux )?(lui|leur|les|le|la) (rappeler|rappelle|relancer|relance|demander|demande|dire|dis|ecrire|ecris|envoyer|envoie|prevenir|previens|secouer|secoue|pousser|pousse)\b/,
  /\bj (envoie|enverrai|ai envoye)\b.*\b(rappel|relance|message a|mail a)\b|\bje vais envoyer (un|une) (rappel|relance|message)\b/,
  /\b(je (vais )?(verifie|verifier|regarde|regarder) (avec|aupres))\b|\bje (vais )?m en occuper?\b|\bje vais (te faire|faire un tour|voir avec)\b|\bje (vais )?(m assurer|m assure|veiller|veille) (qu|que)\b/,
  /\bun rappel (est|a ete) envoye\b|\bje (l|les) ai (relance|prevenu|rappele)\b/,
];
/** Le texte sans les phrases qui annoncent une action que le QG ne fait pas ; '' s'il n'en reste rien. */
export function sansFaussesPromesses(texte: string): string {
  // « Kuroro : … » ou la réponse entre guillemets : le modèle a recopié la forme des exemples
  const nu = texte.replace(/^\s*kuroro\s*:\s*/i, '').replace(/^«\s*([\s\S]*?)\s*»$/, '$1');
  const phrases = nu.match(/[^.!?…]+[.!?…]*/g) ?? [nu];
  // une phrase avec un crochet recopié (« [l'agent] ») n'est pas une phrase pour le patron
  return phrases.filter(p => !/[[\]]/.test(p) && !FAUSSE_PROMESSE.some(r => r.test(sansAccents(p)))).join('').replace(/\s+/g, ' ').trim();
}

/**
 * La réponse du modèle local, lue strictement. Un JSON valide → texte (et mission si elle est valide) ;
 * du texte simple, court et sans JSON → ce texte, sans mission ; tout le reste (JSON cassé, texte trop long,
 * mission pour un agent inconnu : son texte pourrait l'annoncer) → null, les règles reprennent.
 */
export function lireReponseLocale(contenu: unknown): ReponseLocale | null {
  if (typeof contenu !== 'string') return null;
  const brut = contenu.trim();
  if (!brut) return null;
  let v: unknown;
  try { v = JSON.parse(brut); } catch {
    return /[{}]/.test(brut) || brut.length > MAX_REPONSE ? null : { texte: brut, mission: null };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { texte, mission } = v as Record<string, unknown>;
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/\s+/g, ' ').trim();
  if (!t || t.length > MAX_REPONSE) return null;
  if (mission == null) {
    // une phrase qui promet ce que le QG ne fait pas (« je vais lui rappeler ») est retirée ; s'il ne reste rien, les règles
    // reprennent (avec une mission, le texte du modèle n'est pas montré : le code écrit la confirmation)
    const vrai = sansFaussesPromesses(t);
    return vrai ? { texte: vrai, mission: null } : null;
  }
  const m = entreeValide(mission);
  return m ? { texte: t, mission: m } : null;
}
