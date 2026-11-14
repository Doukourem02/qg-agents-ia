import Anthropic from '@anthropic-ai/sdk';
import type { KV } from './memoire';
import { deposerMission, Refus } from './qg';
import { vuesQG, type VuesQG } from './vues';
import { lireConnaissances } from './connaissances';
import { aProposDe, aujourdhui, controleDe, moment, ouArrive, quand } from './kuroro-faits';
import { relire } from './kuroro-relecture';
import { ligneHumeur } from './humeur';
import { AGENTS, agentById } from '@/sim/routing';
import { FEMININ, LISENT_LES_MISSIONS, estReel } from '@/sim/kuroro';
import { faitLesMissions, missionsEnService } from '@/data/missions';
import { IDS_CONFIABLES, MAX_TEXTE, REGLES_KURORO, VERITE_CLE, accroche, ceQuiACloche, confirmation, entreeValide, suiteDe } from '@/sim/kuroro-ia';

export { IDS_CONFIABLES, VERITE_CLE, entreeValide, suiteDe };

// Kuroro converse dans la barre de mission avec Claude (Haiku) : il répond aux salutations et aux questions avec les
// seuls faits réels du QG, et ne confie une mission (outil `confier_mission`, exécuté ici, côté serveur) que sur un ordre clair.
// Sans clé, au-delà du débit, ou sur toute erreur : `{ repli: true }`, la page reprend les règles de src/sim/kuroro.ts.
// Rien du texte des messages n'est journalisé. Heure d'Abidjan = UTC.

export const MODELE = 'claude-haiku-5-5';
/** La pensée (adaptative, effort bas) compte dans ce plafond : de la place pour elle et 1 à 3 phrases. */
const MAX_TOKENS = 1024;
export const DELAI_MS = 12_000;
export const MAX_MESSAGES = 12;
/** Au plus 2 tours d'outil : 3 appels au modèle par message. */
const MAX_APPELS = 3;
export const DEBIT_PAR_MINUTE = 20;
export const CLE_DEBIT = (minute: number, n: number) => `qg:kuroro:debit:${minute}:${n}`;

export type Tour = { role: 'moi' | 'kuroro'; texte: string };
export type Reponse = { texte: string; mission?: { agent: string; nom: string } } | { repli: true };
/** Le seul morceau du client Anthropic dont Kuroro a besoin (remplacé par un faux dans les tests). */
export type ClientKuroro = {
  messages: { create(p: Anthropic.MessageCreateParamsNonStreaming, o?: { signal?: AbortSignal }): Promise<Anthropic.Message> };
};

const REPLI = { repli: true } as const;

// ───────────── La requête ─────────────

/** Le corps envoyé par la page : la conversation (les 12 derniers tours au plus), le dernier venant de moi. */
export function lireConversation(corps: Record<string, unknown>): Tour[] {
  if (!Array.isArray(corps.messages)) throw new Refus('« messages » attendu');
  const tours = corps.messages.slice(-MAX_MESSAGES).map((m: unknown) => {
    const { role, texte } = (m ?? {}) as Record<string, unknown>;
    if (role !== 'moi' && role !== 'kuroro') throw new Refus('rôle inconnu');
    if (typeof texte !== 'string' || !texte.trim()) throw new Refus('« texte » attendu');
    if (texte.length > MAX_TEXTE) throw new Refus(`« texte » trop long (${MAX_TEXTE} caractères au plus)`);
    return { role, texte: texte.trim() } as Tour;
  });
  // le modèle commence par un message de l'utilisateur
  while (tours.length && tours[0].role === 'kuroro') tours.shift();
  if (!tours.length || tours[tours.length - 1].role !== 'moi') throw new Refus('le dernier message doit venir de moi');
  return tours;
}

/** Au plus `DEBIT_PAR_MINUTE` appels par minute : chaque appel prend une place libre de la minute (setnx). */
export async function prendrePlace(kv: KV, now = Date.now()): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  for (let n = 0; n < DEBIT_PAR_MINUTE; n++) if (await kv.setnx(CLE_DEBIT(minute, n), '1', 90)) return true;
  return false;
}

