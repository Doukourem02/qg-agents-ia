import type { KV } from './memoire';
import { CLES_RELAIS, LIMITE_TELEGRAM_MS, TTL_S, deposerDemande } from './kuroro-relais';
import { MAX_MESSAGES, converser, type ClientKuroro, type Tour } from './kuroro';
import { MAX_TEXTE } from '@/sim/kuroro-ia';
import { hhmm } from '@/data/crise';

// Parler au QG sur Telegram : un message libre du patron (pas une commande, src/server/telegram-commandes.ts) va à
// Kuroro, avec le même cerveau que la barre de mission : Claude si la clé existe (src/server/kuroro.ts), sinon le modèle
// local du Mac par le relais (src/server/kuroro-relais.ts : faits rédigés, filets, mission déposée par le serveur et
// phrase « qui / statut / c'est noté » écrite par le code). La réponse part sur Telegram quand le Mac l'a rendue.
// Mac éteint ou muet : une réponse honnête du code, et la question est gardée (redonnée au Mac dès qu'il revient).
// Un seul échange à la fois ; la conversation garde ses 12 derniers tours, comme la page, et s'oublie après 6 h de calme.
// Aucun texte de message n'est journalisé.

export const CLE_KT = 'kuroro:telegram';
const OUBLI_MS = 6 * 3_600_000;
/** Une question gardée plus d'un jour n'est plus redonnée (elle n'a plus de sens). */
const GARDE_MS = 24 * 3_600_000;
/** Une réponse à une question posée il y a plus de 5 min rappelle la question. */
const RAPPEL_QUESTION_MS = 5 * 60_000;

export const MAC_ETEINT = 'Mon cerveau est sur ton Mac, il est éteint : je te réponds dès qu\'il revient.';
export const MAC_MUET = 'Mon cerveau sur ton Mac ne m\'a pas répondu à temps : je garde ta question et je te réponds dès qu\'il revient.';
export const UN_A_LA_FOIS = 'Je réfléchis encore à ton message d\'avant : renvoie celui-ci dans un instant.';
export const PAS_SU = 'Je n\'ai pas su te répondre cette fois : redemande-moi autrement, ou regarde la page.';
export const TROP_LONG = `Ton message est trop long pour moi : ${MAX_TEXTE} caractères au plus.`;

/** La question remise au Mac : son id, quand elle est partie, et quand le patron l'a posée. */
type Encours = { id: string; quand: number; posee: number; texte: string };
type Garde = { texte: string; quand: number };
export type EtatKT = { tours: Tour[]; quand: number; encours: Encours | null; garde: Garde | null };

const lire = <T>(brut: string | undefined | null): T | null => {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
};

export async function lireEtatKT(kv: KV): Promise<EtatKT> {
  const h = await kv.hgetall(CLE_KT);
  return { tours: lire<Tour[]>(h.tours) ?? [], quand: Number(h.quand) || 0, encours: lire<Encours>(h.encours), garde: lire<Garde>(h.garde) };
}

const recents = (e: EtatKT, now: number) => (now - e.quand > OUBLI_MS ? [] : e.tours);

async function retenir(kv: KV, tours: Tour[], now: number) {
  // une réponse longue est coupée : la conversation relue reste valide (300 caractères par tour au plus)
  const gardes = tours.slice(-MAX_MESSAGES).map(t => ({ role: t.role, texte: t.texte.slice(0, MAX_TEXTE) }));
  await kv.hset(CLE_KT, 'tours', JSON.stringify(gardes));
  await kv.hset(CLE_KT, 'quand', String(now));
}

export type DepsKT = {
  envoyer: (texte: string) => Promise<unknown>;
  /** Claude (seulement si la clé existe) ; null : le Mac par le relais. */
  client?: ClientKuroro | null;
};

/** Remet la question au Mac ; false s'il n'est pas là. */
async function remettre(kv: KV, e: EtatKT, texte: string, posee: number, now: number): Promise<boolean> {
  const d = await deposerDemande(kv, { messages: [...recents(e, now), { role: 'moi', texte }] }, now, 'telegram');
  if (!('id' in d)) return false;
  await kv.hset(CLE_KT, 'encours', JSON.stringify({ id: d.id, quand: now, posee, texte } satisfies Encours));
  await kv.hdel(CLE_KT, 'garde');
  return true;
}

