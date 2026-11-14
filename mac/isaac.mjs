// Isaac, le Concierge Mac : mesure la place, trouve ce qui peut être libéré, et n'efface qu'après le Oui du patron.
// Règle d'or : rien n'est supprimé sans un Oui. Le relais n'exécute que les propositions rendues par `a-faire`
// au statut « oui », que ce Mac a lui-même proposées, et revérifie chaque cible juste avant de l'effacer.
// Tout ce qui touche au système (exec, fichiers, pgrep, horloge, dossier personnel) est injecté : rien n'est testé sur le vrai disque.
// Jamais de shell, jamais de sudo : `exec(commande, argv)` avec un argv fixe, et `fs.rm` seulement sous la liste blanche.
import { basename, dirname, join, relative, resolve } from 'node:path';

const MO = 1024 ** 2, GO = 1024 ** 3;
const MIN = 60_000, HEURE = 60 * MIN, JOUR = 24 * HEURE;
export const SEUIL_LIBRE = 20 * GO;
export const MAX_PAR_ENVOI = 3; // le QG en garde 3 au plus ; le relais n'en envoie pas plus non plus
export const TAILLE_MIN = 200 * MO;
const CALME = 60; // minutes sans modification avant d'effacer
const DORT = 30 * 24 * 60; // minutes : 30 jours
const SIX_MOIS = 180 * 24 * 60;
const GENRES = ['cache', 'node_modules', 'simulateurs'];

const DOSSIERS_EDITEUR = ['Cache', 'CachedData', 'CachedExtensionVSIXs', 'GPUCache', 'Code Cache', 'logs'];

/** Racines (relatives au dossier personnel) : seul ce qui est strictement dessous peut être effacé. */
export const LISTE_BLANCHE = [
  { racine: 'Library/Caches', genre: 'cache' },
  { racine: '.cache', genre: 'cache' },
  ...['Cursor', 'Code'].flatMap(app => [
    ...DOSSIERS_EDITEUR.map(d => ({ racine: `Library/Application Support/${app}/${d}`, genre: 'cache' })),
    { racine: `Library/Application Support/${app}/User/workspaceStorage`, genre: 'cache' },
  ]),
  { racine: '.gradle/caches', genre: 'cache' },
  { racine: 'Library/Developer/Xcode/DerivedData', genre: 'cache' },
  { racine: 'Library/Developer/Xcode/iOS DeviceSupport', genre: 'cache' },
  // ~/.expo n'y est pas : on n'est pas sûr que tout y soit un cache (state.json…), donc on n'y touche pas.
  { racine: 'Desktop/Code', genre: 'node_modules' }, // seulement <projet>/node_modules (voir estNodeModules)
];

/** Dans la liste blanche, jamais ces dossiers (premier niveau, en minuscules ; com.apple.* en plus pour Library/Caches). */
export const LISTE_NOIRE = {
  'Library/Caches': ['cloudkit', 'safari', 'familycircled', 'geoservices',
    // à Apple sans le préfixe com.apple, ou pas recréé tout seul (navigateurs Playwright) : en cas de doute, on ne touche pas
    'familycircle', 'gamekit', 'passkit', 'sirientitycache', 'jetpackcache', 'amsdatamigratortool', 'minilauncher', 'ssu', 'ms-playwright'],
  '.cache': ['huggingface', 'torch', 'ollama', 'whisper'],
};

/** Interdits absolus (relatifs au dossier personnel). ~/Desktop n'admet que les node_modules des projets de ~/Desktop/Code. */
export const INTERDITS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', '.Trash', 'Documents/Obsidian Vault',
  'Library/Mobile Documents', 'Library/Keychains', 'Library/Mail', 'Library/Messages', '.ssh', '.gnupg'];

/** Les commandes nommées : la seule façon de lancer quelque chose. Jamais une commande venue du serveur. */
const COMMANDES = {
  'pnpm-store-prune': { cmd: 'pnpm', args: ['store', 'prune'], genre: 'cache', appli: 'paquets' },
  'npm-cache-clean': { cmd: 'npm', args: ['cache', 'clean', '--force'], genre: 'cache', appli: 'paquets' },
  'simctl-unavailable': { cmd: 'xcrun', args: ['simctl', 'delete', 'unavailable'], genre: 'simulateurs', appli: 'simulateur' },
};
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function commande(c) {
  if (typeof c !== 'string') return null;
  if (Object.hasOwn(COMMANDES, c)) return { nom: c, ...COMMANDES[c] };
  const m = /^simctl-delete:(.+)$/.exec(c);
  if (m && UUID.test(m[1])) return { nom: c, cmd: 'xcrun', args: ['simctl', 'delete', m[1]], genre: 'simulateurs', appli: 'simulateur', udid: m[1] };
  return null;
}