// ───────────── Les faits ─────────────

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const jourUTC = (t: number) => Math.floor(t / 86_400_000);
function quandCourt(t: number, now: number) {
  const d = new Date(t), ecart = jourUTC(t) - jourUTC(now);
  const jour = ecart === 0 ? 'aujourd’hui' : ecart === -1 ? 'hier' : ecart === 1 ? 'demain' : `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${jour} ${hm(d)}`;
}
/** Jamais d'adresse web ni de mail dans les faits, ni les noms entre parenthèses (les VIP de Clara). */
const propre = (s: string) => s.replace(/https?:\/\/\S+|www\.\S+/gi, '…').replace(/[^\s@()]*@[^\s@()]+/g, '…').replace(/\s*\([^)]*\)/g, '').trim();

/**
 * Les faits réels donnés à Kuroro à chaque message, construits ici à partir des vues du QG (rien d'inventé) : pour chaque
 * agent, des phrases déjà rédigées (src/server/kuroro-faits.ts) : ce qu'il a fait aujourd'hui, où arrive son travail.
 */
export function faitsKuroro(vues: VuesQG, now = vues.maintenant) {
  const cerveau = new Map(vues.cerveau.agents.map(c => [c.agent, c.phrases.map(propre).filter(Boolean)]));
  const nomDe = (id: string) => agentById(id)?.nom ?? id;
  // L'heure en dernier : elle change chaque minute, et le modèle local relit tout ce qui suit le premier changement
  // (≈ 90 à 180 jetons par seconde sur le Mac). Tout ce qui la précède reste identique et déjà lu : aucune phrase ne
  // compte en minutes, et le dernier signe d'un agent qui passe en continu (Luffy, toutes les 5 min) n'y est pas.
  // Le prompt reste court : rien de ce que les règles disent déjà (la vérité sur les missions, « au repos »), seulement
  // le rôle des agents simulés. La journée de chacun (« aujourd_hui ») vient à part, juste avant l'heure : elle change
  // plus souvent que le reste, et un petit modèle suit mieux ce qu'il lit en dernier.
  const avecHoraires = AGENTS.filter(a => estReel(a.id) || a.id === 'kuroro');
  const journee = new Map(avecHoraires.map(a => [a.id, aujourdhui(a.id, vues, now)]));
  return {
    astreinte_cette_nuit: nomDe(vues.astreinte),
    ...(vues.taches.alerte ? { alerte: propre(vues.taches.alerte.texte) } : {}),
    agents: AGENTS.map(a => {
      const reel = estReel(a.id), etat = vues.agents.find(e => e.agent === a.id);
      if (!reel && a.id !== 'kuroro') return { id: a.id, nom: a.nom, role: a.role, en_service: false, ...(vues.presences.includes(a.id) ? { present_maintenant: true } : {}) };
      const faits = cerveau.get(a.id) ?? [], ou = ouArrive(a.id, now);
      const dernier = etat?.dernierPassage;
      // le dernier passage, s'il n'est pas déjà dit dans « aujourd_hui » (« fait aujourd'hui à 07:38 »)
      const dejaDit = !!dernier && (journee.get(a.id) ?? []).some(p => p.includes(`fait aujourd’hui à ${hm(new Date(dernier.quand))}`));
      return {
        id: a.id, nom: a.nom, role: a.role, travail: a.competences.slice(0, 3).join(', '),
        ...(a.id === 'kuroro' ? { c_est_toi: true } : { en_service: true }),
        ...(FEMININ.includes(a.id) ? { elle: true } : {}),
        ...(LISENT_LES_MISSIONS.includes(a.id) && (!faitLesMissions(a.id) || missionsEnService(now)) ? { lit_les_missions_de_la_barre: true } : {}),
        ...(vues.presences.includes(a.id) ? { present_maintenant: true } : {}),
        ...(etat ? {
          ...(etat.statut !== 'au repos' ? { statut: etat.statut } : {}),
          ...(etat.tache ? { tache: propre(etat.tache) } : {}),
          ...(etat.rythme ? { rythme: etat.rythme } : dejaDit ? {} : {
            dernier_passage: dernier ? `${quandCourt(dernier.quand, now)} : ${propre(dernier.texte)}` : 'aucun',
          }),
          ...(etat.surDemande ? { sur_demande: true } : {}),
          ...(etat.note ? { note: propre(etat.note) } : {}),
          ...(etat.pause ? { pause: etat.pause } : {}),
        } : {}),
        ...(ou.length ? { ou_arrive: ou } : {}),
        ...(faits.length ? { faits } : {}),
      };
    }),
    // ce qui attend le patron, en une liste : la réponse toute prête à « y a un truc urgent ? »
    ce_qui_t_attend: vues.taches.enAttente.length
      ? vues.taches.enAttente.map(e => `${nomDe(e.agent)} : ${propre(`${e.nombre ? `${e.nombre} ` : ''}${e.texte}`)}.`)
      : ['Rien ne t’attend.'],
    aujourd_hui: Object.fromEntries(avecHoraires.flatMap(a => {
      const j = journee.get(a.id) ?? [];
      return j.length ? [[a.id === 'kuroro' ? 'Kuroro (toi)' : a.nom, j]] : [];
    })),
    heure_abidjan: moment(now),
  };
}

