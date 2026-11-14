// Léa : repérer les clés poussées par erreur dans un patch git, et les masquer. Fonctions pures, sans réseau, sans dépendance.
// Un secret n'est jamais recopié : on ne garde que son genre, la ligne, et le masque « [<genre> masquée] ».

import type { GenreCle, TrouvailleCle } from './types';

type Forme = { genre: GenreCle; re: RegExp };

// Du plus précis au plus général : une fois une clé masquée, les formes suivantes ne la revoient plus
// (« sk-ant- » est Anthropic, jamais aussi OpenAI). Une borne à gauche évite de lire un mot ordinaire
// (« task-list-… ») comme une clé.
const FORMES: Forme[] = [
  { genre: 'clé GitHub', re: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}/g },
  { genre: 'clé GitHub', re: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/g },
  { genre: 'clé Anthropic', re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { genre: 'clé OpenAI', re: /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{48,}/g },
  { genre: 'clé AWS', re: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g },
  { genre: 'clé Stripe', re: /(?<![A-Za-z0-9])[rs]k_live_[A-Za-z0-9]{16,}/g },
  { genre: 'clé Google', re: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/g },
  { genre: 'jeton Slack', re: /(?<![A-Za-z0-9])xox[baprs]-\d[0-9A-Za-z-]{9,}/g },
  // Jeton de bot : « <8 à 10 chiffres>:AA… » (35 caractères après les deux-points), aussi dans l'adresse de l'API (…/bot123:AA…).
  { genre: 'jeton Telegram', re: /(?<!\d)\d{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/g },
];

const DEBUT_CLE_PRIVEE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const FIN_CLE_PRIVEE = /-----END [A-Z ]*PRIVATE KEY-----/;
const AFFECTATION_SECRET = /^\s*(?:export\s+)?[A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD)\s*=\s*(.*)$/;
const VALEUR_FACTICE = /^(?:x{3,}.*|changeme|your_.*|<.*>|…|\.\.\.|example|test)$/i;
// Une adresse avec identifiants (postgres://moi:motdepasse@hôte) : dans un .env, c'est un secret, quel que soit le nom.
const ADRESSE_AVEC_IDENTIFIANTS = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/;

const masque = (genre: GenreCle) => `[${genre} masquée]`;

/** Vrai pour un fichier d'environnement réel (.env, .env.local, .env.production), faux pour les modèles (.env.example…). */
export function estFichierEnv(chemin: string): boolean {
  const nom = chemin.split('/').pop() ?? '';
  if (nom === '.env' || nom === '.envrc') return true;
  if (!nom.startsWith('.env.')) return false;
  return !['example', 'sample', 'template', 'dist', 'defaults'].includes(nom.slice(5).toLowerCase());
}

const EXTENSIONS_CLE = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore']);

/**
 * Un fichier de clé : `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, et les clés SSH `id_rsa`, `id_dsa`,
 * `id_ecdsa`, `id_ed25519` (sans extension, ou `.pem`) — jamais une clé publique (`.pub`) ni un fichier de code (`id_rsa_parser.ts`).
 */
export function estFichierCle(chemin: string): boolean {
  const nom = (chemin.split('/').pop() ?? '').toLowerCase();
  if (nom.endsWith('.pub')) return false;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pem)?$/.test(nom)) return true;
  return nom.includes('.') && EXTENSIONS_CLE.has(nom.slice(nom.lastIndexOf('.') + 1));
}

