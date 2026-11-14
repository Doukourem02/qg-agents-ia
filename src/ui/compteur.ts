// Le compteur en haut à droite (page privée), deux chiffres vrais :
// - en service : les vrais agents qui ne sont pas bloqués (aucun passage raté, Mac allumé, Luffy qui vérifie) ;
// - en tâche : ceux qui exécutent une tâche en ce moment (moins de 30 min, voir src/server/vues.ts).
// Stalker compte dans les deux tant que Claude Code travaille avec moi (présence de moins de 15 min).
// « 0 au travail » à 7 h 52 avec tout le monde à son poste prêtait à confusion (11 novembre 2026).

type Statut = 'au travail' | 'au repos' | 'bloque';
type Vues = { agents: { agent: string; statut: Statut; outil?: string }[]; presences?: string[] };

/**
 * La barre d'outils, en phase avec le compteur : l'outil de chaque agent en tâche reste allumé tant que la tâche
 * tourne, et Claude tant que Stalker (Claude Code) travaille avec moi. « 0 en tâche » : aucun outil de tâche allumé.
 */
export function outilsEnTache(vues: Vues | null | undefined): string[] {
  if (!vues) return [];
  const presents = (vues.presences ?? []).some(id => !vues.agents.some(a => a.agent === id));
  const cles = vues.agents.flatMap(a => (a.statut === 'au travail' && a.outil ? [a.outil] : []));
  return [...new Set([...cles, ...(presents ? ['C'] : [])])];
}

/**
 * Les outils des agents en service (même règle que « en service » du compteur) : ils clignotent doucement dans la barre.
 * Stalker (Claude Code avec moi) : Claude. Les outils viennent de la fiche de chaque agent (`outilsDe`, agents.json).
 * Décision du 11 novembre 2026 : « si 8 en service, donc 8 allumés en train de clignoter ».
 */
export function outilsEnService(vues: Vues | null | undefined, outilsDe: (id: string) => readonly string[]): string[] {
  if (!vues) return [];
  const presents = (vues.presences ?? []).some(id => !vues.agents.some(a => a.agent === id));
  const cles = vues.agents.flatMap(a => (a.statut !== 'bloque' ? [...outilsDe(a.agent)] : []));
  return [...new Set([...cles, ...(presents ? ['C'] : [])])];
}

/**
 * La vague des outils en service, étape par étape (décision du 11 novembre 2026) : de gauche à droite, chacun s'allume
 * et reste allumé jusqu'au dernier ; tout s'éteint ; de droite à gauche de la même façon ; tout s'éteint ; et ainsi de
 * suite. `n` outils en service → un cycle de 2 × (n + 1) étapes. Rend, pour l'étape `etape`, qui est allumé.
 */
export function allumesVague(n: number, etape: number): boolean[] {
  if (n <= 0) return [];
  const e = ((etape % (2 * (n + 1))) + 2 * (n + 1)) % (2 * (n + 1));
  if (e === n || e === 2 * n + 1) return Array(n).fill(false); // tout éteint entre deux sens
  if (e < n) return Array.from({ length: n }, (_, i) => i <= e); // gauche → droite
  const k = e - (n + 1); // droite → gauche : k + 1 allumés en partant de la fin
  return Array.from({ length: n }, (_, i) => i >= n - 1 - k);
}

export function compteur(vues: Vues | null | undefined): { service: number; tache: number } | null {
  if (!vues) return null;
  const presents = (vues.presences ?? []).filter(id => !vues.agents.some(a => a.agent === id)).length;
  return {
    service: vues.agents.filter(a => a.statut !== 'bloque').length + presents,
    tache: vues.agents.filter(a => a.statut === 'au travail').length + presents,
  };
}

export const texteCompteur = (c: { service: number; tache: number } | null) => (c ? `${c.service} en service · ${c.tache} en tâche` : '…');
