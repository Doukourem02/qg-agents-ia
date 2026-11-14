import type { KV } from '../memoire';
import { CLES_MAFE, dernierReleve, jourDe, type ReleveMafe } from './releve';
import type { NoteSeance } from './api';

// Ce que la page affiche pour Mafe : un seul document (le dernier relevé, la dernière note de séance, le dernier message).

export type VueMafe = {
  releve: ReleveMafe | null;
  derniereNote: { nom: string; jour: string } | null;
  message: { jour: string; envoye: number } | null;
};

const JOUR_MS = 86_400_000;

function lire<T>(brut: unknown): T | null {
  try { return (typeof brut === 'string' ? JSON.parse(brut) : brut) as T; } catch { return null; }
}

/** Le dernier jour ouvré (lundi à vendredi) strictement avant aujourd'hui : un relevé plus ancien n'est plus à jour. */
function dernierJourOuvre(now: number): string {
  let t = now - JOUR_MS;
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= JOUR_MS;
  return jourDe(t);
}

export async function vueMafe(kv: KV, now = Date.now()): Promise<VueMafe> {
  let brut: ReleveMafe | null = null;
  try { brut = await dernierReleve(kv); } catch { /* relevé abîmé : comme s'il n'y en avait pas */ }
  const releve = brut && typeof brut.jour === 'string' && Array.isArray(brut.projets) ? brut : null;
  const [notes, messages] = await Promise.all([kv.hgetall(CLES_MAFE.notes), kv.hgetall(CLES_MAFE.messages)]);
  const derniere = Object.values(notes).flatMap(v => { const n = lire<NoteSeance>(v); return n && typeof n.quand === 'number' ? [n] : []; })
    .sort((a, b) => b.quand - a.quand)[0];
  const jourMessage = Object.keys(messages).sort().pop();
  const m = jourMessage ? lire<{ envoye?: number }>(messages[jourMessage]) : null;
  return {
    releve: releve && (releve.pasAJour || releve.jour < dernierJourOuvre(now)) ? { ...releve, pasAJour: true } : releve,
    derniereNote: derniere ? { nom: derniere.nom, jour: derniere.jour } : null,
    message: jourMessage && typeof m?.envoye === 'number' ? { jour: jourMessage, envoye: m.envoye } : null,
  };
}
