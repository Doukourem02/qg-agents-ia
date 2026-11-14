// Le Calendrier allégé (« trop chargé », 13 novembre 2026) : les relances conditionnelles qui reviennent plusieurs fois
// dans la journée (Kuroro · QG · missions toutes les heures, relances de Light) tiennent sur une seule ligne par jour,
// et une réunion de crise résume ses points au lieu de tous les lister.

import type { Creneau } from '@/server/vues';

/** Une relance conditionnelle répétée dans la journée, en une ligne : « 08:00 → 20:00 · 13 fois ». */
export type Repetee = {
  routine: string; agent: string; nom: string; titre: string;
  de: string; a: string; n: number; faits: number; rates: number;
  /** Rien n'a tourné ni ne tournera ce jour-là (pas encore actif, pas nécessaire) : la ligne s'efface à moitié. */
  eteinte: boolean;
};

const ETEINTS: readonly Creneau['etat'][] = ['inactif', 'sans-objet', 'rien-a-faire'];

/** Les états qui n'apportent rien à lire sur la carte : la carte s'efface à moitié, sans pastille. */
export const estEteint = (c: Creneau) => ETEINTS.includes(c.etat);

/** Sépare les créneaux d'un jour : ceux qu'on montre un par un, et les relances répétées regroupées. */
export function regrouperRelances(du: readonly Creneau[]): { seuls: Creneau[]; repetees: Repetee[] } {
  const parRoutine = new Map<string, Creneau[]>();
  for (const c of du) if (c.conditionnel && !c.prevu) parRoutine.set(c.routine, [...(parRoutine.get(c.routine) ?? []), c]);
  const groupees = new Set([...parRoutine].filter(([, l]) => l.length > 1).map(([r]) => r));
  const repetees = [...parRoutine].filter(([r]) => groupees.has(r)).map(([routine, l]): Repetee => {
    const tries = [...l].sort((x, y) => x.quand - y.quand);
    return {
      routine, agent: tries[0].agent, nom: tries[0].nom, titre: tries[0].titre,
      de: tries[0].heure, a: tries[tries.length - 1].heure, n: tries.length,
      faits: tries.filter(c => c.etat === 'fait').length, rates: tries.filter(c => c.etat === 'rate').length,
      eteinte: tries.every(estEteint),
    };
  });
  return { seuls: du.filter(c => !groupees.has(c.routine) || c.prevu), repetees };
}

/** Les points d'une réunion, résumés : « 52 points · dernier 19:30 · prochain 20:00 ». `heure` formate un instant. */
export function resumePoints(points: readonly number[], prochain: number | undefined, heure: (t: number) => string): string {
  const n = points.length;
  const passes = n === 0 ? 'aucun point encore' : n === 1 ? `point ${heure(points[0])}` : `${n} points · dernier ${heure(points[n - 1])}`;
  return prochain !== undefined ? `${passes} · prochain ${heure(prochain)}` : passes;
}
