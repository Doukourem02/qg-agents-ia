import type { KV } from './memoire';
import { ecrireEtat, Refus } from './qg';

// La présence de Stalker : Claude Code qui travaille avec le patron sur son Mac.
// Les crochets de Claude Code envoient un signe à chaque demande (scripts/presence-claude.mjs) ;
// seul un changement (arrivée, départ) est noté dans le journal partagé : les signes fréquents ne l'inondent jamais.

/** Les agents dont la présence vient d'une session (pas d'une routine). */
export const AGENTS_PRESENCE = ['stalker'] as const;
export const CLE_PRESENCE = (agent: string) => `qg:presence:${agent}`;
/** Sans signe depuis 15 min, la session n'est plus active (un signe arrive à chaque demande). */
export const PRESENCE_MAX = 15 * 60_000;

export type Presence = { actif: boolean; projet?: string; quand: number };

const estAgentPresence = (v: unknown): v is (typeof AGENTS_PRESENCE)[number] => typeof v === 'string' && (AGENTS_PRESENCE as readonly string[]).includes(v);

export async function lirePresence(kv: KV, agent: string): Promise<Presence | null> {
  const h = await kv.hgetall(CLE_PRESENCE(agent));
  const quand = Number(h.quand);
  if (!h.quand || !Number.isFinite(quand)) return null;
  return { actif: h.actif === '1', ...(h.projet ? { projet: h.projet } : {}), quand };
}

/** Vrai si la session est active et a donné signe de vie depuis moins de 15 min. */
export const presenceActive = (p: Presence | null, now = Date.now()) => !!p && p.actif && now - p.quand < PRESENCE_MAX;

/** Les agents de présence actifs maintenant (pour la page). */
export async function presencesActives(kv: KV, now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  for (const agent of AGENTS_PRESENCE) if (presenceActive(await lirePresence(kv, agent), now)) out.push(agent);
  return out;
}

export async function ecrirePresence(kv: KV, corps: Record<string, unknown>, now = Date.now()) {
  if (!estAgentPresence(corps.agent)) throw new Refus(`agent sans présence : ${String(corps.agent)}`);
  if (typeof corps.actif !== 'boolean') throw new Refus('« actif » doit être vrai ou faux');
  const agent = corps.agent, actif = corps.actif;
  let projet: string | undefined;
  if (corps.projet != null && corps.projet !== '') {
    if (typeof corps.projet !== 'string') throw new Refus('« projet » doit être un texte');
    projet = corps.projet.trim().slice(0, 60) || undefined;
  }
  const avant = await lirePresence(kv, agent);
  // l'arrivée compte aussi quand la session précédente s'est éteinte sans « fin » (plus de signe depuis 15 min)
  const change = actif !== presenceActive(avant, now);
  const cle = CLE_PRESENCE(agent);
  await kv.hset(cle, 'actif', actif ? '1' : '0');
  await kv.hset(cle, 'quand', String(now));
  if (projet) await kv.hset(cle, 'projet', projet); else await kv.hdel(cle, 'projet');
  const { etat } = await ecrireEtat(kv, {
    agent, statut: actif ? 'au travail' : 'termine',
    tache: actif ? `travaille avec toi${projet ? ` sur ${projet}` : ''}` : 'a fini avec toi',
    outil: 'C',
  }, now, { journal: change });
  return { presence: { actif, ...(projet ? { projet } : {}), quand: now } as Presence, etat, journal: change };
}
