// Mafe : les projets suivis et leurs noms affichés.

/** Dépôts d'exercice, jamais suivis (modifiable ici). */
export const EXCLUS: readonly string[] = ['duolingo_clone', 'control'];

const NOMS: Record<string, string> = {
  qg: 'QG',
  'boutique-shop': 'Boutique Shop',
  mon_portfolio: 'Portfolio',
  projet_terra: 'Terra',
  app_livraison: 'Livreo',
};

const court = (depot: string) => depot.split('/').pop() ?? depot;

/** `mon-compte/app_livraison` → `Livreo` ; un dépôt inconnu garde son nom de dépôt. */
export function nomProjet(depot: string): string {
  const c = court(depot);
  return NOMS[c.toLowerCase()] ?? c;
}

export function estExclu(depot: string): boolean {
  return EXCLUS.includes(court(depot).toLowerCase());
}