/** Les applications dont il faut s'assurer qu'elles ne tournent pas. Une erreur de pgrep compte comme « lancée ». */
const APPLIS = {
  cursor: { nom: 'Cursor', pgrep: [['-x', 'Cursor'], ['-f', 'Cursor\\.app/Contents/MacOS/']] },
  code: { nom: 'VS Code', pgrep: [['-x', 'Code'], ['-f', 'Visual Studio Code\\.app/Contents/MacOS/']] },
  xcode: { nom: 'Xcode', pgrep: [['-x', 'Xcode']] },
  simulateur: { nom: 'le Simulateur', pgrep: [['-x', 'Simulator']] },
  gradle: { nom: 'Gradle', pgrep: [['-f', 'GradleDaemon']] },
  paquets: { nom: 'une installation pnpm ou npm', pgrep: [['-f', '(pnpm|npm)[^ ]* +(install|i|add|ci|update|up|remove|rm)( |$)']] },
};

async function lancee(deps, cle) {
  for (const args of APPLIS[cle].pgrep) {
    try { if (await deps.pgrep(args)) return true; } catch { return true; }
  }
  return false;
}

const dessous = (p, racine) => p.startsWith(racine + '/');
const minuscules = s => s.toLowerCase();

function estNodeModules(segs) {
  const s = segs.map(minuscules);
  // au plus 3 dossiers entre ~/Desktop/Code et node_modules, comme trouverProjets
  return s.length >= 4 && s.length <= 6 && s[0] === 'desktop' && s[1] === 'code' && s.at(-1) === 'node_modules'
    && s.filter(x => x === 'node_modules').length === 1 && !segs.slice(2).some(x => x.startsWith('.'));
}

/** Classe un chemin d'après le texte seul (sans le disque) : { genre, racine } ou null. Majuscules ignorées (disque insensible à la casse). */
function classer(home, p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0')) return null;
  if (p.split('/').some(s => s === '..' || s === '.')) return null;
  if (resolve(p) !== p) return null; // ni « // », ni barre finale
  const h = resolve(home);
  if (!dessous(p, h)) return null;
  const rel = p.slice(h.length + 1), segs = rel.split('/'), relL = minuscules(rel);
  const nm = estNodeModules(segs);
  for (const i of INTERDITS) {
    const iL = minuscules(i);
    if ((relL === iL || relL.startsWith(iL + '/')) && !nm) return null;
  }
  if (nm) return { genre: 'node_modules', racine: 'Desktop/Code' };
  for (const e of LISTE_BLANCHE) {
    if (e.genre !== 'cache') continue;
    const rL = minuscules(e.racine);
    if (!relL.startsWith(rL + '/')) continue;
    const premier = minuscules(segs[e.racine.split('/').length]);
    if (premier.startsWith('.')) return null;
    if (e.racine === 'Library/Caches' && premier.startsWith('com.apple.')) return null;
    if ((LISTE_NOIRE[e.racine] ?? []).includes(premier)) return null;
    return { genre: 'cache', racine: e.racine };
  }
  return null;
}

/** Vérifie une cible avec le disque. `absent` : déjà partie (rien à faire). Tout lien symbolique en chemin → refus. */
function verifier(home, chemin, { realpath }) {
  const c = classer(home, chemin);
  if (!c) return { ok: false, raison: 'une cible est hors des dossiers autorisés' };
  let reel;
  try {
    if (realpath(resolve(home)) !== resolve(home)) return { ok: false, raison: 'le dossier personnel passe par un lien' };
    reel = realpath(chemin);
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: true, absent: true, genre: c.genre };
    return { ok: false, raison: 'une cible est illisible' };
  }
  if (reel !== chemin) return { ok: false, raison: 'une cible passe par un lien symbolique' };
  if (!classer(home, reel)) return { ok: false, raison: 'une cible est hors des dossiers autorisés' };
  return { ok: true, genre: c.genre };
}

