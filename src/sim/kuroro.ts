// Kuroro répond dans la barre de mission. Des règles simples et honnêtes, sans IA : fonctions pures, testées à part.
// Une salutation ou une discussion n'est jamais envoyée comme mission ; une mission est aiguillée par le vrai routage (routeMission) ;
// les boutons des agents ne viennent que pour un vrai ordre sans mot-clé.
// Heure d'Abidjan = UTC.

import { AGENTS_REELS } from '@/data/reels';
import { AGENTS_MISSIONS, faitLesMissions, phraseDelai } from '@/data/missions';
import { agentById, poleById, routeMission, type Agent, type Pole } from './routing';
import { agentDe, annonce, lireActionsImmediates } from './actions-immediates';

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SALUTS = ['bonjour', 'bonsoir', 'salut', 'hello', 'coucou', 'yo', 'hey', 'hi', 'bjr', 'slt', 'bonjours'];
const MERCIS = ['merci', 'mercii', 'thanks', 'thx'];
/** Les petits mots autour d'une salutation (« salut Kuroro, ça va ? ») : ils ne font pas une mission. */
const REMPLISSAGE = ['kuroro', 'lucifer', 'patron', 'boss', 'chef', 'toi', 'tu', 'vas', 'va', 'ca', 'comment', 'bien', 'et', 'le', 'la', 'a', 'beaucoup', 'encore', 'bcp', 'mon', 'ami', 'pour', 'tout', 'top', 'super', 'oui', 'ok', 'cool'];

export type Petit = { salut: boolean; merci: boolean; cava: boolean };

/** Ce que dit la phrase si ce n'est qu'un mot gentil (salut, merci, ça va ?) ; null si c'est une mission. */
export function petitMot(texte: string): Petit | null {
  const t = sansAccents(texte);
  const mots = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (!mots.length) return null;
  const salut = mots.some(m => SALUTS.includes(m));
  const merci = mots.some(m => MERCIS.includes(m));
  const cava = /\bca va\b|\bcomment (tu )?vas?\b|\bcomment ca va\b/.test(t.replace(/[^a-z0-9]+/g, ' '));
  if (!salut && !merci && !cava) return null;
  const restants = mots.filter(m => !SALUTS.includes(m) && !MERCIS.includes(m) && !REMPLISSAGE.includes(m));
  return restants.length === 0 ? { salut, merci, cava } : null;
}

/** Bonjour de 4 h à 18 h (à 4 h du matin, on est déjà le lendemain), bonsoir sinon. */
export const estJourPourSalut = (now: number) => { const h = new Date(now).getUTCHours(); return h >= 4 && h < 18; };

/** La question qui suit un salut ou une excuse : ce que le patron attend de Kuroro. */
export const QUE_FAIRE = 'Qu’est-ce que je peux faire pour toi ?';

/**
 * Les réponses de Kuroro à un mot gentil, selon l'heure d'Abidjan : il répond à la salutation (Le patron est son patron,
 * jamais « frère »), puis lui demande ce qu'il attend de lui. Écrites par le code : le serveur les reprend telles quelles.
 */
export function repondrePetitMot(p: Petit, now = Date.now()): string[] {
  const salut = p.salut ? (estJourPourSalut(now) ? 'Bonjour patron' : 'Bonsoir patron') : '';
  if (p.merci) return [salut ? `${salut}, avec plaisir.` : 'Avec plaisir, patron.', 'Il te faut autre chose ?'];
  if (p.cava) return [salut ? `${salut}, je vais bien, merci.` : 'Je vais bien, merci.', QUE_FAIRE];
  return [`${salut}.`, QUE_FAIRE];
}

export const FEMININ = ['clara', 'mafe', 'lea', 'malenia', 'ye'];
const pronom = (id: string) => (FEMININ.includes(id) ? 'Elle' : 'Il');
/** « de Luffy », « d’Isaac ». */
export const de = (nom: string) => (/^[aeiouyhéèêàâîôû]/i.test(nom) ? `d’${nom}` : `de ${nom}`);
export const estReel = (id: string) => (AGENTS_REELS as readonly string[]).includes(id);

