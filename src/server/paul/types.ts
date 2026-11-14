// Paul, l'Archiviste : les types partagés (serveur et page). Aucun import de valeur.

/** Les seuls fichiers que Paul peut proposer : à la racine du dépôt, jamais de code. */
export type FichierDoc = 'README.md' | 'CLAUDE.md';

/** Un commit du lot : sha entier, sha court, première ligne du message (masquée), date, fichiers touchés (absents = non lus). */
export type CommitPaul = { sha: string; court: string; message: string; date: number; fichiers?: string[] };

/** Un fichier lu par Paul : absent, ou présent avec le sha de son blob et son contenu masqué (`enPartie` : coupé). */
export type DocLu = { present: false } | { present: true; sha: string; contenu: string; enPartie?: true; /** un secret y a été masqué : le texte envoyé n'est pas le vrai */ masque?: true };

export type Scripts = { source: 'package.json' | 'pyproject.toml' | 'Makefile'; lignes: string[] };

/**
 * Un projet du lot. `depuis` : le marque-page (dernier sha documenté) ou null (les 7 derniers jours) ; `reecrit` : le
 * marque-page était introuvable (historique réécrit) et le lot reprend les 7 derniers jours. `blocActuel` : le bloc
 * « Où on s'est arrêté » déjà présent dans CLAUDE.md (null s'il n'y est pas). `enPartie` : ce qui a été coupé.
 */
export type ProjetLotPaul = {
  depot: string; branche: string; tete: string; depuis: string | null; reecrit?: true;
  commits: CommitPaul[]; commitsCoupes?: number;
  readme: DocLu; claude: DocLu; blocActuel: string | null; agents: boolean;
  scripts: Scripts | null; arbre: string[]; variables: string[];
  seance: { chemin: string; contenu: string } | null;
  enPartie: string[];
};
export type LotPaul = { id: string; quand: number; projets: ProjetLotPaul[] };

/** Une ligne de ce qui change : ajoutée, retirée, ou « … » (lignes inchangées sautées). */
export type LigneDiff = { sorte: '+' | '-' | '…'; texte: string };
export type Raison = { texte: string; source: string };

/** `bloquee` : arrêtée par le QG au moment d'écrire (un masque de clé y remplaçait une vraie valeur). */
export type StatutProposition = 'attente' | 'appliquee' | 'refusee' | 'bougee' | 'remplacee' | 'expiree' | 'bloquee';

/**
 * Une proposition acceptée par le serveur. `base` : le sha du blob lu par Paul (null : le fichier n'existait pas).
 * `contenu` : le README complet ; `bloc` : le bloc « Où on s'est arrêté » (CLAUDE.md, reconstruit par le serveur à
 * l'écriture). `diff` : ce qui change, en clair (déjà masqué). `commit` : le commit écrit sur GitHub après « Valider ».
 */
export type Proposition = {
  id: string; lot: string; depot: string; branche: string; fichier: FichierDoc; base: string | null;
  contenu?: string; bloc?: string; raisons: Raison[];
  diff: LigneDiff[]; ajoutees: number; retirees: number;
  quand: number; statut: StatutProposition; decide?: number; commit?: { sha: string; url: string };
};

/** Une proposition refusée par le QG (jamais écrite, jamais envoyée) : la raison est une phrase fixe, sans contenu reçu. */
export type RefusQG = { quand: number; depot: string; fichier: string; raison: string };

/** Le dernier passage complet : quand, combien de projets relus, combien de propositions envoyées et refusées. */
/** Un passage raté : aucun projet n'a pu être lu (les noms courts de ceux que GitHub n'a pas rendus). */
export type Echec = { quand: number; illisibles: string[] };

export type Passage = { quand: number; relus: number; propositions: number; refusees: number; illisibles: string[] };