/**
 * Un message libre du patron → la réponse de Kuroro (Claude), ou null (le Mac répondra par Telegram), ou une réponse
 * honnête du code (Mac éteint, un échange déjà en cours, message trop long). Jamais un silence.
 */
export async function parlerAKuroro(kv: KV, texte: string, deps: DepsKT, now = Date.now()): Promise<string | null> {
  const t = texte.trim();
  if (t.length > MAX_TEXTE) return TROP_LONG;
  const e = await lireEtatKT(kv);
  if (e.encours && now - e.encours.quand <= LIMITE_TELEGRAM_MS) return UN_A_LA_FOIS;
  if (e.encours) await kv.hdel(CLE_KT, 'encours'); // muette depuis trop longtemps : la nouvelle question la remplace

  const tours: Tour[] = [...recents(e, now), { role: 'moi', texte: t }];
  if (deps.client) {
    const r = await converser({ messages: tours }, { client: deps.client, kv, now });
    if ('texte' in r) {
      await retenir(kv, [...tours, { role: 'kuroro', texte: r.texte }], now);
      await kv.hdel(CLE_KT, 'garde');
      return r.texte;
    }
  }
  if (await remettre(kv, e, t, now, now)) return null;
  // le Mac n'est pas là : la question est gardée (la dernière seulement), redonnée dès qu'il revient
  await kv.hset(CLE_KT, 'garde', JSON.stringify({ texte: t, quand: now } satisfies Garde));
  return MAC_ETEINT;
}

/**
 * Après la réponse du Mac (route /api/agents/kuroro/reponse) : si c'était la question de Telegram, la réponse y part (ou
 * « je n'ai pas su », sur un échec). true si quelque chose est parti.
 */
export async function livrerTelegram(kv: KV, id: string, deps: Pick<DepsKT, 'envoyer'>, now = Date.now()): Promise<boolean> {
  const e = await lireEtatKT(kv);
  if (!e.encours || e.encours.id !== id) return false;
  const r = lire<{ texte?: string; echec?: true }>(await kv.get(CLES_RELAIS.reponse(id)));
  if (!r) return false;
  const q = e.encours;
  await kv.hdel(CLE_KT, 'encours');
  if (!r.texte) { await deps.envoyer(PAS_SU); return true; }
  await retenir(kv, [...recents(e, now), { role: 'moi', texte: q.texte }, { role: 'kuroro', texte: r.texte }], now);
  const rappel = now - q.posee > RAPPEL_QUESTION_MS ? `Ta question de ${hhmm(q.posee)} (« ${q.texte.slice(0, 80)} ») :\n` : '';
  await deps.envoyer(rappel + r.texte);
  return true;
}

/**
 * À chaque passage de Luffy (5 min) : une question remise au Mac et restée sans réponse passé le délai est gardée, et
 * Le patron le sait (une seule fois). Une réponse arrivée mais pas encore livrée part.
 */
export async function suivreKuroroTelegram(kv: KV, deps: Pick<DepsKT, 'envoyer'>, now = Date.now()): Promise<void> {
  const e = await lireEtatKT(kv);
  if (!e.encours) return;
  if (await livrerTelegram(kv, e.encours.id, deps, now)) return;
  if (now - e.encours.quand <= LIMITE_TELEGRAM_MS) return;
  // la réponse est peut-être en train de s'écrire : seule la prise décide (comme pour la page)
  if (!(await kv.setnx(CLES_RELAIS.prise(e.encours.id), 'expiree', TTL_S)) && (await kv.get(CLES_RELAIS.prise(e.encours.id))) === 'reponse') return;
  await kv.hdel(CLE_KT, 'encours');
  await kv.hset(CLE_KT, 'garde', JSON.stringify({ texte: e.encours.texte, quand: e.encours.posee } satisfies Garde));
  await deps.envoyer(MAC_MUET);
}

/** Le Mac revient (il signale qu'il est là) : la question gardée lui est remise. true si elle est repartie. */
export async function redonnerGarde(kv: KV, now = Date.now()): Promise<boolean> {
  const e = await lireEtatKT(kv);
  if (!e.garde || e.encours) return false;
  if (now - e.garde.quand > GARDE_MS) { await kv.hdel(CLE_KT, 'garde'); return false; }
  return remettre(kv, e, e.garde.texte, e.garde.quand, now);
}
