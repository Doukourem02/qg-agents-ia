import 'server-only';
import type { KV } from './memoire';
import { FILE_DU_MAC, MARQUE_ISAAC, Refus, deposerMission } from './qg';
import { faitsComplets, faitsEtStatuts, lireConversation, type Tour } from './kuroro';
import { ligneHumeur } from './humeur';
import { aProposDe, controleDe, type Controle } from './kuroro-faits';
import { relire } from './kuroro-relecture';
import { agentById } from '@/sim/routing';
import { ECHEC } from '@/sim/kuroro';
import { MODELE_LOCAL, accroche, ceQuiACloche, confirmation, finLocale, formatLocal, lireReponseLocale, peutEtreUnOrdre, systemeLocal } from '@/sim/kuroro-ia';

// Kuroro par le Mac : la page (Safari, téléphone) ne peut pas appeler Ollama sur le Mac ; elle dépose sa demande ici,
// le Mac (mac/kuroro.mjs) la prend, fait parler le modèle local et renvoie la réponse, que la page vient lire.
// Le serveur garde la main sur la vérité : il construit les faits, valide strictement la réponse, dépose lui-même
// la mission et écrit la confirmation honnête (jamais le modèle). Rien du texte des messages n'est journalisé.

export const CLES_RELAIS = {
  demandes: FILE_DU_MAC,
  demande: (id: string) => `kuroro:demande:${id}`,
  reponse: (id: string) => `kuroro:reponse:${id}`,
  /** Les heures connues au moment de la demande : la réponse du Mac est relue avec (corrigerHeures). */
  controle: (id: string) => `kuroro:controle:${id}`,
  /** Posée une seule fois par demande : la réponse du Mac, son échec, ou l'expiration lue par la page. */
  prise: (id: string) => `kuroro:prise:${id}`,
  /** Le Mac vu, par tranche de 10 s (une seule écriture par tranche), quand il est réveillé. */
  macVu: (tranche: number) => `kuroro:mac-vu:${tranche}`,
  /** Le Mac allumé, par tranche de 5 min : son battement lent, quand personne n'ouvre la conversation. */
  macAllume: (tranche: number) => `kuroro:mac-allume:${tranche}`,
  /** Le réveil demandé par la page, au plus un par tranche de 30 s. */
  eveil: (tranche: number) => `kuroro:eveil:${tranche}`,
};
/** Le réveil passe par la file des demandes : au repos, le Mac ne lit qu'elle (une seule commande par passage). */
export const MARQUE_EVEIL = 'eveil';
const ALLUME_MS = 5 * 60_000;
const EVEIL_MS = 30_000;

export const TTL_S = 120;
/** Au-delà, la page a repris ses règles : la demande n'est plus remise et une réponse tardive est refusée. */
export const LIMITE_MS = 28_000;
/**
 * Une question posée sur Telegram attend plus longtemps : personne ne regarde un sablier, et le Mac au repos ne relit la
 * file que toutes les 20 s. Au-delà, le QG le dit sur Telegram et garde la question (src/server/kuroro-telegram.ts).
 */
export const LIMITE_TELEGRAM_MS = 90_000;
/** Le Mac compte comme disponible s'il a demandé la suivante il y a moins de 30 s. */
const TRANCHE_MS = 10_000;
/** Une demande remise au Mac avec moins de ce temps restant ne vaut pas la peine (la page abandonnera avant). */
const RESTE_MIN_MS = 3_000;
const MAX_FILE = 30;
const ID = /^[a-z0-9-]{1,40}$/;

/** `canal` : « telegram » pour une question posée sur Telegram (la réponse y part, src/server/kuroro-telegram.ts). */
export type Demande = { id: string; quand: number; messages: Tour[]; canal?: 'telegram' };
/** Le temps qu'une demande attend sa réponse. */
export const limiteDe = (d: Pick<Demande, 'canal'>) => (d.canal === 'telegram' ? LIMITE_TELEGRAM_MS : LIMITE_MS);
export type Lecture = { statut: 'attente' | 'expiree' } | { statut: 'prete'; texte: string; mission?: { agent: string; nom: string } };

const tranche = (now: number) => Math.floor(now / TRANCHE_MS);
const lireId = (v: unknown) => {
  if (typeof v !== 'string' || !ID.test(v)) throw new Refus('« id » invalide');
  return v;
};
const lire = <T>(brut: string | null): T | null => {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
};

export async function signalerMac(kv: KV, now = Date.now()) {
  await kv.setnx(CLES_RELAIS.macVu(tranche(now)), String(now), 40);
}

