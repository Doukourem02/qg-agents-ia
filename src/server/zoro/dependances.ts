// Zoro : choisir les fichiers de dépendances d'un dépôt et les lire. Fonctions pures, sans réseau, sans nouvelle dépendance.

import type { Dependance } from './types';

const NOMS_SUIVIS = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'requirements.txt', 'poetry.lock']);
const VERROUS = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
const VERSION_EXACTE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-+]+)?$/;

/** Fichiers à lire : racine et jusqu'à deux dossiers plus bas (apps/web), jamais sous node_modules. L'ordre reçu est gardé. */
export function fichiersDeDependances(chemins: string[]): string[] {
  return chemins.filter((chemin) => {
    const morceaux = chemin.split('/');
    if (morceaux.length > 3 || morceaux.includes('node_modules')) return false;
    return NOMS_SUIVIS.has(morceaux[morceaux.length - 1]);
  });
}

function nomEtVersion(cle: string): { nom: string; version: string } | null {
  const i = cle.lastIndexOf('@');
  if (i <= 0) return null;
  const version = cle.slice(i + 1);
  return VERSION_EXACTE.test(version) ? { nom: cle.slice(0, i), version } : null;
}

function lireJson(texte: string): Record<string, unknown> | null {
  try {
    const lu: unknown = JSON.parse(texte);
    return lu && typeof lu === 'object' && !Array.isArray(lu) ? (lu as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function objet(valeur: unknown): Record<string, unknown> {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {};
}

const npm = (nom: string, version: string): Dependance => ({ nom, version, ecosysteme: 'npm', directeProd: false });

// Un verrou lu : ses dépendances, ce qui compte comme « directe de production » (version résolue), et les sous-dossiers
// (chemins relatifs au verrou) qu'il couvre déjà ; 'tout' quand le format ne le dit pas (yarn v1 : workspaces).
type Verrou = { deps: Dependance[]; direct: (d: Dependance) => boolean; couvre: Set<string> | 'tout' };
const cleDe = (nom: string, version: string) => `${nom}@${version}`;

function sansGuillemets(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}

function lirePnpm(texte: string): Verrou | null {
  if (!/^lockfileVersion:/m.test(texte)) return null;
  const deps: Dependance[] = [];
  const directes = new Set<string>();
  const couvre = new Set<string>();
  let candidats = 0;
  let section = '';
  let importer = false; // dans un importer (indent 2)
  let enProd = false; // dans sa liste `dependencies:` (indent 4)
  let nomCourant: string | null = null;
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.trim() || ligne.trimStart().startsWith('#')) continue;
    if (/^\S/.test(ligne)) { section = /^(importers|packages|snapshots):\s*$/.exec(ligne)?.[1] ?? ''; importer = false; enProd = false; continue; }
    if (section === 'importers') {
      if (/^ {2}\S/.test(ligne)) {
        importer = true; enProd = false;
        couvre.add(sansGuillemets(ligne.trim().replace(/:\s*$/, '')).replace(/^\.\/?/, ''));
        continue;
      }
      if (!importer) continue;
      if (/^ {4}\S/.test(ligne)) { enProd = /^ {4}dependencies:\s*$/.test(ligne); nomCourant = null; continue; }
      if (!enProd) continue;
      const nom = /^ {6}(\S.*?):\s*(.*)$/.exec(ligne);
      if (nom && !/^ {8}/.test(ligne)) {
        nomCourant = sansGuillemets(nom[1]);
        // Forme courte `nom: 1.2.3` (anciens formats) ; la forme longue donne `version:` à la ligne suivante.
        const direct = nom[2] ? nom[2].replace(/\(.*$/, '').trim() : '';
        if (direct && VERSION_EXACTE.test(direct)) directes.add(cleDe(nomCourant, direct));
        continue;
      }
      const v = /^ {8}version:\s*(\S.*?)\s*$/.exec(ligne);
      if (v && nomCourant) {
        const version = sansGuillemets(v[1]).replace(/\(.*$/, '');
        if (VERSION_EXACTE.test(version)) directes.add(cleDe(nomCourant, version));
      }
      continue;
    }
    if (section !== 'packages' && section !== 'snapshots') continue;
    const m = /^ {2}(\S.*?):\s*(?:\{\})?\s*$/.exec(ligne);
    if (!m) continue;
    candidats++;
    let cle = sansGuillemets(m[1]).replace(/^\//, '');
    const peer = cle.indexOf('(');
    if (peer >= 0) cle = cle.slice(0, peer);
    const lu = nomEtVersion(cle);
    if (lu) deps.push(npm(lu.nom, lu.version));
  }
  if (candidats > 0 && deps.length === 0) return null; // entrées présentes mais format non reconnu
  return { deps, direct: (d) => directes.has(cleDe(d.nom, d.version)), couvre };
}

// Yarn v1 ne permet pas de savoir quelle version résout une dépendance directe : on garde la comparaison par nom.
function lireYarn(texte: string, prod: Set<string>): Verrou | null {
  const deps: Dependance[] = [];
  let noms: string[] = [];
  let contenu = false;
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.trim() || ligne.startsWith('#')) continue;
    contenu = true;
    if (!/^\s/.test(ligne)) {
      noms = ligne.replace(/:\s*$/, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).map((s) => s.slice(0, s.lastIndexOf('@'))).filter((s) => s.length > 0);
      continue;
    }
    const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(ligne);
    if (m && noms.length > 0 && VERSION_EXACTE.test(m[1])) {
      deps.push(npm(noms[0], m[1]));
      noms = [];
    }
  }
  if (contenu && deps.length === 0) return null;
  return { deps, direct: (d) => prod.has(d.nom), couvre: 'tout' };
}

function lireNpmLock(texte: string): Verrou | null {
  const racine = lireJson(texte);
  const paquets = racine?.packages;
  if (!paquets || typeof paquets !== 'object') return null;
  const table = paquets as Record<string, unknown>;
  const deps: Dependance[] = [];
  let candidats = 0;
  for (const [cle, valeur] of Object.entries(table)) {
    const marque = 'node_modules/';
    const i = cle.lastIndexOf(marque);
    if (i < 0) continue;
    const entree = objet(valeur);
    if (entree.link === true) continue;
    candidats++;
    if (typeof entree.version !== 'string' || !VERSION_EXACTE.test(entree.version)) continue;
    deps.push(npm(cle.slice(i + marque.length), entree.version));
  }
  if (candidats > 0 && deps.length === 0) return null;
  // Directes de production : noms de la racine et de chaque workspace (clé sans node_modules/), à leur version résolue :
  // d'abord sous le workspace, sinon au premier niveau.
  const directes = new Set<string>();
  const couvre = new Set<string>();
  for (const [cle, valeur] of Object.entries(table)) {
    if (cle.includes('node_modules/')) continue;
    if (cle !== '') couvre.add(cle);
    for (const nom of Object.keys(objet(objet(valeur).dependencies))) {
      const propre = cle === '' ? undefined : objet(table[`${cle}/node_modules/${nom}`]).version;
      const version = typeof propre === 'string' ? propre : objet(table[`node_modules/${nom}`]).version;
      if (typeof version === 'string') directes.add(cleDe(nom, version));
    }
  }
  return { deps, direct: (d) => directes.has(cleDe(d.nom, d.version)), couvre };
}

/**
 * Sans verrouillage : versions de package.json sans ^ ni ~ ; une plage non exacte est ignorée.
 * « Directe de production » seulement pour une version épinglée exactement : le plancher d'une plage (^1.2.3) n'est pas
 * la version installée, il reste dans la page sans jamais faire vibrer le téléphone.
 */
function lireManifeste(json: Record<string, unknown>): Dependance[] {
  const sortie: Dependance[] = [];
  for (const champ of ['dependencies', 'devDependencies'] as const) {
    for (const [nom, plage] of Object.entries(objet(json[champ]))) {
      if (typeof plage !== 'string') continue;
      const brute = plage.trim();
      const version = brute.replace(/^[\^~]/, '');
      if (VERSION_EXACTE.test(version)) sortie.push({ nom, version, ecosysteme: 'npm', directeProd: champ === 'dependencies' && VERSION_EXACTE.test(brute) });
    }
  }
  return sortie;
}

function lireRequirements(texte: string): Dependance[] {
  const sortie: Dependance[] = [];
  for (const brute of texte.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([0-9][0-9A-Za-z.+!-]*)\s*(?:[;#].*)?$/.exec(brute.trim());
    if (m) sortie.push({ nom: m[1], version: m[2], ecosysteme: 'PyPI', directeProd: true });
  }
  return sortie;
}

/**
 * Lit tous les fichiers d'un dépôt (chemin → contenu). Null si un fichier présent est illisible :
 * jamais une liste vide pour dire « sain » quand on n'a pas pu lire.
 */
export function lireDependances(fichiers: Record<string, string>): Dependance[] | null {
  const dossiers = new Map<string, Map<string, string>>();
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const i = chemin.lastIndexOf('/');
    const dossier = i < 0 ? '' : chemin.slice(0, i);
    const nom = chemin.slice(i + 1);
    if (!NOMS_SUIVIS.has(nom)) continue;
    if (!dossiers.has(dossier)) dossiers.set(dossier, new Map());
    dossiers.get(dossier)!.set(nom, contenu);
  }

  const fusion = new Map<string, Dependance>();
  const ajouter = (d: Dependance) => {
    const cle = `${d.ecosysteme}\0${d.nom}\0${d.version}`;
    const deja = fusion.get(cle);
    if (!deja) fusion.set(cle, d);
    else if (d.directeProd) deja.directeProd = true;
  };

  // Les manifestes d'abord : un package.json illisible rend tout le dépôt illisible.
  const manifestes = new Map<string, Record<string, unknown>>();
  for (const [dossier, f] of dossiers) {
    const manifeste = f.get('package.json');
    if (manifeste === undefined) continue;
    const json = lireJson(manifeste);
    if (!json) return null;
    manifestes.set(dossier, json);
  }

  // Le verrou npm le plus proche au-dessus d'un dossier qui n'a pas le sien (verrou de la racine d'un monorepo).
  const aVerrou = (dossier: string) => VERROUS.some((n) => dossiers.get(dossier)?.has(n));
  const ancetre = (dossier: string): string | null => {
    if (dossier === '' || aVerrou(dossier)) return null;
    const parties = dossier.split('/');
    for (let i = parties.length - 1; i >= 0; i--) {
      const a = parties.slice(0, i).join('/');
      if (aVerrou(a)) return a;
    }
    return null;
  };
  const relatif = (a: string, dossier: string) => (a === '' ? dossier : dossier.slice(a.length + 1));
  const prodDe = (json: Record<string, unknown> | undefined) => Object.keys(objet(json?.dependencies));

  const verrous = new Map<string, Verrou>();
  for (const [dossier, f] of dossiers) {
    if (!aVerrou(dossier)) continue;
    const json = manifestes.get(dossier);
    // yarn v1 ne dit pas quels workspaces il couvre : les dépendances de production des sous-paquets comptent aussi.
    const prod = new Set(prodDe(json));
    for (const [d, j] of manifestes) if (ancetre(d) === dossier) for (const nom of prodDe(j)) prod.add(nom);
    const verrou = f.has('pnpm-lock.yaml') ? lirePnpm(f.get('pnpm-lock.yaml')!)
      : f.has('package-lock.json') ? lireNpmLock(f.get('package-lock.json')!)
      : lireYarn(f.get('yarn.lock')!, prod);
    if (verrou === null) return null;
    // Un verrou qui ne donne rien alors que package.json déclare des dépendances : lecture ratée, pas un dépôt sain.
    if (verrou.deps.length === 0 && json && (Object.keys(objet(json.dependencies)).length > 0 || Object.keys(objet(json.devDependencies)).length > 0)) return null;
    verrous.set(dossier, verrou);
  }

  for (const [dossier, f] of dossiers) {
    const verrou = verrous.get(dossier);
    const json = manifestes.get(dossier);
    if (verrou) for (const d of verrou.deps) ajouter({ ...d, directeProd: verrou.direct(d) });
    else if (json) {
      // Un sous-paquet déjà couvert par le verrou de la racine n'est pas relu à part (ses versions y sont résolues).
      const a = ancetre(dossier);
      const parent = a === null ? undefined : verrous.get(a);
      const couvert = parent !== undefined && (parent.couvre === 'tout' || parent.couvre.has(relatif(a!, dossier)));
      if (!couvert) for (const d of lireManifeste(json)) ajouter(d);
    }

    if (f.has('requirements.txt')) for (const d of lireRequirements(f.get('requirements.txt')!)) ajouter(d);
    else if (f.has('poetry.lock')) return null; // Poetry n'est pas lu : on le dit, on ne le déclare pas sain.
  }
  return [...fusion.values()];
}