/**
 * Le peu qu'il faut d'un vrai agent (lu dans les vues du QG, absent dans /demo) : son prochain passage, et sa pause
 * décidée par le patron (« en pause (par toi) jusqu’à lundi 16 à 00:00 »).
 */
export type Passages = { agent: string; prochainPassage: { quand: number } | null; pause?: string }[] | null | undefined;

/**
 * Les agents qui lisent vraiment les missions : Isaac (le relais du Mac) et ceux dont la routine « QG · missions » fait
 * les missions (src/data/missions.ts). Luffy et Zoro ne font, à la demande, que leurs actions immédiates.
 */
export const LISENT_LES_MISSIONS = ['isaac', ...AGENTS_MISSIONS] as string[];

/** Quand l'agent s'en occupe : seulement ce qui est vrai pour lui (l'heure compte) ; null s'il n'y a rien de sûr à dire. */
export function quandLigne(id: string, passages: Passages, now = Date.now()): string | null {
  const pause = passages?.find(p => p.agent === id)?.pause;
  if (pause && estReel(id)) return `${agentById(id)?.nom ?? id} est ${pause} : la mission l’attend sur sa fiche, pour sa reprise.`;
  if (id === 'isaac') return 'Il te répond sur Telegram dans une minute environ, si ton Mac est allumé.';
  if (id === 'luffy') return 'À la demande, il ne fait que vérifier tes sites tout de suite (écris « vérifie mes sites ») : cette mission-ci reste sur sa fiche.';
  if (id === 'zoro') return 'À la demande, il ne fait que refaire le tour de sécurité tout de suite (écris « refais le tour de sécurité ») : cette mission-ci reste sur sa fiche.';
  if (faitLesMissions(id)) return phraseDelai(pronom(id), now);
  if (estReel(id)) return `${pronom(id)} ne lit pas encore les missions de la barre : ${pronom(id).toLowerCase()} la verra sur sa fiche.`;
  return null;
}

// ───────────── La discussion sans ordre ─────────────

/** Ce que les règles savent de la boîte en direct (lu dans les vues du QG, absent dans /demo). */
export type Boite = { agents: { statut: string }[]; enAttente: { agent: string; texte: string; nombre?: number }[] };