/** Vrai seulement sous la liste blanche, hors liste noire et interdits, après résolution des liens (aucun lien admis). */
export function cibleAutorisee(home, chemin, { realpath }) {
  const v = verifier(home, chemin, { realpath });
  return v.ok && !v.absent;
}

/** L'application à qui appartient un chemin (pour vérifier qu'elle ne tourne pas). */
function appliDe(home, p) {
  const r = minuscules(relative(home, p));
  if (r.startsWith('library/application support/cursor/') || r.startsWith('library/caches/com.todesktop.')) return 'cursor';
  if (r.startsWith('library/application support/code/') || r.startsWith('library/caches/com.microsoft.vscode')) return 'code';
  if (r.startsWith('library/developer/xcode/')) return 'xcode';
  if (r.startsWith('.gradle/')) return 'gradle';
  return null;
}

// ---- Mesures (lecture seule) ----

export async function mesurer(deps) {
  const { stdout } = await deps.exec('df', ['-k', '/']);
  const ligne = stdout.trim().split('\n').at(-1);
  const m = /^\S+\s+(\d+)\s+\d+\s+(\d+)/.exec(ligne);
  if (!m) throw new Error('df illisible');
  return { libre: Number(m[2]) * 1024, total: Number(m[1]) * 1024 };
}

async function taille(deps, chemin) {
  const { stdout } = await deps.exec('du', ['-sk', chemin]);
  const n = Number(stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(n)) throw new Error('du illisible');
  return n * 1024;
}

/** Vrai si quelque chose sous `chemin` a bougé depuis `minutes`. En cas d'erreur : vrai (dans le doute, on ne touche pas). */
async function bouge(deps, chemin, minutes) {
  try {
    const { stdout } = await deps.exec('find', [chemin, '-mmin', `-${minutes}`, '-print', '-quit']);
    return stdout.trim() !== '';
  } catch { return true; }
}

const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Un projet endormi : dernier commit > 30 j, rien de non commité, aucun fichier (hors node_modules/.git) modifié depuis 30 j, rien de lancé dedans. */
async function projetEndormi(deps, projet) {
  try {
    const { stdout: t } = await deps.exec('git', ['-C', projet, 'log', '-1', '--format=%ct']);
    const commit = Number(t.trim()) * 1000;
    if (!Number.isFinite(commit) || commit <= 0 || deps.now - commit < 30 * JOUR) return false;
    const { stdout: s } = await deps.exec('git', ['--no-optional-locks', '-C', projet, 'status', '--porcelain']);
    if (s.trim() !== '') return false;
    const { stdout: f } = await deps.exec('find', [projet, '(', '-name', 'node_modules', '-o', '-name', '.git', ')', '-prune', '-o', '-mmin', `-${DORT}`, '-print', '-quit']);
    if (f.trim() !== '') return false;
    return !(await deps.pgrep(['-f', echapper(projet)]));
  } catch { return false; }
}

async function lister(deps, dossier) {
  try { return (await deps.fs.lister(dossier)).filter(e => !e.lien); } catch { return []; }
}

/**
 * Garde les chemins autorisés, calmes depuis `minutes`, et les additionne. null sous 200 Mo.
 * `seuils` (gardé par le relais, jamais envoyé au QG) : le calme exigé de chaque chemin, revérifié à l'exécution.
 */
async function grouper(deps, base, chemins, minutes, extra = { cibles: [], taille: 0 }) {
  const cibles = [...extra.cibles];
  const seuils = {};
  let total = extra.taille;
  for (const c of chemins) {
    if (!cibleAutorisee(deps.home, c, deps.fs)) continue;
    if (await bouge(deps, c, minutes)) continue;
    try { total += await taille(deps, c); } catch { continue; }
    cibles.push(c);
    seuils[c] = minutes;
  }
  if (!cibles.length || total < TAILLE_MIN) return null;
  return { ...base, taille: total, cibles, seuils };
}