/**
 * Où en est chaque vrai agent, en une phrase écrite par le code (jamais par le modèle) : elle vient dans la réponse à
 * une demande, après « c'est X qui s'en occupe ». Au travail en ce moment, son prochain passage, son rythme, ou ce qui
 * l'empêche de passer ; rien s'il n'y a rien de sûr à dire. Pour Isaac (il lit les missions), la suite dit déjà quand.
 */
export function statutsMission(vues: VuesQG, now = vues.maintenant): Record<string, string> {
  return Object.fromEntries(vues.agents.flatMap(e => {
    // en pause : la suite le dit (src/sim/kuroro-ia.ts, confirmation)
    if (e.pause) return [];
    const P = FEMININ.includes(e.agent) ? 'Elle' : 'Il', p = P.toLowerCase();
    const morceaux: string[] = [];
    if (e.statut === 'au travail') morceaux.push(`${P} est au travail en ce moment${e.tache ? ` (${propre(e.tache)})` : ''}.`);
    else if (e.note) morceaux.push(`En ce moment, ${propre(e.note)}.`);
    else if (e.statut === 'bloque') morceaux.push(`Son dernier passage prévu aujourd’hui n’a pas eu lieu.`);
    if (e.statut !== 'au travail' && !e.note) {
      if (e.prochainPassage && e.prochainPassage.quand > now) morceaux.push(`Son prochain passage : ${e.prochainPassage.titre}, ${quand(e.prochainPassage.quand, now)}.`);
      else if (e.rythme && !LISENT_LES_MISSIONS.includes(e.agent)) morceaux.push(`${P} passe ${e.rythme}.`);
      else if (e.surDemande) morceaux.push(`${P} n’a pas de passage prévu : ${p} agit quand tu touches un bouton.`);
    }
    return morceaux.length ? [[e.agent, morceaux.join(' ')]] : [];
  }));
}

/** Les agents en pause (décidée par le patron), avec la phrase de la page : la suite d'une mission le dit. */
export const pausesMission = (vues: VuesQG): Record<string, string> =>
  Object.fromEntries(vues.agents.flatMap(e => (e.pause ? [[e.agent, e.pause]] : [])));

/** Les faits complets, le statut et la pause de chaque agent, d'une seule lecture des vues. */
export async function faitsEtStatuts(kv: KV, now = Date.now()) {
  const [vues, connaissances] = await Promise.all([vuesQG(kv, now), lireConnaissances(kv)]);
  return { faits: { connaissances: sansRoutines(connaissances), ...faitsKuroro(vues, now) }, statuts: statutsMission(vues, now), pauses: pausesMission(vues) };
}

/**
 * Les faits en direct, plus ce que Kuroro sait du projet et des personnages (KV si présent, sinon le dépôt).
 * Les connaissances d'abord : elles changent rarement, donc le début du prompt reste identique d'un message à l'autre
 * et le modèle local le garde en mémoire au lieu de le relire (réponse plus rapide). L'heure, qui change, vient en dernier.
 */
export async function faitsComplets(kv: KV, now = Date.now()) {
  return (await faitsEtStatuts(kv, now)).faits;
}

/**
 * Les horaires des agents réels (et de Kuroro) viennent du code (« aujourd_hui », « ou_arrive »), toujours justes :
 * la « routine » de leur fiche (Notion, une fois par semaine) est retirée, elle ne peut que dire moins ou se contredire.
 */
export function sansRoutines<C extends { personnages: { id: string; routine?: string }[] }>(c: C): C {
  const aHoraires = (id: string) => estReel(id) || id === 'kuroro';
  return {
    ...c,
    personnages: c.personnages.map(p => {
      if (!aHoraires(p.id) || p.routine === undefined) return p;
      const reste = { ...p };
      delete reste.routine;
      return reste;
    }),
  };
}

// ───────────── Le prompt et l'outil ─────────────

export const SYSTEME = `${REGLES_KURORO}

Pour confier une mission, appelle l'outil confier_mission (jamais pour une salutation, une question ni un reproche), avec au plus une courte accroche en texte (« D'accord, patron. ») : le QG écrit lui-même qui s'en occupe, où il en est et « c'est noté ».`;

