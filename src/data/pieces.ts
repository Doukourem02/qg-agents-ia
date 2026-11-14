// Les étiquettes des pièces. /demo : celles de la simulation (on la filme). Page privée : seulement du vrai ou du
// descriptif fixe — aucun chiffre de la simulation (« 7/7 au poste », « 2 en attente », « 5 projets en cours »…).

/** Les étiquettes fixes, qui décrivent la pièce sans prétendre compter quoi que ce soit. */
const FIXES: Record<string, string> = { pause: 'PS5 · baby-foot · arcade' };

/**
 * `enAttente` : ce qui attend le patron (vuesQG, taches.enAttente), affiché au bureau des accords ;
 * `undefined` tant que la page n'a rien lu. `salle` : le titre d'une vraie réunion de crise en cours (page privée).
 */
export function etiquettesPieces(sim: Record<string, string>, demo: boolean, enAttente: number | undefined, salle: string | null = null): Record<string, string> {
  if (demo) return sim;
  const out: Record<string, string> = {};
  for (const id of Object.keys(sim)) out[id] = FIXES[id] ?? '';
  if (enAttente) out.accords = `${enAttente} en attente de toi`;
  if (salle) out.reunion = salle;
  return out;
}
