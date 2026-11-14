import type { KV } from './memoire';
import { Refus } from './qg';
import { agentById } from '@/sim/routing';

// Les accords (phase 2) : un agent demande mon accord avant toute action qui sort du QG ;
// je réponds sur WhatsApp (OK, non, modifie : …) ; l'agent lit la décision. Fonctions pures autour d'un KV.

export const CLES_ACCORDS = {
  tous: 'qg:accords',
  attente: 'qg:accords:attente',
  message: (id: string) => `qg:wa:msg:${id}`,
  cle: (cle: string) => `qg:accords:cle:${cle}`,
};

export type Decision = 'en attente' | 'accepte' | 'refuse' | 'modifie' | 'annule';
export type Accord = {
  id: string; agent: string; action: string; resume: string;
  statut: Decision; detail?: string; demande: number; repondu?: number; cle?: string;
};

const court = (v: unknown, nom: string, max: number) => {
  if (typeof v !== 'string' || !v.trim()) throw new Refus(`« ${nom} » manquant`);
  const t = v.trim();
  if (t.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return t;
};

/** Un agent demande un accord. `cle` (facultative) évite de demander deux fois la même chose. */
export async function demanderAccord(kv: KV, corps: Record<string, unknown>, now = Date.now()) {
  const agent = court(corps.agent, 'agent', 40);
  if (!agentById(agent)) throw new Refus(`agent inconnu : ${agent}`);
  const action = court(corps.action, 'action', 80);
  const resume = court(corps.resume, 'resume', 500);
  const cle = typeof corps.cle === 'string' && corps.cle.trim() ? corps.cle.trim().slice(0, 120) : null;
  if (cle) {
    const existant = (await kv.hgetall(CLES_ACCORDS.tous));
    const deja = Object.values(existant).map(v => JSON.parse(v) as Accord & { cle?: string }).find(a => a.cle === cle);
    if (deja) return { accord: deja as Accord, nouveau: false };
  }
  const id = Math.random().toString(36).slice(2, 6);
  const accord: Accord & { cle?: string } = { id, agent, action, resume, statut: 'en attente', demande: now, ...(cle ? { cle } : {}) };
  await kv.hset(CLES_ACCORDS.tous, id, JSON.stringify(accord));
  await kv.lpush(CLES_ACCORDS.attente, id);
  return { accord: accord as Accord, nouveau: true };
}

export async function lireAccord(kv: KV, id: string): Promise<Accord | null> {
  const v = (await kv.hgetall(CLES_ACCORDS.tous))[id];
  return v ? JSON.parse(v) : null;
}

export async function listerAccords(kv: KV) {
  return Object.values(await kv.hgetall(CLES_ACCORDS.tous)).map(v => JSON.parse(v) as Accord).sort((a, b) => b.demande - a.demande);
}

/** Les id des demandes encore en attente, de la plus ancienne à la plus récente. */
export async function idsEnAttente(kv: KV): Promise<string[]> {
  const file = await kv.lrange(CLES_ACCORDS.attente, 0, -1);
  const tous = await kv.hgetall(CLES_ACCORDS.tous);
  return [...file].reverse().filter(id => tous[id] && (JSON.parse(tous[id]) as Accord).statut === 'en attente');
}

/** Ferme une demande sans réponse (remplacée, ou jamais montrée) : statut « annule », retirée de la file. */
export async function annulerAccord(kv: KV, id: string, raison: string, now = Date.now()): Promise<void> {
  const accord = await lireAccord(kv, id);
  if (accord && accord.statut === 'en attente') {
    await kv.hset(CLES_ACCORDS.tous, id, JSON.stringify({ ...accord, statut: 'annule', detail: raison, repondu: now }));
  }
  await retirerDeLaFile(kv, id);
}

async function retirerDeLaFile(kv: KV, cible: string) {
  const file = await kv.lrange(CLES_ACCORDS.attente, 0, -1);
  if (!file.includes(cible)) return;
  const reste = file.filter(id => id !== cible);
  await kv.ltrim(CLES_ACCORDS.attente, 1, 0);
  for (const id of [...reste].reverse()) await kv.lpush(CLES_ACCORDS.attente, id);
}

/** Comprend ma réponse : « OK », « oui », « non », « modifie : … », avec éventuellement « #id ». */
export function lireReponse(texte: string): { decision: Exclude<Decision, 'en attente' | 'annule'>; detail?: string; id?: string } | null {
  const brut = texte.trim();
  const id = brut.match(/#([a-z0-9]{4})\b/i)?.[1]?.toLowerCase();
  const t = brut.replace(/#[a-z0-9]{4}\b/i, '').trim();
  const bas = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/^(ok|oui|d'accord|daccord|go|valide|yes)\b[\s.!]*$/.test(bas)) return { decision: 'accepte', id };
  if (/^(non|no|refuse|stop)\b[\s.!]*$/.test(bas)) return { decision: 'refuse', id };
  const m = t.match(/^modifi(?:e|er)\s*:?\s*([\s\S]+)$/i);
  if (m && m[1].trim()) return { decision: 'modifie', detail: m[1].trim().slice(0, 500), id };
  return null;
}

/** Applique ma réponse à la demande visée (#id) ou, à défaut, à la plus ancienne encore en attente. */
export async function repondreAccord(kv: KV, texte: string, now = Date.now()) {
  const r = lireReponse(texte);
  if (!r) return { compris: false as const };
  const enAttente = (await kv.lrange(CLES_ACCORDS.attente, 0, -1));
  const tous = await kv.hgetall(CLES_ACCORDS.tous);
  const cible = r.id ?? [...enAttente].reverse().find(id => tous[id] && JSON.parse(tous[id]).statut === 'en attente');
  if (!cible || !tous[cible]) return { compris: true as const, accord: null };
  const accord: Accord = JSON.parse(tous[cible]);
  if (accord.statut !== 'en attente') return { compris: true as const, accord, deja: true };
  accord.statut = r.decision;
  accord.repondu = now;
  if (r.detail) accord.detail = r.detail;
  await kv.hset(CLES_ACCORDS.tous, cible, JSON.stringify(accord));
  await retirerDeLaFile(kv, cible);
  return { compris: true as const, accord };
}

/** Le texte envoyé sur WhatsApp pour une demande d'accord. */
export function texteDemande(a: Accord) {
  const nom = agentById(a.agent)?.nom ?? a.agent;
  return `QG · demande d'accord #${a.id}\n${nom} veut : ${a.action}\n\n${a.resume}\n\nRéponds OK, non, ou « modifie : … »`;
}

export function texteConfirmation(a: Accord) {
  const nom = agentById(a.agent)?.nom ?? a.agent;
  const quoi = a.statut === 'accepte' ? 'accepté ✅' : a.statut === 'refuse' ? 'refusé ❌' : `à modifier ✏️ (« ${a.detail} »)`;
  return `QG · #${a.id} ${quoi}. ${nom} est prévenu.`;
}
