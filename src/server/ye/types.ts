// Ye, la Curatrice : les types partagés (serveur et page). Aucun import de valeur.
import type { CommitPaul, DocLu } from '../paul/types';

/** Les seuls champs d'une fiche `project` que Ye peut proposer. Jamais title, githubUrl, images, vidéos, order. */
export type ChampYe = 'kind' | 'kindEn' | 'status' | 'description' | 'descriptionEn' | 'liveUrl' | 'technologies';
export type ChampTexte = Exclude<ChampYe, 'technologies'>;

/** Une compétence du portfolio (document `skill`) : la seule liste de technologies que Ye peut afficher. */
export type Competence = { id: string; name: string };

/**
 * Une fiche telle que Ye la lit (textes passés au repérage des clés). `masques` : les champs où le QG a masqué quelque
 * chose (jamais réécrits : le masque écraserait la vraie valeur). `technologies` : les compétences liées, par nom.
 */
export type FicheLue = {
  id: string; rev: string; titre: string;
  kind: string; kindEn: string; status: string; description: string; descriptionEn: string; liveUrl: string;
  technologies: Competence[];
  masques: ChampTexte[];
};

/**
 * Un projet du lot : sa fiche, son dépôt, les commits de la semaine, le README (masqué), les dépendances
 * (package.json), les adresses trouvées dans le dépôt (README, `homepage`, CNAME : seules preuves d'un `liveUrl`),
 * l'arborescence, la dernière note de séance. `brouillon` : Le patron a un brouillon de cette fiche en cours dans le Studio.
 */
export type ProjetLotYe = {
  fiche: FicheLue; depot: string; branche: string; tete: string; depuis: string | null; reecrit?: true;
  commits: CommitPaul[]; readme: DocLu; dependances: string[]; urls: string[]; arbre: string[];
  seance: { chemin: string; contenu: string } | null; brouillon: boolean; enPartie: string[];
};
/**
 * Un projet absent du portfolio : un dépôt perso actif (poussé depuis 90 jours) qu'aucune fiche ne suit. Mêmes lectures
 * qu'un projet du lot (textes masqués), sans fiche ; `images` : les images du dépôt que Ye peut choisir pour la fiche.
 */
export type ProjetAbsentYe = {
  depot: string; nom: string; branche: string; tete: string;
  commits: CommitPaul[]; readme: DocLu; dependances: string[]; urls: string[]; arbre: string[]; images: string[];
  seance: { chemin: string; contenu: string } | null; enPartie: string[];
};
export type LotYe = { id: string; quand: number; competences: Competence[]; projets: ProjetLotYe[]; absents: ProjetAbsentYe[]; sansLien: number };

export type Raison = { texte: string; source: string };
/** Un champ qui change : l'avant et l'après en entier, tels qu'ils sont et tels qu'ils seront publiés. */
export type Changement = { champ: ChampYe; avant: string; apres: string };
export type StatutProposition = 'attente' | 'publiee' | 'refusee' | 'bougee' | 'remplacee' | 'expiree';

/**
 * Une proposition pour une fiche (tous ses champs ensemble, un seul « Valider »). `set` : exactement ce que le patch
 * écrira ; `rev` : la révision lue par Ye (ifRevisionID).
 */
export type PropositionYe = {
  id: string; lot: string; ficheId: string; rev: string; titre: string; depot: string;
  set: Record<string, unknown>; changements: Changement[]; raisons: Raison[];
  quand: number; statut: StatutProposition; decide?: number;
};

/** Une question de compétence : une techno vue dans le projet, absente des compétences. Jamais un ajout. */
export type QuestionYe = {
  id: string; techno: string; cle: string; titre: string; source: string;
  quand: number; statut: 'attente' | 'oui' | 'non' | 'expiree'; decide?: number;
};

/**
 * Une nouvelle fiche proposée pour un projet absent du portfolio. Rien n'est créé avant « Ajouter ». `docId` : l'identifiant
 * du document qui sera créé ; `images` : les chemins du dépôt (au commit `tete`) envoyés à Sanity au clic. Sans image,
 * la fiche est créée en brouillon (invisible sur le site). `plus-tard` : reproposée au bout de 4 semaines ; `jamais` :
 * plus jamais proposée pour ce dépôt.
 */
export type StatutNouvelle = 'attente' | 'ajoutee' | 'brouillon' | 'plus-tard' | 'jamais' | 'expiree' | 'remplacee';
export type ChampsNouvelle = {
  title: string; kind: string; kindEn: string; status: string; description: string; descriptionEn: string; liveUrl: string;
  technologies: Competence[];
};
export type NouvelleYe = {
  id: string; lot: string; depot: string; tete: string; docId: string;
  champs: ChampsNouvelle; images: string[]; raisons: Raison[];
  quand: number; statut: StatutNouvelle; decide?: number;
  /** Noté juste avant la création : l'identifiant envoyé à Sanity (pour reconnaître une création dont la réponse s'est perdue). */
  tentee?: { docId: string; brouillon: boolean };
};

export type RefusQGYe ={ quand: number; titre: string; raison: string };
export type PassageYe = { quand: number; relus: number; propositions: number; questions: number; refusees: number; illisibles: string[]; sansLien: number; nouvelles?: number };
export type EchecYe = { quand: number; raison: string };