/** Le calme exigé d'un chemin d'après l'endroit où il est (le même qu'à la proposition) : jamais moins d'1 h. */
function seuilDe(home, p) {
  const r = minuscules(relative(home, p));
  if (/^library\/application support\/(cursor|code)\/user\/workspacestorage\//.test(r)) return DORT;
  if (r.startsWith('library/developer/xcode/ios devicesupport/')) return SIX_MOIS;
  if (r.startsWith('library/caches/') && !appliDe(home, p)) return DORT;
  if (r.startsWith('.cache/')) return DORT;
  return CALME;
}

const enfants = async (deps, dossier) => (await lister(deps, dossier)).map(e => join(dossier, e.nom));
const tronquer = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

async function cachesEditeur(deps, cle, app) {
  if (await lancee(deps, cle)) return [];
  const { home } = deps;
  const base = join(home, 'Library/Application Support', app);
  const prefixe = cle === 'cursor' ? 'com.todesktop.' : 'com.microsoft.vscode';
  const chemins = [];
  for (const d of DOSSIERS_EDITEUR) chemins.push(...await enfants(deps, join(base, d)));
  for (const e of await lister(deps, join(home, 'Library/Caches'))) if (minuscules(e.nom).startsWith(prefixe)) chemins.push(join(home, 'Library/Caches', e.nom));
  const nom = cle === 'cursor' ? 'Cursor' : 'VS Code';
  return [
    await grouper(deps, { id: `cache:${cle}`, genre: 'cache', libelle: `caches de ${nom}`,
      impact: `${nom} recréera ce cache tout seul ; tes projets et tes réglages ne bougent pas.` }, chemins, CALME),
    await grouper(deps, { id: `cache:${cle}-espaces`, genre: 'cache', libelle: `anciens espaces de travail de ${nom}`,
      impact: `${nom} oublie l'état et l'historique des discussions des projets pas ouverts depuis 30 jours ; ton code et tes réglages ne bougent pas.` },
    await enfants(deps, join(base, 'User/workspaceStorage')), DORT),
  ];
}

async function cachesDivers(deps) {
  const { home } = deps;
  const L = join(home, 'Library/Caches');
  const chemins = (await lister(deps, L))
    // Cursor/VS Code à part ; Homebrew jamais (Isaac ne touche pas à Homebrew : brew cleanup irait au-delà de ce que dit le Oui)
    .filter(e => !appliDe(home, join(L, e.nom)) && minuscules(e.nom) !== 'homebrew')
    .map(e => join(L, e.nom));
  chemins.push(...await enfants(deps, join(home, '.cache')));
  return [await grouper(deps, { id: 'cache:library', genre: 'cache', libelle: 'caches d\'applications pas utilisés depuis 30 jours',
    impact: 'Chaque application recrée son cache toute seule si besoin ; tes fichiers et tes réglages ne bougent pas.' }, chemins, DORT)];
}

async function cachesXcode(deps) {
  if (await lancee(deps, 'xcode')) return [];
  const X = join(deps.home, 'Library/Developer/Xcode');
  return [
    await grouper(deps, { id: 'cache:xcode-deriveddata', genre: 'cache', libelle: 'fichiers de compilation d\'Xcode',
      impact: 'Xcode les refera à la prochaine compilation (un peu plus longue) ; tes projets ne bougent pas.' }, await enfants(deps, join(X, 'DerivedData')), CALME),
    await grouper(deps, { id: 'cache:xcode-devicesupport', genre: 'cache', libelle: 'anciens fichiers iPhone d\'Xcode',
      impact: 'Xcode les retéléchargera si tu rebranches un iPhone avec une de ces vieilles versions d\'iOS.' }, await enfants(deps, join(X, 'iOS DeviceSupport')), SIX_MOIS),
  ];
}

async function cachesPaquets(deps) {
  const { home } = deps;
  const extra = { cibles: [], taille: 0 };
  if (!(await lancee(deps, 'paquets'))) {
    try { await deps.exec('pnpm', ['store', 'path']); extra.cibles.push('pnpm-store-prune'); } catch { /* pas de pnpm */ }
    try {
      const { stdout } = await deps.exec('npm', ['config', 'get', 'cache']);
      const t = await taille(deps, join(stdout.trim(), '_cacache'));
      if (t > 0) { extra.cibles.push('npm-cache-clean'); extra.taille += t; }
    } catch { /* pas de npm */ }
  }
  const gradle = (await lancee(deps, 'gradle')) ? [] : await enfants(deps, join(home, '.gradle/caches'));
  return [await grouper(deps, { id: 'cache:paquets', genre: 'cache', libelle: 'caches des outils de paquets (pnpm, npm, Gradle)',
    impact: 'Les outils retéléchargeront ce qu\'il leur faut à la prochaine installation ; tes projets ne bougent pas.' }, gradle, CALME, extra)];
}

async function trouverProjets(deps, dossier, niveau = 0) {
  const entrees = await lister(deps, dossier);
  const noms = new Set(entrees.map(e => e.nom));
  if (noms.has('.git')) return entrees.some(e => e.nom === 'node_modules' && e.dossier) ? [{ projet: dossier, noms }] : [];
  if (niveau >= 3) return [];
  const out = [];
  for (const e of entrees) {
    if (!e.dossier || e.nom.startsWith('.') || e.nom === 'node_modules') continue;
    out.push(...await trouverProjets(deps, join(dossier, e.nom), niveau + 1));
  }
  return out;
}

async function nodeModules(deps) {
  const code = join(deps.home, 'Desktop/Code');
  const out = [];
  for (const { projet, noms } of await trouverProjets(deps, code)) {
    if (!(await projetEndormi(deps, projet))) continue;
    const outil = noms.has('pnpm-lock.yaml') ? 'pnpm install' : noms.has('yarn.lock') ? 'yarn' : 'npm install';
    out.push(await grouper(deps, { id: `nm:${relative(code, projet)}`, genre: 'node_modules', libelle: tronquer(`node_modules de ${basename(projet)}`, 80),
      impact: `Il faudra relancer ${outil} si tu reprends ce projet ; ton code ne bouge pas.` }, [join(projet, 'node_modules')], CALME));
  }
  return out;
}

async function listeSimulateurs(deps) {
  const { stdout } = await deps.exec('xcrun', ['simctl', 'list', 'devices', '-j']);
  const devices = JSON.parse(stdout)?.devices ?? {};
  const out = [];
  for (const [runtime, liste] of Object.entries(devices)) {
    const m = /SimRuntime\.([A-Za-z]+)-(\d+)-(\d+)/.exec(runtime);
    for (const d of Array.isArray(liste) ? liste : []) {
      if (!d || typeof d.udid !== 'string' || !UUID.test(d.udid)) continue;
      out.push({ ...d, plateforme: m?.[1] ?? '?', version: m ? Number(m[2]) * 1000 + Number(m[3]) : -1 });
    }
  }
  return out;
}

async function simulateurs(deps) {
  if (await lancee(deps, 'simulateur')) return [];
  let sims;
  try { sims = await listeSimulateurs(deps); } catch { return []; }
  const D = join(deps.home, 'Library/Developer/CoreSimulator/Devices');
  const tailleDe = async s => { try { return await taille(deps, join(D, s.udid)); } catch { return 0; } };
  const out = [];
  const indispo = sims.filter(s => s.isAvailable === false);
  let t = 0;
  for (const s of indispo) t += await tailleDe(s);
  if (indispo.length && t >= TAILLE_MIN) out.push({ id: 'sim:unavailable', genre: 'simulateurs', libelle: 'simulateurs iPhone indisponibles', taille: t,
    cibles: ['simctl-unavailable'], impact: 'Ils ne marchent plus avec ton Xcode ; les simulateurs supprimés se recréent depuis Xcode si besoin.' });
  const recente = {};
  for (const s of sims) if (s.isAvailable !== false) recente[s.plateforme] = Math.max(recente[s.plateforme] ?? -1, s.version);
  const vieux = sims.filter(s => {
    const vu = Date.parse(s.lastBootedAt ?? '');
    return s.isAvailable === true && s.state === 'Shutdown' && s.version !== recente[s.plateforme]
      && Number.isFinite(vu) && deps.now - vu > 180 * JOUR; // jamais lancé : on ne sait pas, on ne touche pas
  });
  t = 0;
  for (const s of vieux) t += await tailleDe(s);
  if (vieux.length && t >= TAILLE_MIN) out.push({ id: 'sim:vieux', genre: 'simulateurs', libelle: 'simulateurs iPhone pas lancés depuis 6 mois', taille: t,
    cibles: vieux.map(s => `simctl-delete:${s.udid}`),
    impact: tronquer(`Les simulateurs supprimés se recréent depuis Xcode si besoin : ${[...new Set(vieux.map(s => String(s.name ?? '').replace(/\//g, ' ')))].join(', ')}.`, 200) });
  return out;
}

/** Ce qui peut être libéré, sans statut. Caches d'abord (les plus gros d'abord), puis node_modules et simulateurs en mode « tout ». */
export async function candidats(deps, { mode }) {
  const sur = async f => { try { return await f(); } catch { return []; } };
  const caches = [
    ...await sur(() => cachesEditeur(deps, 'cursor', 'Cursor')),
    ...await sur(() => cachesEditeur(deps, 'code', 'Code')),
    ...await sur(() => cachesXcode(deps)),
    ...await sur(() => cachesDivers(deps)),
    ...await sur(() => cachesPaquets(deps)),
  ].filter(Boolean).sort((a, b) => b.taille - a.taille);
  if (mode !== 'tout') return caches;
  const autres = [...await sur(() => nodeModules(deps)), ...await sur(() => simulateurs(deps))].filter(Boolean).sort((a, b) => b.taille - a.taille);
  return [...caches, ...autres];
}

// ---- Exécution (après le Oui) ----

const refus = raison => ({ refus: true, raison });

/**
 * Revérifie chaque cible, puis efface. Une seule cible douteuse → refus, rien n'est effacé.
 * Le calme exigé est le même qu'à la proposition (30 jours, 6 mois ou 1 h) : `seuils` gardés par le relais, et au moins celui du lieu.
 */
export async function executer(deps, p, { seuils = {} } = {}) {
  if (!p || !GENRES.includes(p.genre) || !Array.isArray(p.cibles) || !p.cibles.length) return refus('proposition illisible');
  const plan = [];
  let sims = null;
  for (const c of p.cibles) {
    const cmd = commande(c);
    if (cmd) {
      if (cmd.genre !== p.genre) return refus('une commande ne correspond pas à la proposition');
      if (await lancee(deps, cmd.appli)) return refus(`${APPLIS[cmd.appli].nom} est en cours`);
      if (cmd.udid) {
        try { sims ??= await listeSimulateurs(deps); } catch { return refus('impossible de lire la liste des simulateurs'); }
        const s = sims.find(x => x.udid.toLowerCase() === cmd.udid.toLowerCase());
        if (!s) continue; // déjà supprimé
        if (s.state !== 'Shutdown') return refus(`le simulateur ${s.name ?? ''} est démarré`.replace(/ +/g, ' '));
      }
      plan.push({ cmd });
      continue;
    }
    const v = verifier(deps.home, c, deps.fs);
    if (!v.ok) return refus(v.raison);
    if (v.genre !== p.genre) return refus('une cible ne correspond pas à la proposition');
    if (v.absent) continue;
    const appli = appliDe(deps.home, c);
    if (appli && await lancee(deps, appli)) return refus(`${APPLIS[appli].nom} est ouvert`);
    const minutes = Math.max(CALME, seuilDe(deps.home, c), Number.isFinite(seuils[c]) ? seuils[c] : 0);
    if (await bouge(deps, c, minutes)) return refus('utilisé récemment');
    if (p.genre === 'node_modules' && !(await projetEndormi(deps, dirname(c)))) return refus('le projet a bougé depuis la proposition');
    plan.push({ chemin: c });
  }
  let avant;
  try { avant = await mesurer(deps); } catch { return refus('impossible de mesurer la place'); }
  if (!plan.length) return { libere: 0, libre: avant.libre };
  let reussis = 0;
  const erreurs = [];
  for (const etape of plan) {
    try {
      if (etape.cmd) {
        // le message brut d'une commande (chemins, sortie technique) ne va jamais au QG
        try { await deps.exec(etape.cmd.cmd, etape.cmd.args); } catch { erreurs.push('la commande de nettoyage a échoué'); continue; }
      } else {
        // dernière vérification juste avant d'effacer (un lien a pu apparaître entre-temps)
        const v = verifier(deps.home, etape.chemin, deps.fs);
        if (!v.ok) { erreurs.push(v.raison); continue; }
        if (v.absent) continue;
        try { await deps.fs.rm(etape.chemin, { recursive: true, force: true }); } catch { erreurs.push('un dossier n\'a pas pu être effacé'); continue; }
      }
      reussis++;
    } catch { erreurs.push('erreur inattendue'); }
  }
  if (!reussis && erreurs.length) return refus(erreurs[0]);
  let apres;
  try { apres = await mesurer(deps); } catch { apres = avant; }
  return { libere: Math.max(0, apres.libre - avant.libre), libre: apres.libre };
}

// ---- Le passage (toutes les 5 min, depuis le relais) ----

const garderRecents = (o, now, duree) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([, v]) => v && typeof v.quand === 'number' && now - v.quand < duree));