/** Le battement lent du Mac (toutes les 5 min) : allumé il y a moins de 10 min. */
export async function signalerAllume(kv: KV, now = Date.now()) {
  await kv.setnx(CLES_RELAIS.macAllume(Math.floor(now / ALLUME_MS)), String(now), 660);
}

/** Le Mac répond : vu réveillé il y a moins de 30 s, ou allumé il y a moins de 10 min (il prendra la demande à son prochain passage). */
export async function macDisponible(kv: KV, now = Date.now()) {
  const t = tranche(now);
  for (const k of [t, t - 1, t - 2]) if (await kv.get(CLES_RELAIS.macVu(k))) return true;
  const a = Math.floor(now / ALLUME_MS);
  for (const k of [a, a - 1]) if (await kv.get(CLES_RELAIS.macAllume(k))) return true;
  return false;
}

/** La page ouvre la conversation : le Mac se réveille (il relit la file toutes les 1,5 s pendant 2 min). Au plus un réveil par 30 s. */
export async function reveiller(kv: KV, now = Date.now()) {
  if (!(await kv.setnx(CLES_RELAIS.eveil(Math.floor(now / EVEIL_MS)), String(now), TTL_S))) return { reveil: false };
  await kv.lpush(CLES_RELAIS.demandes, MARQUE_EVEIL);
  await kv.ltrim(CLES_RELAIS.demandes, 0, MAX_FILE - 1);
  return { reveil: true };
}

/** La page : la conversation → { id } ; { mac: false } si le Mac n'est pas là (rien n'est stocké, la page reprend ses règles). */
export async function deposerDemande(kv: KV, corps: Record<string, unknown>, now = Date.now(), canal?: 'telegram'): Promise<{ id: string } | { mac: false }> {
  const messages = lireConversation(corps);
  if (!(await macDisponible(kv, now))) return { mac: false };
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await kv.setnx(CLES_RELAIS.demande(id), JSON.stringify({ id, quand: now, messages, ...(canal ? { canal } : {}) } satisfies Demande), TTL_S);
  await kv.lpush(CLES_RELAIS.demandes, id);
  await kv.ltrim(CLES_RELAIS.demandes, 0, MAX_FILE - 1);
  return { id };
}

/**
 * Le Mac : la plus ancienne demande encore utile, avec le prompt et les faits construits ici, et `eveil` si la page a
 * ouvert la conversation, `isaac` si une mission vient d'être confiée à Isaac (le Mac le lance tout de suite). `vu` / `allume` : le Mac signale qu'il est là (il ne le demande qu'à chaque nouvelle tranche).
 */
export async function prochaineDemande(kv: KV, now = Date.now(), { vu = false, allume = false }: { vu?: boolean; allume?: boolean } = {}) {
  if (vu) await signalerMac(kv, now);
  if (allume) await signalerAllume(kv, now);
  let eveil = false, isaac = false;
  for (let i = 0; i < MAX_FILE; i++) {
    const id = await kv.rpop(CLES_RELAIS.demandes);
    if (!id) break;
    if (id === MARQUE_EVEIL) { eveil = true; continue; }
    if (id === MARQUE_ISAAC) { isaac = true; continue; }
    const d = lire<Demande>(await kv.get(CLES_RELAIS.demande(id)));
    if (!d) continue;
    const reste = d.quand + limiteDe(d) - now;
    if (reste < RESTE_MIN_MS) continue;
    const { faits, statuts, pauses } = await faitsEtStatuts(kv, now);
    // l'humeur de mon dernier message tout à la fin : le prompt préchauffé (sans elle) reste lu jusque-là ;
    // une mission n'est possible que si mon message peut être un ordre
    const miens = d.messages.filter(t => t.role === 'moi').map(t => t.texte), dernier = miens.at(-1) ?? '';
    const utiles = aProposDe(dernier, faits);
    // gardé avec la demande : les heures permises (le filet) et le statut de chaque agent (la phrase d'une mission)
    await kv.setnx(CLES_RELAIS.controle(id), JSON.stringify({ ...controleDe(faits), statuts, pauses } satisfies Controle), TTL_S);
    const systeme = systemeLocal(faits, `${utiles ? `${utiles}\n\n` : ''}${finLocale(ligneHumeur(miens), dernier, ceQuiACloche(d.messages))}`);
    return { eveil, isaac, demande: { id, messages: d.messages, systeme, format: formatLocal(dernier), modele: MODELE_LOCAL, reste_ms: reste } };
  }
  // Réveillé sans demande : le Mac fait lire le prompt au modèle pendant que je tape (≈ 12 à 20 s pour 3 800 jetons) ;
  // mon message n'a plus qu'à être lu lui-même (≈ 2 s au lieu de plus de 20).
  if (eveil) return { eveil, isaac, demande: null, prechauffage: { modele: MODELE_LOCAL, systeme: systemeLocal(await faitsComplets(kv, now)) } };
  return { eveil, isaac, demande: null };
}

