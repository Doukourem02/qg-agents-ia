// Le relais Mac de Mafe : lancé toutes les 5 minutes par launchd.
//  - quand le patron s'assoit (première activité depuis 60 min), rafraîchit le QG et ouvre Safari sur le menu des comptes rendus ;
//  - à chaque passage, copie dans Obsidian les notes de séance pas encore copiées ;
//  - à chaque passage, Isaac (mac/isaac.mjs) : exécute ce que le patron a accepté, mesure la place une fois par heure, propose ;
//  - à chaque passage, Zoro (mac/zoro.mjs) : envoie l'état git des dossiers de ~/Desktop/Code une fois par jour (ou sur demande du QG) ;
//  - à chaque passage, Feu (mac/feu.mjs) : lit le compte Binance en lecture seule (clé du Trousseau, droits vérifiés) et envoie les montants.
// Tout ce qui touche au système (réseau, Safari, Trousseau, fichiers, horloge) est injecté dans passage().
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mettreAJour } from './memoire.mjs';
import { passageIsaac } from './isaac.mjs';
import { passageZoro } from './zoro.mjs';
import { passageFeu } from './feu.mjs';

const BASE = 'https://mon-qg.vercel.app';
const URL_ARRIVEE = `${BASE}/?arrivee=1`;
const SIXTY = 60 * 60_000;

export function estArrivee(etat = {}, now) {
  const loin = t => t === undefined || t === null || now - t >= SIXTY;
  return loin(etat.dernierPassage) && loin(etat.derniereOuverture);
}

const proprete = s => String(s).replace(/[/\\]/g, '').replace(/^\.+/, '').trim();

/** `n` > 1 : « … (2).md », « … (3).md » (jamais d'écrasement d'une séance déjà dans le coffre). */
export function cheminSeance(coffre, note, n = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(note.jour)) throw new Error('jour invalide');
  const nom = proprete(note.nom);
  if (!nom) throw new Error('nom invalide');
  return `${coffre}/Séances/${note.jour} — ${nom}${n > 1 ? ` (${n})` : ''}.md`;
}

// L'arbre du coffre : Mon Mac → Code → Projet → « Projet · Séances » → « Projet · AAAA-MM » → la séance.
export function cheminsArbre(coffre, note) {
  const nom = proprete(note.nom);
  if (!nom) throw new Error('nom invalide');
  const mois = note.jour.slice(0, 7);
  return {
    mois: `${coffre}/Carte/${nom} · ${mois}.md`,
    seances: `${coffre}/Carte/${nom} · Séances.md`,
    projet: `${coffre}/Projets/${nom}.md`,
    code: `${coffre}/Carte/Code.md`,
    nom, titreMois: `${nom} · ${mois}`, titreSeances: `${nom} · Séances`,
  };
}

// Refuse tout chemin qui n'est pas sous <coffre>/Séances/, Projets/ ou Carte/ (mastack/ exclu d'office).
export function cheminSur(coffre, chemin) {
  const p = resolve(chemin);
  const ok = ['Séances', 'Projets', 'Carte'].some(d => p.startsWith(resolve(coffre, d) + sep));
  if (!ok) throw new Error('chemin refusé : hors de Séances/, Projets/ et Carte/');
  return p;
}