/** Le mode d'une mission : « vide le cache » → caches seulement ; sinon (« fais de la place ») → tout. */
export const modeMission = texte => (/\bcaches?\b/i.test(texte) ? 'caches' : 'tout');

/** Une proposition vaut 7 jours au QG : tant qu'elle attend, ce Mac ne la renvoie pas. */
const VALIDITE = 7 * JOUR;
/** Les seuils restent sur le Mac : le QG ne reçoit que la proposition. */
const sansSeuils = p => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'seuils'));

/**
 * a-faire à chaque passage ; une fois par heure : rapport + (libre < 20 Go → proposer) ; missions → candidats(mode) puis proposer.
 * Au plus deux messages Telegram par passage : les nouvelles propositions (`proposer`), puis un bilan (`faits` : résultats + fin des missions).
 * Rend ce qu'il faut ranger dans l'état du relais (derniereMesureIsaac, isaacProposees, isaacFaits, isaacBilan).
 */
export async function passageIsaac(deps) {
  const { now, etat = {}, appeler, journal = () => {} } = deps;
  const connues = garderRecents(etat.isaacProposees, now, 2 * VALIDITE);
  const faits = garderRecents(etat.isaacFaits, now, 7 * JOUR);
  // un bilan pas encore reçu par le QG est renvoyé (le QG ignore ce qu'il a déjà)
  const bilanAvant = etat.isaacBilan && typeof etat.isaacBilan === 'object' && now - etat.isaacBilan.quand < 7 * JOUR ? etat.isaacBilan : null;
  const resultats = [...(Array.isArray(bilanAvant?.resultats) ? bilanAvant.resultats : [])];
  const finsMissions = [...(Array.isArray(bilanAvant?.missions) ? bilanAvant.missions : [])];
  let libreConnu = typeof bilanAvant?.libre === 'number' ? bilanAvant.libre : undefined;
  const patch = {};
  let missions = [];

  try {
    const r = await appeler('a-faire');
    if (!r || !Array.isArray(r.acceptees) || !Array.isArray(r.missions)) throw new Error('réponse inattendue');
    missions = r.missions.filter(m => m && typeof m.texte === 'string');
    for (const p of r.acceptees) {
      if (!p || p.statut !== 'oui' || typeof p.id !== 'string') continue; // règle d'or : seulement un Oui
      if (resultats.some(x => x.id === p.id)) continue; // déjà dans le bilan en attente
      try {
        let res = faits[p.id];
        if (!res) {
          const c = connues[p.id];
          const reconnue = c && c.genre === p.genre && Array.isArray(p.cibles) && p.cibles.every(x => c.cibles.includes(x));
          res = reconnue ? await executer(deps, p, { seuils: c.seuils ?? {} }) : refus('ce Mac ne reconnaît pas cette proposition');
          if (!res.refus) faits[p.id] = { libere: res.libere, libre: res.libre, quand: now };
        }
        if (!res.refus) libreConnu = res.libre;
        resultats.push(res.refus ? { id: p.id, refus: true, raison: res.raison } : { id: p.id, libere: res.libere });
        journal(res.refus ? `isaac ${p.id} : refusé (${res.raison})` : `isaac ${p.id} : ${(res.libere / GO).toFixed(1)} Go libérés`);
      } catch (e) { journal(`isaac ${p.id} : échec (${e.message}), nouvel essai au prochain passage`); }
    }
  } catch (e) { journal(`isaac a-faire : échec (${e.message})`); }

  const aProposer = [];
  const derniere = etat.derniereMesureIsaac;
  if (typeof derniere !== 'number' || now - derniere >= HEURE) {
    try {
      const m = await mesurer(deps);
      libreConnu = m.libre;
      await appeler('rapport', m);
      patch.derniereMesureIsaac = now;
      if (m.libre < SEUIL_LIBRE) aProposer.push(...await candidats(deps, { mode: 'tout' }));
    } catch (e) { journal(`isaac mesure : échec (${e.message}), nouvel essai au prochain passage`); }
  }
  const valides = missions.filter(m => typeof m.id === 'string' && m.id);
  // « prise » tout de suite (sans message) ; un échec est seulement noté, il ne bloque rien
  for (const m of valides) {
    try { await appeler('mission', { id: m.id, texte: m.texte, etat: 'prise' }); }
    catch (e) { journal(`isaac mission « ${m.texte} » (prise) : suivi en échec (${e.message})`); }
  }
  const parMode = {};
  for (const mode of new Set(valides.map(m => modeMission(m.texte)))) {
    try { parMode[mode] = await candidats(deps, { mode }); } catch (e) { parMode[mode] = []; journal(`isaac mission : échec (${e.message})`); }
    aProposer.push(...parMode[mode]);
  }

  // Ce que ce Mac a déjà en attente au QG (moins de 7 jours) n'est pas renvoyé ; au plus 3 par envoi (caches d'abord, puis par taille).
  const enAttenteIci = id => Boolean(connues[id]) && now - connues[id].quand < VALIDITE;
  const uniques = [...new Map(aProposer.filter(p => !enAttenteIci(p.id)).map(p => [p.id, p])).values()].slice(0, MAX_PAR_ENVOI);
  let ids = new Set(), attente = new Set(), ecartees = new Set();
  let envoiOk = true;
  if (uniques.length) {
    try {
      const r = await appeler('proposer', { propositions: uniques.map(sansSeuils) });
      const ens = v => new Set(Array.isArray(v) ? v : []);
      ids = ens(r?.proposees); attente = ens(r?.enAttente); ecartees = ens(r?.ecartees);
      // on ne retient que ce que le QG a vraiment enregistré ; les cibles s'additionnent (une ancienne proposition peut encore recevoir son Oui)
      for (const p of uniques) {
        if (!ids.has(p.id)) continue;
        const avant = connues[p.id]?.genre === p.genre ? connues[p.id] : { cibles: [], seuils: {} };
        const seuils = { ...(avant.seuils ?? {}) };
        for (const [c, m] of Object.entries(p.seuils ?? {})) seuils[c] = Math.max(seuils[c] ?? 0, m); // le plus exigeant
        connues[p.id] = { genre: p.genre, cibles: [...new Set([...avant.cibles, ...p.cibles])], seuils, quand: now };
      }
      if (ids.size) journal(`isaac propose : ${[...ids].join(', ')}`);
    } catch (e) { envoiOk = false; journal(`isaac proposer : échec (${e.message})`); }
  }
  // La fin de chaque mission dit la vérité : jamais « rien trouvé » quand quelque chose a été trouvé puis écarté.
  if (envoiOk) {
    for (const m of valides) {
      const liste = parMode[modeMission(m.texte)].map(p => p.id);
      const fin = !liste.length ? 'rien'
        : liste.some(id => ids.has(id)) ? 'proposee'
          : liste.some(id => attente.has(id) || enAttenteIci(id)) ? 'attente'
            : liste.some(id => ecartees.has(id)) ? 'ecartee'
              : 'attente'; // trouvé mais pas envoyé (au plus 3 à la fois) : viendra au prochain envoi
      finsMissions.push({ id: m.id, texte: m.texte, etat: fin });
    }
  }

  // Un seul bilan par passage : résultats des Oui et fin des missions, en un message.
  patch.isaacBilan = null;
  if (resultats.length || finsMissions.length) {
    if (libreConnu === undefined && finsMissions.some(f => f.etat === 'rien')) {
      try { libreConnu = (await mesurer(deps)).libre; } catch { /* sans chiffre */ }
    }
    const corps = { resultats, missions: finsMissions, ...(libreConnu === undefined ? {} : { libre: libreConnu }) };
    try {
      await appeler('faits', corps);
      for (const x of resultats) { delete faits[x.id]; delete connues[x.id]; }
    } catch (e) {
      patch.isaacBilan = { ...corps, quand: bilanAvant?.quand ?? now };
      journal(`isaac bilan : échec (${e.message}), renvoyé au prochain passage`);
    }
  }
  patch.isaacProposees = connues;
  patch.isaacFaits = faits;
  return patch;
}
