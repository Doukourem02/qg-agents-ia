// Types partagés de Zoro, le Gardien (agent de sécurité en lecture seule).

export type Gravite = 'critique' | 'haute' | 'moyenne' | 'basse';
export type Ecosysteme = 'npm' | 'PyPI';
export type Dependance = { nom: string; version: string; ecosysteme: Ecosysteme; directeProd: boolean };
export type Faille = { id: string; paquet: string; version: string; gravite: Gravite; corrigeeEn: string | null; directeProd: boolean; resume: string };
export type EtatCI =
  | { etat: 'vert'; passages: number; echecs: number }
  | { etat: 'rouge'; depuis: number; passages: number; echecs: number }
  | { etat: 'sans-tests' }
  | { etat: 'illisible'; raison: string };
export type Projet = {
  depot: string;            // nom court, ex. 'app_livraison'
  pousse: number;           // ms
  failles: Faille[] | null; // null = illisible
  sansDependances?: true;   // aucun manifeste trouvé (failles = [])
  ci: EtatCI;
};
export type Cle = { nom: 'GitHub (lecture)' | 'LinkedIn'; expire: number | null; etat: 'ok' | 'bientot' | 'expiree' | 'sans-date' | 'non-connecte' };
export type DossierMac = {
  nom: string; git: boolean; compte: string | null; distant: boolean;
  nonEnregistres: number; plusAncienNonEnregistre: number | null;
  nonPousses: number; plusAncienNonPousse: number | null;
  stashes: number; dernierCommit: number | null; modifie: number;
  illisible?: true; // au moins une lecture git ratée ; jamais Telegram, « non lu » dans la page
};
export type RapportMac = { quand: number; dossiers: DossierMac[] };
export type Partie = 'failles' | 'ci' | 'cles' | 'mac';
export type Important = { cle: string; partie: Partie; projet: string; texte: string };
export type Tour = {
  quand: number; type: 'tour' | 'verifier';
  projets: Projet[]; nonLus: string[]; cles: Cle[];
  mac: RapportMac | null; macVieux: boolean;
  importants: Important[];
};