function affectationReelle(contenu: string): boolean {
  const trouve = AFFECTATION_SECRET.exec(contenu);
  if (!trouve) return false;
  const valeur = trouve[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return valeur !== '' && !valeur.startsWith('#') && !VALEUR_FACTICE.test(valeur);
}

const ENTETE_BLOC = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const CORPS_DE_CLE = /[A-Za-z0-9+/=]{40,}/;
/** Une ligne de corps de clé : du base64 seul (les lignes d'un PEM font 64 caractères). */
const LIGNE_BASE64 = /^[A-Za-z0-9+/=]{16,}$/;
const LIGNE_PEM = /^[A-Za-z0-9+/]{64}$/;
const FIN_PEM = /^[A-Za-z0-9+/]{1,63}={0,2}$/;
/** Lignes regardées derrière l'en-tête d'une clé privée : une ancienne clé chiffrée a Proc-Type, DEK-Info et une ligne vide avant son corps. */
const FENETRE_CORPS = 6;

type Ligne = { texte: string; genres: GenreCle[]; ajoutee: boolean; ligne: number | null };

const contenuDe = (brute: string) => (brute[0] === '+' || brute[0] === '-' || brute[0] === ' ' ? brute.slice(1) : brute).replace(/\r$/, '');

/** Une vraie clé privée a un corps en base64 juste derrière son en-tête (même ligne ou les six suivantes). */
function corpsPresent(lignes: string[], i: number, reste: string): boolean {
  const candidats = [reste];
  for (let j = i + 1; j < Math.min(lignes.length, i + 1 + FENETRE_CORPS); j++) {
    if (ENTETE_BLOC.test(lignes[j])) break;
    const contenu = lignes[j].slice(1);
    if (FIN_CLE_PRIVEE.test(contenu)) break;
    candidats.push(contenu);
  }
  return candidats.some((c) => CORPS_DE_CLE.test(c.replace(/\r$/, '')));
}

/**
 * Un bloc qui commence au milieu d'une clé : on y trouve la fin d'une clé privée avant tout début, juste derrière une
 * ligne de base64. Tout ce qui précède cette fin dans le bloc est alors du corps de clé.
 */
function blocDansUneCle(lignes: string[], i: number): boolean {
  for (let j = i + 1; j < lignes.length && !ENTETE_BLOC.test(lignes[j]); j++) {
    const contenu = contenuDe(lignes[j]);
    if (DEBUT_CLE_PRIVEE.test(contenu)) return false;
    if (FIN_CLE_PRIVEE.test(contenu)) return j > i + 1 && LIGNE_BASE64.test(contenuDe(lignes[j - 1]));
  }
  return false;
}

/** Les lignes d'un corps de clé sans début ni fin dans le bloc : au moins deux lignes PEM de 64 caractères à la suite (et la dernière, plus courte). */
function lignesDeCorps(lignes: string[]): Set<number> {
  const corps = new Set<number>();
  let suite: number[] = [];
  const clore = (fin?: number) => {
    if (suite.length >= 2) {
      for (const k of suite) corps.add(k);
      if (fin !== undefined) corps.add(fin);
    }
    suite = [];
  };
  lignes.forEach((brute, i) => {
    if (ENTETE_BLOC.test(brute)) return clore();
    const contenu = contenuDe(brute);
    if (LIGNE_PEM.test(contenu)) return void suite.push(i);
    clore(FIN_PEM.test(contenu) ? i : undefined);
  });
  clore();
  return corps;
}

/** Passe tout le patch en revue : pour chaque ligne, le texte masqué, les genres vus, si elle est ajoutée et son numéro dans le nouveau fichier. */
function parcourir(patch: string): Ligne[] {
  const lignes = patch.split('\n');
  const sortie: Ligne[] = [];
  let courante: number | null = null;
  // `montre` : le masque « [clé privée masquée] » est déjà écrit pour cette clé.
  let cle: { rapporte: boolean; montre: boolean } | null = null;
  const corps = lignesDeCorps(lignes);

  lignes.forEach((brute, i) => {
    const brut = (): Ligne => ({ texte: brute, genres: [], ajoutee: false, ligne: null });
    const entete = ENTETE_BLOC.exec(brute);
    if (entete) {
      courante = Number(entete[1]);
      cle = blocDansUneCle(lignes, i) ? { rapporte: false, montre: false } : null;
      sortie.push(brut());
      return;
    }
    // « \ No newline at end of file » n'avance rien ; « +++ » et « --- » sont des en-têtes de fichier seulement avant le premier bloc.
    if (brute.startsWith('\\') || (courante === null && (brute.startsWith('+++') || brute.startsWith('---')))) {
      sortie.push(brut());
      return;
    }

    const prefixe = brute[0] === '+' || brute[0] === '-' || brute[0] === ' ' ? brute[0] : '';
    const contenu = brute.slice(prefixe.length);
    const ajoutee = prefixe === '+';
    const ligne = courante;
    if (courante !== null && (ajoutee || prefixe === ' ')) courante += 1;
    const genres: GenreCle[] = [];

    if (cle) {
      if (ajoutee && !cle.rapporte) {
        genres.push('clé privée');
        cle.rapporte = true;
      }
      const texte = prefixe + (cle.montre ? '' : masque('clé privée'));
      cle.montre = true;
      if (FIN_CLE_PRIVEE.test(contenu)) cle = null;
      sortie.push({ texte, genres, ajoutee, ligne });
      return;
    }

    const debut = DEBUT_CLE_PRIVEE.exec(contenu);
    if (debut) {
      const reste = contenu.slice(debut.index + debut[0].length);
      if (corpsPresent(lignes, i, reste)) {
        const fin = FIN_CLE_PRIVEE.exec(reste);
        if (ajoutee) genres.push('clé privée');
        if (!fin) cle = { rapporte: ajoutee, montre: true };
        const apres = fin ? reste.slice(fin.index + fin[0].length) : '';
        sortie.push({ texte: prefixe + contenu.slice(0, debut.index) + masque('clé privée') + apres, genres, ajoutee, ligne });
        return;
      }
    }

    // Corps de clé sans début ni fin dans ce bloc : masqué (sans constat : rien ne prouve que c'est une clé privée).
    if (corps.has(i)) {
      sortie.push({ texte: prefixe + (corps.has(i - 1) ? '' : masque('clé privée')), genres, ajoutee, ligne });
      return;
    }

    let texte = contenu;
    for (const { genre, re } of FORMES) {
      texte = texte.replace(re, () => {
        genres.push(genre);
        return masque(genre);
      });
    }
    sortie.push({ texte: prefixe + texte, genres, ajoutee, ligne });
  });
  return sortie;
}

/** Les secrets des lignes ajoutées (« + ») d'un patch, avec leur numéro de ligne dans le nouveau fichier. */
export function reperer(chemin: string, patch: string): TrouvailleCle[] {
  const resultat: TrouvailleCle[] = [];
  const vus = new Set<string>();
  const env = estFichierEnv(chemin);
  const noter = (ligne: number | null, genre: GenreCle) => {
    const id = `${ligne}|${genre}`;
    if (vus.has(id)) return;
    vus.add(id);
    resultat.push({ ligne, genre });
  };
  const brutes = patch.split('\n');
  parcourir(patch).forEach((l, i) => {
    if (!l.ajoutee) return;
    for (const genre of l.genres) noter(l.ligne, genre);
    const contenu = brutes[i].slice(1).replace(/\r$/, '');
    if (env && l.genres.length === 0 && (affectationReelle(contenu) || ADRESSE_AVEC_IDENTIFIANTS.test(contenu))) noter(l.ligne, 'secret dans un .env');
  });
  return resultat;
}

/** Le patch avec chaque secret reconnu remplacé par « [<genre> masquée] » (lignes ajoutées, retirées et de contexte). Le reste est intact. */
export function masquer(patch: string): string {
  return parcourir(patch).map((l) => l.texte).join('\n');
}

// --- Secrets génériques dans un texte libre (Paul) ------------------------------------------------
// Hors d'un .env, Léa ne regarde pas les affectations ni les adresses avec identifiants (trop de faux positifs dans
// du code). Pour un texte de documentation (README, CLAUDE.md), Paul les masque et les refuse : mieux vaut un faux
// positif qu'un mot de passe recopié. Ces fonctions ne changent rien au repérage de Léa.

/** `NOM_KEY=valeur`, `NOM_TOKEN: "valeur"`… n'importe où dans la ligne (puce, guillemets inverses, export). */
// `[ \t]*` : jamais à travers un retour à la ligne (YAML « GITHUB_TOKEN:\n  description: »).
const AFFECTATION_LIBRE = /(?<![A-Za-z0-9_])([A-Za-z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*)(["']?)([^\s"'`]+)\3/g;
/** Le mot de passe d'une adresse avec identifiants (`postgres://moi:motdepasse@hôte`). */
// La borne à gauche évite un temps quadratique sur une très longue ligne sans espace.
const ADRESSE_LIBRE = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/g;
const VALEUR_REFERENCE = /^(?:\$|<|\{|\[|%|process\.env|os\.environ|env\()/;
const MASQUE_SECRET = '[secret masqué]';
const MASQUE_MOT_DE_PASSE = '[mot de passe masqué]';

const valeurReelle = (v: string, min: number) => v.length >= min && !VALEUR_FACTICE.test(v) && !VALEUR_REFERENCE.test(v) && !/^\*+$/.test(v);
/**
 * Une valeur qui ressemble à un jeton : sans espace ni accent, avec des chiffres ou des majuscules et minuscules mêlées
 * (« abcd1234efgh », « Sup3rS3cret ») — jamais un mot de prose (« nécessaire », « obligatoire », « required »).
 */
const ressembleJeton = (v: string, min: number) =>
  valeurReelle(v, min) && /^[A-Za-z0-9_\-./+=~]+$/.test(v) && (/\d/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));

/** Le texte avec chaque affectation de secret à vraie valeur et chaque mot de passe d'adresse remplacés par un masque. */
export function masquerSecretsGeneriques(texte: string): string {
  return texte
    .replace(AFFECTATION_LIBRE, (tout, avant: string, genre: string, q: string, v: string) => (ressembleJeton(v, genre === '_PASSWORD' ? 8 : 12) ? `${avant}${q}${MASQUE_SECRET}${q}` : tout))
    .replace(ADRESSE_LIBRE, (tout, avant: string, v: string, a: string) => (valeurReelle(v, 1) ? `${avant}${MASQUE_MOT_DE_PASSE}${a}` : tout));
}

/** Vrai si le texte contient une affectation de secret à vraie valeur ou une adresse avec mot de passe. */
export const contientSecretGenerique = (texte: string): boolean => masquerSecretsGeneriques(texte) !== texte;
