import type { KV } from '../memoire';
import { CLES, JOURNAL_MAX, type Entree } from '../qg';
import { estTest, passagesSemaine, vuesQG } from '../vues';
import { CLES_LIGHT } from '../light/releve';
import type { MessageJour } from '../light/api';
import { vueLight } from '../light/vue';
import { vueLuffy } from '../luffy/vue';
import { vueLea } from '../lea/vue';
import { vueMafe } from '../mafe/vue';
import { vueClara } from '../clara/vue';
import { CLES_CLARA } from '../clara/stats';
import { JOURNAL_MAX as JOURNAL_CLARA_MAX, type Nettoyage } from '../clara/actions';
import { debutNuit, type EtatClara, type EtatMatin } from './message';
import { lireReunions } from '../crise/stock';
import { vueSilence } from '../silence';
import { lirePauses } from '../pause-agents';
import { vueFeu } from '../feu/vue';

// Ce que Kuroro lit dans Upstash pour son compte rendu du matin : les mêmes données que la page privée (vues, journal,
// bureaux des agents). Une source qui ne se lit pas devient `null` : le message le dit, il n'invente rien.

const JOUR = 86_400_000;

function lire<T>(brut: string | undefined): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}
const sur = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** Une liste coupée à `max` entrées est complète pour la nuit si elle est plus courte, ou remonte avant son début. */
const complete = (quands: number[], longueur: number, max: number, debut: number) =>
  longueur < max || (quands.length > 0 && Math.min(...quands) < debut);

export async function lireEtatMatin(kv: KV, now: number): Promise<EtatMatin> {
  const debut = debutNuit(now);
  const [vues, brutJournal, brutMessages, luffy, lea, light, mafe, clara, brutNettoyages, reunions, silence] = await Promise.all([
    sur(vuesQG(kv, now)), sur(kv.lrange(CLES.journal, 0, -1)), sur(kv.hgetall(CLES_LIGHT.messages)),
    sur(vueLuffy(kv, now)), sur(vueLea(kv, now)), sur(vueLight(kv, now)), sur(vueMafe(kv, now)), sur(vueClara(kv)),
    sur(kv.lrange(CLES_CLARA.journal, 0, -1)), sur(lireReunions(kv)), sur(vueSilence(kv, now)),
  ]);
  const feu = await sur(vueFeu(kv, now));
  // les agents mis en pause par le patron : leurs passages sont « en pause », jamais ratés
  const pauses = (await sur(lirePauses(kv))) ?? {};

  // le journal, du plus récent au plus ancien, sans le bruit de l'installation (comme la page)
  const journal = (brutJournal ?? []).flatMap(v => { const e = lire<Entree>(v); return e && !estTest(e.texte) ? [e] : []; });
  const messages: Record<string, MessageJour> = {};
  for (const [jour, v] of Object.entries(brutMessages ?? {})) { const m = lire<MessageJour>(v); if (m) messages[jour] = m; }

  // la semaine de `now` et la précédente : un lundi, « hier » est dans la semaine d'avant
  const minuit = now - (now % JOUR);
  const lundi = minuit - ((new Date(now).getUTCDay() + 6) % 7) * JOUR;
  const passages = brutJournal === null ? null : [
    ...passagesSemaine(lundi - 7 * JOUR, now, journal, messages, { pauses }),
    ...passagesSemaine(lundi, now, journal, messages, { pauses }),
  ];

  let etatClara: EtatClara | null = null;
  if (clara && brutJournal !== null && brutNettoyages !== null) {
    const nettoyages = brutNettoyages.flatMap(v => { const n = lire<Nettoyage>(v); return n && typeof n.quand === 'number' && typeof n.n === 'number' ? [{ quand: n.quand, n: n.n }] : []; });
    etatClara = {
      bannis: clara.bannis.length,
      nettoyages,
      nettoyagesComplets: complete(nettoyages.map(x => x.quand), brutNettoyages.length, JOURNAL_CLARA_MAX, debut),
      journal: journal.filter(e => e.agent === 'clara' && e.type === 'etat').map(e => ({ quand: e.quand, texte: e.texte })),
      journalComplet: complete(journal.map(e => e.quand), brutJournal.length, JOURNAL_MAX, debut),
    };
  }

  return { passages, enAttente: vues?.taches.enAttente ?? null, luffy, lea, clara: etatClara, light, mafe, reunions, silence, feu };
}
