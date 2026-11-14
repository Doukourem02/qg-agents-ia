// Zoro, le Gardien (côté Mac) : une fois par jour, relève l'état git de chaque dossier de ~/Desktop/Code et l'envoie au QG.
// Lecture seule : git n'est appelé que pour status, rev-list, log, remote get-url et stash list, avec un argv fixe, jamais de shell.
// Tout ce qui touche au système (exec, fichiers, horloge) est injecté : rien n'est testé sur le vrai disque.
// Les noms de fichiers ne servent qu'à lire une date (stat) : ils ne sont ni renvoyés, ni journalisés.
import { join } from 'node:path';

const MAX_NOM = 200;

/** Propriétaire d'une URL de dépôt github.com (https ou ssh) ; tout autre hôte → null. Le reste de l'URL (jeton éventuel) n'est jamais gardé. */
export function ownerGithub(url) {
  const u = String(url ?? '').trim();
  const m = /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/[^/]+$/.exec(u)
    ?? /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/[^/]+$/.exec(u);
  return m && /^[A-Za-z0-9-]{1,100}$/.test(m[1]) ? m[1] : null;
}

/** Lit un chemin entre guillemets de git (échappements C, octal = octets UTF-8) à partir de `i` ; rend [chemin, indice suivant]. */
function lireGuillemets(s, i) {
  const SIMPLES = { n: 10, t: 9, a: 7, b: 8, f: 12, r: 13, v: 11, '"': 34, '\\': 92 };
  const octets = [];
  let k = i + 1;
  for (; k < s.length && s[k] !== '"'; k++) {
    if (s[k] !== '\\') { octets.push(...Buffer.from(s[k])); continue; }
    const o = /^[0-7]{3}/.exec(s.slice(k + 1, k + 4));
    if (o) { octets.push(parseInt(o[0], 8)); k += 3; } else if (SIMPLES[s[k + 1]] !== undefined) { octets.push(SIMPLES[s[k + 1]]); k++; }
  }
  return [Buffer.from(octets).toString('utf8'), k + 1];
}

/**
 * Lit la sortie de `git status --porcelain` : le nombre de lignes, et les chemins des fichiers qui existent encore
 * (les suppressions comptent mais n'ont pas de date ; pour un renommage, seul le nouveau nom).
 */
export function cheminsStatus(sortie) {
  const lignes = String(sortie ?? '').split('\n').filter(l => l.length > 3);
  const chemins = [];
  for (const l of lignes) {
    const xy = l.slice(0, 2), reste = l.slice(3);
    if (xy.includes('D')) continue;
    let chemin;
    if (reste.startsWith('"')) {
      let [p, suite] = lireGuillemets(reste, 0);
      if (reste.startsWith(' -> ', suite)) [p] = reste[suite + 4] === '"' ? lireGuillemets(reste, suite + 4) : [reste.slice(suite + 4)];
      chemin = p;
    } else {
      const f = reste.indexOf(' -> ');
      const nouveau = f === -1 ? reste : reste.slice(f + 4);
      chemin = nouveau.startsWith('"') ? lireGuillemets(nouveau, 0)[0] : nouveau;
    }
    chemins.push(chemin);
  }
  return { total: lignes.length, chemins };
}

const entierPositif = s => { const n = Number(String(s).trim()); return Number.isInteger(n) && n >= 0 ? n : null; };
const nonVides = s => String(s ?? '').split('\n').filter(l => l.trim() !== '');

/**
 * Les noms que le serveur accepterait (même règle que `nomValide` dans src/server/zoro/mac.ts : à garder identique) :
 * ni vide, ni « .. », ni « / » au début ou dedans (un nom de premier niveau n'en a pas), ni « \ » ; en plus, ni caché ni node_modules.
 */
const nomAcceptable = nom => nom !== '' && nom.length <= MAX_NOM && !nom.startsWith('.') && nom !== 'node_modules'
  && !nom.includes('..') && !nom.includes('/') && !nom.includes('\\');

async function sousDossiers(fs, dossier) {
  let entrees;
  try { entrees = await fs.lister(dossier); } catch { return null; }
  return entrees;
}

async function mtime(fs, chemin) {
  // Une date d'avant 1970 (négative) n'est pas une date utilisable : le serveur la refuserait, on l'ignore.
  try { const s = await fs.stat(chemin); return Number.isFinite(s?.mtimeMs) && s.mtimeMs >= 0 ? Math.round(s.mtimeMs) : null; } catch { return null; }
}

