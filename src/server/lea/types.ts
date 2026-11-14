// Léa, la Relectrice : les types partagés.

export type Gravite = 'grave' | 'moyen' | 'mineur';
export type GenreCle = 'clé GitHub' | 'clé Anthropic' | 'clé OpenAI' | 'clé AWS' | 'clé Stripe' | 'clé Google'
  | 'jeton Slack' | 'clé privée' | 'jeton Telegram' | 'secret dans un .env' | 'fichier .env';
export type TrouvailleCle = { ligne: number | null; genre: GenreCle };
/** `note` : pourquoi la différence n'est pas envoyée à la routine (fichier .env, trop gros, non fourni, liste coupée). */
export type FichierLot = { chemin: string; patch?: string; enPartie?: 'trop gros' | 'non fourni'; clesNonVerifiees?: true; statut?: string; note?: string };
export type CommitLot = { sha: string; message: string; date: number; fichiers: FichierLot[]; rienACoder?: true };
/** `reecrit` : le marque-page était introuvable (historique réécrit) ; le lot reprend les commits des dernières 24 h. */
export type ProjetLot = { depot: string; depuis: string; commits: CommitLot[]; reecrit?: true };
export type Lot = { id: string; quand: number; projets: ProjetLot[] };
export type Constat = {
  id: string; depot: string; sha: string; message: string; fichier: string; ligne: number | null;
  gravite: Gravite; quoi: string; conseil: string; source: 'serveur' | 'lea';
  quand: number; statut: 'ouvert' | 'vu';
};
export type Relecture = { depot: string; quand: number; commits: { sha: string; message: string }[];
  enPartie: string[]; clesNonVerifiees: string[]; rienACoder: number; reecrit?: true };
/** Comment s'est fini le dernier essai de Léa (`lea:tentative`) : la page dit ce qui n'a pas marché. `depots` : noms courts seulement. */
export type IssueTentative = 'complet' | 'projets illisibles' | 'relu en partie' | 'rapport refusé' | 'lot remis sans rapport';
export type Tentative = { quand: number; issue: IssueTentative; nonLus: number; depots: string[] };