/** Prend la demande pour de bon (une seule fois) ; false si déjà prise ou expirée. */
const prendre = (kv: KV, id: string, quoi: string) => kv.setnx(CLES_RELAIS.prise(id), quoi, TTL_S);

/**
 * Le Mac : { id, texte, mission? } ou { id, echec: true }. Validation stricte (celle de la lecture du modèle local) ;
 * une mission valide est déposée ici et confirmée par le code. Toute réponse invalide vaut échec pour la page.
 */
export async function ecrireReponse(kv: KV, corps: Record<string, unknown>, now = Date.now()) {
  const id = lireId(corps.id);
  const d = lire<Demande>(await kv.get(CLES_RELAIS.demande(id)));
  if (!d) throw new Refus('demande inconnue ou expirée', 404);
  if (now - d.quand > limiteDe(d)) throw new Refus('trop tard', 409);
  const echouer = async () => { if (await prendre(kv, id, 'echec')) await kv.setnx(CLES_RELAIS.reponse(id), JSON.stringify({ echec: true }), TTL_S); };

  if (corps.echec === true) { await echouer(); return { ok: true }; }
  const lu = typeof corps.texte === 'string' ? lireReponseLocale(JSON.stringify({ texte: corps.texte, mission: corps.mission ?? null })) : null;
  if (!lu) { await echouer(); throw new Refus('réponse invalide'); }
  // une mission sur une question ou un reproche : son texte l'annonce peut-être (« je lui rappelle ») ; la page reprend ses règles
  const dernier = d.messages.filter(t => t.role === 'moi').at(-1)?.texte ?? '';
  if (lu.mission && !peutEtreUnOrdre(dernier)) { await echouer(); throw new Refus('mission sans ordre'); }
  // les filets (src/server/kuroro-relecture.ts) : une salutation écrite par le code, jamais « frère », une heure que
  // les faits ne donnent pas remplacée par la phrase exacte, une phrase répétée retirée, une excuse sans faits collés
  const controle = lire<Controle>(await kv.get(CLES_RELAIS.controle(id)));
  const relu = lu.mission ? lu.texte : relire(lu.texte, { tours: d.messages, now, controle });
  if (!relu) { await echouer(); throw new Refus('réponse sans phrase juste'); }
  if (!(await prendre(kv, id, 'reponse'))) throw new Refus('déjà traitée', 409);

  let texte = relu, mission: { agent: string; nom: string } | undefined;
  if (lu.mission) {
    try {
      const m = await deposerMission(kv, { texte: lu.mission.mission, agent: lu.mission.agent }, now);
      mission = { agent: m.agent, nom: agentById(m.agent)?.nom ?? m.agent };
      // l'accroche du modèle (« D'accord, patron. »), puis qui, où il en est et « c'est noté », écrits par le code
      texte = [accroche(lu.texte), ...confirmation(m.agent, controle?.statuts?.[m.agent], { now, pause: controle?.pauses?.[m.agent] })].join(' ');
    } catch (e) {
      console.error('kuroro : dépôt impossible', (e as Error)?.name);
      texte = ECHEC;
    }
  }
  await kv.setnx(CLES_RELAIS.reponse(id), JSON.stringify(mission ? { texte, mission } : { texte }), TTL_S);
  return mission ? { ok: true, mission } : { ok: true };
}

/** La page : où en est sa demande. Passé le délai sans réponse, l'expiration est posée (aucune réponse tardive ensuite). */
export async function lireReponse(kv: KV, idBrut: unknown, now = Date.now()): Promise<Lecture> {
  const id = lireId(idBrut);
  const r = lire<{ texte?: string; mission?: { agent: string; nom: string }; echec?: true }>(await kv.get(CLES_RELAIS.reponse(id)));
  if (r) return r.echec || !r.texte ? { statut: 'expiree' } : { statut: 'prete', texte: r.texte, ...(r.mission ? { mission: r.mission } : {}) };
  const prise = await kv.get(CLES_RELAIS.prise(id));
  if (prise === 'expiree' || prise === 'echec') return { statut: 'expiree' };
  const d = lire<Demande>(await kv.get(CLES_RELAIS.demande(id)));
  if (!d) return { statut: 'expiree' };
  if (prise || now - d.quand <= LIMITE_MS) return { statut: 'attente' };
  // la réponse est peut-être en train de s'écrire : seule la prise décide
  return (await prendre(kv, id, 'expiree')) ? { statut: 'expiree' } : { statut: 'attente' };
}