const norme = (s: string) => sansAccents(s).replace(/[’'`-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Les verbes qui, en tête de phrase, font un ordre (« vide le cache », « prépare un truc »). */
const VERBES = new Set(('vide trie fais lance relance verifie check nettoie envoie ecris redige publie poste prepare cherche trouve regarde '
  + 'mets ajoute supprime efface range classe archive corrige repare installe desinstalle surveille montre donne fixe planifie '
  + 'programme rappelle occupe demande dis ouvre ferme reponds organise analyse resume traduis calcule compare teste deploie '
  + 'sauvegarde copie note garde active desactive arrete demarre libere optimise reserve appelle contacte previens signale liste '
  + 'compte mesure telecharge change modifie renomme deplace bloque debloque relis lis aide confie transmets gere regle').split(' '));
/** Les mots qu'on peut dire avant l'ordre (« salut Kuroro, vide… », « bon, alors lance… »). */
const AVANT = new Set(['salut', 'bonjour', 'bonsoir', 'hello', 'coucou', 'hey', 'yo', 'kuroro', 'lucifer', 'boss', 'chef', 'patron', 'stp', 'svp',
  'alors', 'bon', 'ok', 'okay', 'et', 'puis', 'aussi', 'maintenant', 'donc', 'please', 'eh', 'oh', 'allez', 'sinon', 'bref', 'mais']);
/** Les tournures d'une demande, où qu'elles soient. */
const DEMANDES = [
  /\b(peux|pourrais|pourras|veux|voudrais) tu\b/, /\btu (peux|pourrais|pourras|veux bien)\b/, /\bil (faut|faudrait|faudra)\b/,
  /\boccupe toi\b/, /(?<!\b(je|tu) )\bfais\b/, /\b(dis|demande) a\b/, /\bmerci de\b/, /\b(j ai besoin|je veux|je voudrais|j aimerais) que\b/,
  /\bs il te plait\b/,
];

/** La phrase ressemble à un ordre : un verbe à l'impératif en tête d'une proposition, ou une tournure de demande. */
export function estOrdre(texte: string): boolean {
  const t = norme(texte);
  if (DEMANDES.some(r => r.test(t))) return true;
  return t.split(/[,.;:!?…\n]+|\bet\b|\bpuis\b/).some(prop => {
    const mots = prop.split(/[^a-z0-9]+/).filter(Boolean);
    const premier = mots.find(m => !AVANT.has(m));
    return !!premier && VERBES.has(premier);
  });
}

/** Les petites phrases de discussion (« je te salue », « je vais bien », « je prends de tes nouvelles »…). */
const VA_BIEN = /\bje vais (\w+ ){0,2}bien\b|\bca va (\w+ ){0,2}bien\b|\btout va bien\b/;
const NOUVELLES = /\b(prends?|prendre) de tes nouvelles\b|\bcomment tu geres\b|\bquoi de neuf\b|\btu vas bien\b|\bcomment ca se passe\b|\bca roule\b|\bcomment va la boite\b/;
const SALUE = /\bje te salu(e|t|es)?\b|\bje passais\b|\bjuste un (petit )?coucou\b/;
const bavardage = (t: string) => VA_BIEN.test(t) || NOUVELLES.test(t) || SALUE.test(t);
const QUESTION = /\?\s*$|^(qui|quoi|quand|comment|pourquoi|combien|quel|quelle|quels|quelles|est ce que|ou)\b/;

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** « La boîte tourne : 6 agents en service, 1 au travail, 1 site en panne. » : seulement ce que disent les vues. */
export function ligneBoite(b: Boite): string {
  const travail = b.agents.filter(a => a.statut === 'au travail').length;
  const retard = b.agents.filter(a => a.statut === 'bloque').length;
  const panne = b.enAttente.filter(e => e.agent === 'luffy' && /panne/.test(e.texte)).reduce((n, e) => n + (e.nombre ?? 1), 0);
  const parts = [
    ...(travail ? [`${travail} au travail`] : []),
    ...(retard ? [`${retard} en retard`] : []),
    ...(panne ? [`${pluriel(panne, 'site')} en panne`] : []),
  ];
  return `La boîte tourne : ${pluriel(b.agents.length, 'agent')} en service, ${parts.length ? parts.join(', ') : 'tout est calme'}.`;
}

const PAS_COMPRIS = 'Pardon patron, je n’ai pas compris : mon IA ne répond pas en ce moment.';
const COMMENT_DEMANDER = 'Redis-le-moi en une commande simple (« vérifie mes sites », « mets Ye en pause », « reprends L »), ou réessaie dans un instant.';

/** Une réponse naturelle à une phrase sans ordre, avec les vrais faits : jamais de mission ni de boutons. */
export function repondreDiscussion(texte: string, { now = Date.now(), boite }: { now?: number; boite?: Boite | null } = {}): string[] {
  const t = norme(texte);
  const mots = t.split(/[^a-z0-9]+/);
  const salut = mots.some(m => SALUTS.includes(m)) || SALUE.test(t);
  const accueil = VA_BIEN.test(t) ? 'Content de savoir que tu vas bien.'
    : NOUVELLES.test(t) ? 'Ça roule de mon côté, merci de demander.'
    : !salut && QUESTION.test(t) ? 'Je n’ai pas de réponse précise à ça sans mon IA.'
    : salut ? 'Content de te lire.'
    // ni salut, ni nouvelles, ni question : c'est sans doute une demande, et sans mon IA je ne la comprends pas.
    // Je le dis, au lieu de répondre à côté (« Bah contacte-le, c'est une urgence » ne doit jamais recevoir « Content de te lire »).
    : PAS_COMPRIS;
  if (accueil === PAS_COMPRIS) return [PAS_COMPRIS, COMMENT_DEMANDER];
  const debut = salut ? `${estJourPourSalut(now) ? 'Bonjour' : 'Bonsoir'} patron. ${accueil}` : accueil;
  return [debut, ...(boite ? [ligneBoite(boite)] : []), QUE_FAIRE];
}

export type Decision =
  | { type: 'petit'; lignes: string[] }
  /** Aucun mot-clé : Kuroro demande à qui confier la mission (les vrais agents seulement). */
  | { type: 'choix'; lignes: string[]; choix: string[] }
  /** Une mission à déposer ; `lignes` ne se disent qu'une fois le dépôt réussi. */
  | { type: 'mission'; agent: Agent; pole: Pole; reel: boolean; lignes: string[] };

export const ECHEC = 'Je n’arrive pas à joindre l’équipe pour l’instant, réessaie dans un moment.';

/** Ce que Kuroro fait de la phrase reçue. `demo` : pas de « quand » (rien n'est vraiment envoyé). */
export function decider(texte: string, { passages, now = Date.now(), demo = false, boite }: { passages?: Passages; now?: number; demo?: boolean; boite?: Boite | null } = {}): Decision {
  const p = petitMot(texte);
  if (p) return { type: 'petit', lignes: repondrePetitMot(p, now) };
  // une action immédiate (« vérifie mes sites », « mets Ye en pause ») : le serveur la fait au dépôt, jamais en /demo
  const actions = demo ? [] : lireActionsImmediates(texte, now);
  if (actions.length) {
    const agent = agentById(agentDe(actions[0]))!;
    return { type: 'mission', agent, pole: poleById(agent.pole)!, reel: true, lignes: actions.map(a => annonce(a, 'page', now)) };
  }
  // une discussion ou une question sans ordre n'est jamais une mission
  const ordre = estOrdre(texte), t = norme(texte);
  const discussion = (): Decision => ({ type: 'petit', lignes: repondreDiscussion(texte, { now, boite }) });
  if (!ordre && (bavardage(t) || QUESTION.test(t))) return discussion();
  const { agent, pole } = routeMission(texte);
  if (agent.id === 'kuroro') {
    // les boutons seulement pour un vrai ordre, sans mot-clé pour l'aiguiller
    if (!ordre) return discussion();
    return { type: 'choix', lignes: ['Je n’ai pas bien compris à qui confier ça. Choisis :'], choix: [...AGENTS_REELS] };
  }
  const reel = estReel(agent.id);
  if (!reel) {
    return { type: 'mission', agent, pole, reel, lignes: [`C’est le rôle ${de(agent.nom)}, mais ${pronom(agent.id).toLowerCase()} n’est pas encore en service : c’est noté, je garde ta mission de côté.`] };
  }
  const quand = demo ? null : quandLigne(agent.id, passages, now);
  return { type: 'mission', agent, pole, reel, lignes: [`C’est ${agent.nom} qui s’en occupe (${pole.nom}). C’est noté, je me charge de l’informer.`, ...(quand ? [quand] : [])] };
}

/** Après un choix par bouton : Kuroro confirme à qui il confie la mission. */
export function confirmerChoix(agent: Agent, pole: Pole, { passages, now = Date.now(), demo = false }: { passages?: Passages; now?: number; demo?: boolean } = {}): string[] {
  const quand = demo ? null : quandLigne(agent.id, passages, now);
  return [`C’est noté : c’est ${agent.nom} qui s’en occupe (${pole.nom}), je me charge de l’informer.`, ...(quand ? [quand] : [])];
}
