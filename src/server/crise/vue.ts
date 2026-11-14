import type { KV } from '../memoire';
import { CLES_LUFFY } from '../luffy/vigie';
import { prochainMardi } from '../zoro/vue';
import { lireReunions } from './stock';
import { participantsA } from './message';
import { bilan, enCours, pointsDe, prochainPoint, resume, type Reunion, type ReunionScene, type ReunionVue } from '@/data/crise';

// Ce que la page lit des réunions de crise : la réunion en cours (ou son débrief) pour la salle, et l'historique pour le
// Calendrier. Rien d'autre que ce que le suivi a rangé : aucune réunion inventée, rien dans /demo (jamais lu là-bas).

const MIN = 60_000;
/** Luffy passe toutes les 5 min ; sans passage depuis 20 min, il ne revérifie plus (on ne promet rien). */
const PAS_LUFFY = 5 * MIN, LUFFY_ENDORMI = 20 * MIN;

/** La réunion de la salle, avec la prochaine vraie vérification de chaque alerte. */
export async function sceneCrise(kv: KV, now: number = Date.now(), reunions?: Reunion[]): Promise<ReunionScene | null> {
  const r = (reunions ?? await lireReunions(kv)).find(x => enCours(x, now) && x.debut <= now) ?? null;
  if (!r) return null;
  const dernier = Number((await kv.hmget(CLES_LUFFY.dernier, ['quand'])).quand);
  const luffyVeille = Number.isFinite(dernier) && dernier > 0 && now - dernier < LUFFY_ENDORMI;
  const relances: Record<string, number> = {};
  for (const s of r.sujets) {
    if (s.genre === 'site' && luffyVeille) relances[s.cle] = Math.max(dernier + PAS_LUFFY, now);
    if (s.genre === 'zoro') relances[s.cle] = prochainMardi(now);
  }
  return { ...r, relances };
}

/** L'historique du Calendrier (60 jours), la plus récente d'abord : début, points, fin, et qui était en salle au début. */
export function vuesReunions(reunions: Reunion[], now: number): ReunionVue[] {
  return reunions.map(r => ({
    id: r.id, niveau: r.niveau, debut: r.debut, ...(r.fin !== undefined ? { fin: r.fin } : {}),
    points: pointsDe(r, now),
    ...(r.fin === undefined ? { prochain: prochainPoint(Math.max(now, r.debut)) } : {}),
    // en cours : ce qui est ouvert, avec sa durée ; finie : tout ce qu'elle a vu, sans durée
    titre: r.fin === undefined ? resume(r.sujets, now) : resume(r.vus, null),
    ...(r.fin !== undefined ? { bilan: bilan(r, false) } : {}),
    participants: participantsA(r, r.debut),
  }));
}

export async function vueCrise(kv: KV, now: number = Date.now()): Promise<{ scene: ReunionScene | null; reunions: ReunionVue[] }> {
  const reunions = await lireReunions(kv);
  return { scene: await sceneCrise(kv, now, reunions), reunions: vuesReunions(reunions, now) };
}
