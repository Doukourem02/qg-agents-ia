// Feu, le copilote de trading : les types partagés (serveur et page). Aucun import de valeur.
// Feu ne passe jamais un ordre : il lit le marché (données publiques), lit le compte en lecture seule (par le Mac) et
// propose. Heure d'Abidjan = UTC.

export const PAIRES = ['BTCUSDT', 'ETHUSDT'] as const;
export type Paire = (typeof PAIRES)[number];
export type Intervalle = '4h' | '1h' | '15m';

/** Une bougie : ouverture `t`, fin `f` (ms) ; prix d'ouverture, haut, bas, clôture ; volume en crypto. */
export type Bougie = { t: number; o: number; h: number; l: number; c: number; v: number; f: number };

/** Les règles d'une paire (exchangeInfo) : pas de prix, pas de quantité, minimum d'un ordre en USDT. */
export type ReglesPaire = { tick: number; pas: number; minimum: number };

/** Une zone de prix (support, résistance) : bas et haut, et d'où elle vient. */
export type Zone = { bas: number; haut: number; nom: string };
/** Un niveau surveillé : seule une clôture 1h au-delà compte (`haut` : au-dessus ; `bas` : en dessous). */
export type NiveauSurveille = { prix: number; sens: 'haut' | 'bas'; nom: string };

/**
 * Les niveaux d'une paire, tenus par Feu. `contexte` : le dernier sommet à reprendre (clôture 1h au-dessus) pour un
 * contexte haussier ; `repris` : l'heure de la clôture qui l'a repris (la zone cassée devient un support à retester).
 */
export type NiveauxPaire = {
  supports: Zone[]; resistances: Zone[]; surveilles: NiveauSurveille[];
  contexte: { prix: number; repris?: number } | null;
};

/** Une annonce macro (CPI, PPI, NFP, FOMC…) : pas d'entrée dans l'heure avant ni l'heure après. */
/** `aConfirmer` : la date seulement (presse), sans heure sûre : pas de fenêtre tant que l'heure n'est pas connue. */
export type Annonce = { quand: number; nom: string; source?: string; aConfirmer?: true };

export type Regime = 'apprentissage' | 'standard';
export type Structure = 'haussiere' | 'baissiere' | 'range' | 'indeterminee';
export type NomStatut = 'Hypothèse' | 'Surveillance' | 'Signal';

export type Condition = { ok: boolean; detail: string };

/** Un ordre OCO à poser dès l'exécution de l'entrée : take-profit à l'objectif, stop-limit à l'invalidation. */
export type Oco = { quantite: number; objectif: number; declenchement: number; limite: number };

/**
 * Le plan d'ordres chiffré, calculé par le code (seulement au Signal) : entrée limite, quantité arrondie au pas de la
 * paire, OCO, risque en USDT, ratio net de frais. « Valable tant que le prix reste dans cette zone. »
 */
export type Plan = {
  paire: Paire; entree: number; quantite: number; montant: number;
  ocos: Oco[]; objectif: number; stop: number; stopLimite: number;
  risque: number; gainNet: number; ratio: number; distanceStop: number;
  zone: Zone; frais: number; valable: string;
  /** Les contrôles du minimum de 5 USDT (achat, vente à l'objectif, vente au stop). */
  minimums: { achat: number; venteObjectif: number; venteStop: number };
};

/** Ce que le code a lu et conclu pour une paire à un passage. */
export type StatutPaire = {
  paire: Paire; statut: NomStatut; prix: number; lu: number;
  conditions: { contexte: Condition; zone: Condition; declencheur: Condition };
  /** La condition (ou la règle) qui manque, en mots simples ; null au Signal. */
  manque: string | null;
  /** Le ratio net de frais du plan possible (quand une zone et un objectif existent). */
  ratio: number | null;
  rsi15: number | null; structure4h: Structure; structure1h: Structure;
  zone: Zone | null; objectif: number | null;
  /** La zone a été touchée puis dépassée de plus de 1 % : c'est raté, on attend le prochain retour. */
  rate: boolean;
  plan: Plan | null;
};

/** Ce que le Mac envoie (jamais la clé) : le compte lu en lecture seule. */
export type OrdreOuvert = { paire: string; id: number; cote: 'BUY' | 'SELL'; type: string; prix: number; declenchement: number; quantite: number; executee: number; quand: number; liste: number };
export type Execution = { paire: string; id: number; ordre: number; cote: 'BUY' | 'SELL'; prix: number; quantite: number; montant: number; frais: number; fraisActif: string; quand: number };
export type Compte = {
  quand: number;
  /** `ok` : lu ; `absente` : clé pas encore créée ; `droits` : la clé a un droit d'écriture, Feu refuse de s'en servir. */
  cle: 'ok' | 'absente' | 'droits' | 'erreur';
  /** Les droits en trop (seulement avec `droits`). */
  droits?: string[];
  raison?: string;
  spot: Record<string, { libre: number; bloque: number }>;
  earn: Record<string, number>;
  ouverts: OrdreOuvert[];
  executes: Execution[];
};

/** Une opération clôturée, reconstituée à partir des vrais ordres exécutés. */
export type Operation = {
  paire: string; ouverture: number; cloture: number; quantite: number;
  prixEntree: number; prixSortie: number; achat: number; vente: number; frais: number; net: number;
  gagnante: boolean; avecPlan: boolean; planRespecte: boolean | null; sortie: 'objectif' | 'stop' | 'main';
};
export type Position = { paire: string; ouverture: number; quantite: number; prixEntree: number; objectif: number | null; stop: number | null };
export type Journal = {
  operations: number; gagnantes: number; perdantes: number; net: number; netPct: number | null; frais: number;
  plansRespectes: number | null; semaine: number; pertesDeSuite: number;
};
export type Pause = { jusqua: number; raison: string } | null;