/** Ajoute « - [[cible]] » une seule fois (sous `section` si elle existe, sinon à la fin) ; crée la note « # titre » si vide. */
export function ajouterLien(contenu, titre, cible, section) {
  const lien = `- [[${cible}]]`;
  if (!contenu || !contenu.trim()) return `# ${titre}\n\n${section ? `## ${section}\n` : ''}${lien}\n`;
  const base = contenu;
  if (base.includes(`[[${cible}]]`)) return base;
  const lignes = base.replace(/\n*$/, '').split('\n');
  const debut = section ? lignes.findIndex(l => l.trim() === `## ${section}`) : -1;
  if (section && debut === -1) return `${lignes.join('\n')}\n\n## ${section}\n${lien}\n`;
  let at = lignes.length;
  if (debut !== -1) {
    const fin = lignes.findIndex((l, i) => i > debut && /^##\s/.test(l));
    at = fin === -1 ? lignes.length : fin;
    while (at > debut + 1 && lignes[at - 1].trim() === '') at--;
  }
  lignes.splice(at, 0, lien);
  return lignes.join('\n') + '\n';
}

export async function passage({ now, lireEtat, ecrireEtat, appeler, ouvrir, ecrireFichier, creerFichier, lireFichier, coffre, memoire, isaac, zoro, feu, journal = () => {} }) {
  const etat = (await lireEtat().catch(() => ({}))) ?? {};
  const arrivee = estArrivee(etat, now);
  const suivant = { ...etat, dernierPassage: now };

  if (arrivee) {
    try { await appeler('rafraichir', {}); journal('rafraichir : ok'); } catch (e) { journal(`rafraichir : échec (${e.message})`); }
    try { await ouvrir(URL_ARRIVEE); suivant.derniereOuverture = now; journal('Safari ouvert'); } catch (e) {
      // Safari n'a pas pu s'ouvrir : on ne touche pas à dernierPassage, le prochain passage (5 min) réessaie.
      suivant.dernierPassage = etat.dernierPassage;
      if (suivant.dernierPassage === undefined) delete suivant.dernierPassage;
      journal(`ouverture : échec (${e.message}), nouvel essai au prochain passage`);
    }
  }
  // Une fois par jour : la mémoire du coffre (nouveaux commits, journées, documents, projets) et l'arbre.
  const jour = new Date(now).toISOString().slice(0, 10);
  if (memoire && etat.derniereMemoire !== jour) {
    try {
      const b = await memoire();
      suivant.derniereMemoire = jour;
      journal(`mémoire : ${b.commits} commit(s), ${b.seances} journée(s), ${b.docs} document(s), ${b.projets} projet(s) nouveaux`);
    } catch (e) { journal(`mémoire : échec (${e.message}), nouvel essai au prochain passage`); }
  }
  // Isaac : rend ce qu'il faut garder dans l'état (dernière mesure, propositions envoyées, résultats pas encore rapportés).
  if (isaac) {
    try { Object.assign(suivant, await isaac(etat)); } catch (e) { journal(`isaac : échec (${e.message})`); }
  }
  // Zoro : l'état des dossiers git, une fois par jour (derniereZoro = jour du dernier envoi réussi ; zoroEchec = dernier envoi raté).
  if (zoro) {
    try { Object.assign(suivant, await zoro(etat)); } catch (e) { journal(`zoro : échec (${e.message}), nouvel essai au prochain passage`); }
  }
  // Feu : le compte Binance en lecture seule (clé absente : le QG le sait, une fois par heure au plus).
  if (feu) {
    try { Object.assign(suivant, await feu(etat)); } catch (e) { journal(`feu : échec (${e.message})`); }
  }
  await ecrireEtat(suivant).catch(e => journal(`état : échec (${e.message})`));

  let notes;
  try {
    const r = await appeler('a-copier');
    notes = Array.isArray(r) ? r : r?.notes;
    if (!Array.isArray(notes)) throw new Error('réponse inattendue');
  } catch (e) { journal(`a-copier : échec (${e.message}), copie sautée`); return; }

  // Écrit la séance sans jamais écraser : « (2) », « (3) »… si le nom est pris par un autre contenu.
  // Si le fichier existant est exactement cette note (copie interrompue au passage d'avant), on le reprend.
  const creerSeance = async n => {
    for (let k = 1; k < 1000; k++) {
      const chemin = cheminSur(coffre, cheminSeance(coffre, n, k));
      try { await creerFichier(chemin, n.markdown); }
      catch (e) {
        if (e?.code !== 'EEXIST') throw e;
        if ((await lireFichier(chemin)) === n.markdown) { /* déjà écrite par nous */ } else continue;
      }
      return chemin.slice(chemin.lastIndexOf('/') + 1).replace(/\.md$/, '');
    }
    throw new Error('trop de séances du même nom');
  };

  const ids = [];
  for (const n of notes) {
    try {
      const fichier = await creerSeance(n);
      const a = cheminsArbre(coffre, n);
      // Du plus bas au plus haut : le mois, la branche Séances, le projet, la liste des projets.
      for (const [chemin, titre, cible, section] of [
        [a.mois, a.titreMois, fichier],
        [a.seances, a.titreSeances, a.titreMois],
        [a.projet, a.nom, a.titreSeances, 'Branches'],
        [a.code, 'Code', a.nom],
      ]) {
        const sur = cheminSur(coffre, chemin);
        const avant = await lireFichier(sur);
        const apres = ajouterLien(avant ?? '', titre, cible, section);
        if (apres !== avant) await ecrireFichier(sur, apres);
      }
      ids.push(n.id);
    } catch (e) { journal(`note ${n?.id} : échec (${e.message})`); }
  }
  if (ids.length) {
    try { await appeler('copie', { ids }); journal(`${ids.length} note(s) copiée(s)`); } catch (e) { journal(`copie : échec (${e.message})`); }
  }
}

// ---- Branchement réel (seulement quand lancé directement) ----
const exec = promisify(execFile);

/**
 * La clé Binance en lecture seule de Feu, et son secret, depuis le Trousseau (jamais écrits ailleurs, jamais journalisés).
 * Absente (code 44 de `security`) → null : Feu ne lit rien.
 */
async function lireCleBinance() {
  const lire = async service => {
    try { return (await exec('security', ['find-generic-password', '-s', service, '-w'])).stdout.trim(); } catch (e) { if (e?.code === 44) return null; throw e; }
  };
  const cle = await lire('qg-binance-lecture');
  const secret = cle ? await lire('qg-binance-secret') : null;
  return cle && secret ? { cle, secret } : null;
}

async function lireBypass() {
  const { stdout } = await exec('security', ['find-generic-password', '-s', 'qg-bypass', '-w']);
  return stdout.trim(); // gardé en mémoire seulement, jamais journalisé
}

const LECTURES = new Set(['a-copier', 'a-faire', 'a-envoyer']);

// Sous launchd, le PATH est minimal : on y met les outils (pnpm, npm de nvm à côté de node ; brew). Jamais de shell.
const PATH_OUTILS = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
const execOutil = (cmd, args) => exec(cmd, args, {
  timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: PATH_OUTILS, HOMEBREW_NO_AUTO_UPDATE: '1' },
});
// pgrep : 0 = trouvé, 1 = rien ; toute autre erreur compte comme « lancé » (dans le doute, on ne touche pas).
const pgrepReel = async args => {
  try { await exec('pgrep', args); return true; } catch (e) { return e?.code !== 1; }
};
const fsIsaac = {
  realpath: p => realpathSync.native(p),
  lister: async d => {
    try { return (await readdir(d, { withFileTypes: true })).map(e => ({ nom: e.name, dossier: e.isDirectory(), lien: e.isSymbolicLink() })); }
    catch (e) { if (e?.code === 'ENOENT') return []; throw e; }
  },
  rm: (p, o) => rm(p, o),
};
// Zoro ne fait que lire. GIT_OPTIONAL_LOCKS=0 : `git status` ne réécrit pas l'index ; core.fsmonitor=false : aucun programme du dépôt
// n'est lancé ; GIT_TERMINAL_PROMPT=0 : jamais de question. Les trois par l'environnement, pour garder l'argv de git fixe.
const execGit = (cmd, args) => exec(cmd, args, {
  timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  env: {
    ...process.env, PATH: PATH_OUTILS, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false',
  },
});
const fsZoro = { lister: fsIsaac.lister, stat: async p => ({ mtimeMs: (await lstat(p)).mtimeMs }) };