export const OUTIL: Anthropic.Tool = {
  name: 'confier_mission',
  description: 'Confie une mission à un agent du QG. Seulement quand le patron donne clairement un ordre ou une mission ; jamais pour une salutation ni pour une question.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      agent: { type: 'string', enum: IDS_CONFIABLES, description: 'L’id de l’agent dont c’est le rôle (voir les faits du QG).' },
      mission: { type: 'string', description: 'La mission, en une phrase courte, telle que le patron la demande (300 caractères au plus).' },
    },
    required: ['agent', 'mission'],
    additionalProperties: false,
  },
};

// ───────────── La conversation ─────────────

type Deps = { client: ClientKuroro | null; kv: KV; now?: number };

/** Un message du patron → la réponse de Kuroro (et la mission confiée, s'il y en a une), ou `{ repli: true }`. */
export async function converser(corps: Record<string, unknown>, { client, kv, now = Date.now() }: Deps): Promise<Reponse> {
  const tours = lireConversation(corps);
  // /demo ne parle jamais à Claude et ne dépose rien
  if (corps.demo === true || !client) return REPLI;
  if (!(await prendrePlace(kv, now))) return REPLI;

  const { faits, statuts, pauses } = await faitsEtStatuts(kv, now);
  const miens = tours.filter(t => t.role === 'moi').map(t => t.texte), utiles = aProposDe(miens.at(-1) ?? '', faits);
  const cloche = ceQuiACloche(tours);
  const system = `${SYSTEME}\n\nLes faits du QG maintenant (heure d'Abidjan = UTC) :\n${JSON.stringify(faits)}\n\n${utiles ? `${utiles}\n\n` : ''}${ligneHumeur(miens)}${cloche ? `\nCe qui a cloché dans l'échange : ${cloche}.` : ''}`;
  const messages: Anthropic.MessageParam[] = tours.map(t => ({ role: t.role === 'moi' ? 'user' : 'assistant', content: t.texte }));
  const signal = AbortSignal.timeout(DELAI_MS);
  const textes = (r: Anthropic.Message) => r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join(' ').replace(/\s+/g, ' ').trim();

  try {
    for (let appel = 0; appel < MAX_APPELS; appel++) {
      const r = await client.messages.create({
        model: MODELE, max_tokens: MAX_TOKENS, system, messages,
        output_config: { effort: 'low' },
        // plus d'outil au dernier appel : il doit répondre en texte
        ...(appel < MAX_APPELS - 1 ? { tools: [OUTIL] } : {}),
      }, { signal });
      if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return REPLI;
      if (r.stop_reason !== 'tool_use') {
        // les mêmes filets que pour le modèle local (salutation, « frère », phrase répétée, excuse sans faits collés)
        const texte = relire(textes(r), { tours, now, controle: controleDe(faits) });
        return texte ? { texte } : REPLI;
      }
      messages.push({ role: 'assistant', content: r.content });
      const resultats: Anthropic.ToolResultBlockParam[] = [];
      for (const b of r.content) {
        if (b.type !== 'tool_use') continue;
        const entree = b.name === 'confier_mission' ? entreeValide(b.input) : null;
        if (!entree) { resultats.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Entrée invalide : rien n’a été confié.' }); continue; }
        // une seule mission par message : la première valide est déposée, et la réponse est écrite par le code
        // (l'accroche du modèle, puis qui s'en occupe, où il en est, « c'est noté » et la vraie suite)
        const m = await deposerMission(kv, { texte: entree.mission, agent: entree.agent }, now);
        const agent = agentById(m.agent)!;
        return { texte: [accroche(textes(r)), ...confirmation(agent.id, statuts[agent.id], { now, pause: pauses[agent.id] })].join(' '), mission: { agent: agent.id, nom: agent.nom } };
      }
      messages.push({ role: 'user', content: resultats });
    }
    return REPLI;
  } catch (e) {
    // jamais le texte des messages dans les journaux : seulement la nature de l'erreur
    console.error('kuroro : appel à Claude impossible', e instanceof Anthropic.APIError ? e.status : (e as Error)?.name);
    return REPLI;
  }
}

let client: Anthropic | null = null;
/** Le vrai client, seulement si la clé existe (posée dans Vercel). */
export function clientKuroro(): ClientKuroro | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: DELAI_MS, maxRetries: 1 });
  return client;
}