/** État d'un dossier git. Une commande qui échoue (pas de commit, pas de distant…) donne une valeur sûre, jamais une erreur. */
async function etatGit(deps, nom, chemin, modifieDossier) {
  const { exec, fs } = deps;
  let illisible = false; // au moins une lecture ratée : le dossier est « non lu », jamais compté comme sain
  const git = async (...args) => {
    try { return String((await exec('git', ['-C', chemin, ...args]))?.stdout ?? ''); } catch { illisible = true; return null; }
  };

  const status = cheminsStatus(await git('status', '--porcelain'));
  let plusAncienNonEnregistre = null;
  for (const c of status.chemins) {
    if (c.includes('..') || c.startsWith('/')) continue;
    const t = await mtime(fs, join(chemin, c));
    if (t !== null && (plusAncienNonEnregistre === null || t < plusAncienNonEnregistre)) plusAncienNonEnregistre = t;
  }

  const nonPousses = entierPositif(await git('rev-list', '--branches', '--not', '--remotes', '--count')) ?? 0;
  let plusAncienNonPousse = null;
  if (nonPousses > 0) {
    for (const l of nonVides(await git('rev-list', '--branches', '--not', '--remotes', '--format=%ct'))) {
      const t = /^\d+$/.test(l.trim()) ? Number(l.trim()) * 1000 : null;
      if (t !== null && (plusAncienNonPousse === null || t < plusAncienNonPousse)) plusAncienNonPousse = t;
    }
  }

  const s = await git('log', '-1', '--format=%ct');
  const secondes = s === null || s.trim() === '' ? null : entierPositif(s);
  const dernierCommit = secondes === null ? null : secondes * 1000;
  // distant = au moins un dépôt distant déclaré ; le compte vient d'origin, à défaut du premier de la liste.
  const noms = nonVides(await git('remote')).map(l => l.trim());
  const distant = noms.length > 0;
  const choisi = noms.includes('origin') ? 'origin' : noms[0];
  const compte = distant ? ownerGithub(await git('remote', 'get-url', choisi)) : null;
  const stashes = nonVides(await git('stash', 'list')).length;

  return {
    nom, git: true, compte, distant,
    nonEnregistres: status.total, plusAncienNonEnregistre,
    nonPousses, plusAncienNonPousse, stashes, dernierCommit,
    modifie: Math.max(modifieDossier, dernierCommit ?? 0),
    ...(illisible ? { illisible: true } : {}),
  };
}

// `illisible` : le dossier n'a pas pu être listé (droits refusés…) ; on ne sait pas s'il est suivi par git : « non lu », jamais sain.
const horsGit = (nom, modifie, illisible = false) => ({
  nom, git: false, compte: null, distant: false, nonEnregistres: 0, plusAncienNonEnregistre: null,
  nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: null, modifie,
  ...(illisible ? { illisible: true } : {}),
});

/**
 * L'état de chaque dossier de premier niveau de `racine` (et, pour un dossier sans .git, de ses enfants qui en ont un).
 * Un dossier qui pose problème devient « non lu » (illisible) ou prend des valeurs sûres : le scan ne s'arrête jamais pour un seul.
 */
export async function etatDossiers({ racine, exec, fs }) {
  const premiers = (await fs.lister(racine)).filter(e => e.dossier && !e.lien && nomAcceptable(e.nom)).map(e => e.nom).sort();
  const sortie = [];
  const deps = { exec, fs };
  for (const nom of premiers) {
    const chemin = join(racine, nom);
    const modifie = (await mtime(fs, chemin)) ?? 0;
    const contenu = await sousDossiers(fs, chemin);
    if (contenu === null) { sortie.push(horsGit(nom, modifie, true)); continue; }
    if (contenu.some(e => e.nom === '.git')) { sortie.push(await etatGit(deps, nom, chemin, modifie)); continue; }
    sortie.push(horsGit(nom, modifie));
    for (const enfant of contenu.filter(e => e.dossier && !e.lien && nomAcceptable(e.nom)).map(e => e.nom).sort()) {
      const cheminEnfant = join(chemin, enfant);
      const dedans = await sousDossiers(fs, cheminEnfant);
      const nomEnfant = `${nom}/${enfant}`;
      if (nomEnfant.length > MAX_NOM) continue;
      if (dedans === null) { sortie.push(horsGit(nomEnfant, (await mtime(fs, cheminEnfant)) ?? 0, true)); continue; }
      if (!dedans.some(e => e.nom === '.git')) continue;
      sortie.push(await etatGit(deps, nomEnfant, cheminEnfant, (await mtime(fs, cheminEnfant)) ?? 0));
    }
  }
  return sortie;
}

const jourDe = now => new Date(now).toISOString().slice(0, 10);
const ATTENTE_APRES_ECHEC_MS = 60 * 60_000;

/**
 * Un passage de Zoro : envoie le rapport une fois par jour, ou tout de suite si le QG le demande (`a-envoyer`).
 * Rend ce qu'il faut garder dans l'état du relais. Un envoi raté est gardé (`zoroEchec`) : pas de nouveau scan complet
 * avant une heure (le relais passe toutes les 5 minutes), sauf si le QG demande un rapport.
 */
export async function passageZoro({ now, etat = {}, appeler, racine, exec, fs, journal = () => {} }) {
  const jour = jourDe(now);
  let demande = false;
  try { demande = (await appeler('a-envoyer'))?.demande === true; } catch (e) { journal(`zoro : a-envoyer en échec (${e.message})`); }
  if (etat.derniereZoro === jour && !demande) return {};
  if (!demande && typeof etat.zoroEchec === 'number' && now - etat.zoroEchec < ATTENTE_APRES_ECHEC_MS) return {};
  const dossiers = await etatDossiers({ racine, exec, fs });
  try { await appeler('mac', { quand: now, dossiers }); } catch (e) {
    journal(`zoro : envoi en échec (${e.message}), nouvel essai dans une heure`);
    return { zoroEchec: now };
  }
  journal(`zoro : ${dossiers.length} dossier(s) envoyé(s)`);
  return { derniereZoro: jour, zoroEchec: undefined };
}