async function principal() {
  const coffre = join(homedir(), 'Documents', 'Obsidian Vault');
  const fichierEtat = join(homedir(), 'Library', 'Application Support', 'QG', 'relais.json');
  const journal = m => console.log(`${new Date().toISOString()} ${m}`);
  let bypass;
  const appelerAgent = async (agent, commande, corps) => {
    bypass ??= await lireBypass();
    const lecture = LECTURES.has(commande);
    const r = await fetch(`${BASE}/api/agents/${agent}/${commande}`, {
      method: lecture ? 'GET' : 'POST',
      headers: { 'x-vercel-protection-bypass': bypass, ...(lecture ? {} : { 'content-type': 'application/json' }) },
      ...(lecture ? {} : { body: JSON.stringify(corps ?? {}) }),
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status})`);
    if (!r.ok) throw new Error(`statut ${r.status}`);
    return r.json();
  };
  const appeler = (commande, corps) => appelerAgent('mafe', commande, corps);
  const now = Date.now();
  await passage({
    now,
    coffre,
    journal,
    lireEtat: async () => { try { return JSON.parse(await readFile(fichierEtat, 'utf8')); } catch { return {}; } },
    ecrireEtat: async e => { await mkdir(dirname(fichierEtat), { recursive: true }); await writeFile(fichierEtat, JSON.stringify(e)); },
    appeler,
    ouvrir: url => exec('open', ['-a', 'Safari', url]),
    memoire: async () => mettreAJour(coffre, join(homedir(), 'Desktop', 'Code')),
    isaac: etat => passageIsaac({
      now, etat, journal, home: homedir(), fs: fsIsaac, exec: execOutil, pgrep: pgrepReel,
      appeler: (commande, corps) => appelerAgent('isaac', commande, corps),
    }),
    zoro: etat => passageZoro({
      now, etat, journal, racine: join(homedir(), 'Desktop', 'Code'), fs: fsZoro, exec: execGit,
      appeler: (commande, corps) => appelerAgent('zoro', commande, corps),
    }),
    feu: etat => passageFeu({
      now, etat, journal, fetch, lireCle: lireCleBinance,
      appeler: (commande, corps) => appelerAgent('feu', commande, corps),
    }),
    // null seulement si le fichier n'existe pas ; toute autre erreur de lecture remonte (la note est sautée à ce passage).
    lireFichier: async p => { try { return await readFile(p, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } },
    ecrireFichier: async (p, c) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, c); },
    // Création atomique : EEXIST si le fichier est déjà là.
    creerFichier: async (p, c) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, c, { flag: 'wx' }); },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(e => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
