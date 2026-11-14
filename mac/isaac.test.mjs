import { describe, it, expect } from 'vitest';
import { cibleAutorisee, mesurer, candidats, executer, passageIsaac, modeMission, LISTE_BLANCHE, LISTE_NOIRE, INTERDITS } from './isaac.mjs';

// Un Mac simulé : rien ne touche le vrai disque. `ages` = minutes depuis la dernière modification sous un chemin.
const H = '/Users/m';
const MIN = 60_000, JOUR = 86_400_000, GO = 1024 ** 3, MO = 1024 ** 2;
const NOW = Date.UTC(2026, 10, 10, 12);
const CURSOR = `${H}/Library/Application Support/Cursor`;
const CODE = `${H}/Desktop/Code`;

function monde({ chemins = [], liens = {}, ages = {}, tailles = {}, lances = [], git = {}, actifs = [], sims = null, libres = [10 * GO], outils = ['pnpm', 'npm', 'brew'], brewLibere = '0B', echecRm = [] } = {}) {
  const j = { rm: [], exec: [], appels: [] };
  const tous = new Set([H]);
  for (const p of [...chemins, ...Object.keys(liens)]) {
    const segs = p.split('/');
    for (let i = 2; i <= segs.length; i++) tous.add(segs.slice(0, i).join('/'));
  }
  const present = p => tous.has(p) && !j.rm.some(r => p === r || p.startsWith(r + '/'));
  const resoudre = p => {
    let cur = '';
    for (const s of p.split('/').filter(Boolean)) { cur = `${cur}/${s}`; if (liens[cur]) cur = liens[cur]; }
    return cur || '/';
  };
  const fs = {
    realpath: p => {
      const r = resoudre(p);
      if (!present(r) && r !== '/') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
      return r;
    },
    lister: async d => {
      if (!present(d)) return [];
      const enfants = [...tous].filter(p => present(p) && p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/'));
      return enfants.map(p => ({ nom: p.slice(d.length + 1), lien: !!liens[p], dossier: !liens[p] && [...tous].some(q => q.startsWith(p + '/')) }));
    },
    rm: async (p, o) => {
      if (!o?.recursive || !o?.force) throw new Error('rm sans recursive/force');
      if (echecRm.includes(p)) throw new Error('EPERM');
      j.rm.push(p);
    },
  };
  const age = p => {
    let a = 1e9;
    for (const [k, v] of Object.entries(ages)) if (k === p || k.startsWith(p + '/')) a = Math.min(a, v);
    return a;
  };
  const exec = async (cmd, args) => {
    j.exec.push([cmd, ...args]);
    if (cmd === 'df') {
      const l = libres.length > 1 ? libres.shift() : libres[0];
      return { stdout: `Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1s1 ${228 * GO / 1024} 1 ${l / 1024} 34% 1 1 0% /\n` };
    }
    if (cmd === 'du') { const p = args.at(-1); return { stdout: `${Math.round((tailles[p] ?? 0) / 1024)}\t${p}\n` }; }
    if (cmd === 'find') {
      const p = args[0];
      if (args.includes('-prune')) return { stdout: actifs.includes(p) ? `${p}/src/a.ts\n` : '' };
      const minutes = Number(args[args.indexOf('-mmin') + 1].slice(1));
      return { stdout: age(p) < minutes ? `${p}\n` : '' };
    }
    if (cmd === 'git') {
      const projet = args[args.indexOf('-C') + 1], g = git[projet];
      if (!g) throw new Error('pas un dépôt');
      if (args.includes('log')) return { stdout: `${Math.floor(g.commit / 1000)}\n` };
      if (args.includes('status')) return { stdout: g.sale ? ' M src/a.ts\n' : '' };
    }
    if (cmd === 'xcrun') {
      if (args.includes('list')) { if (!sims) throw new Error('pas de Xcode'); return { stdout: JSON.stringify({ devices: sims }) }; }
      return { stdout: '' };
    }
    if (!outils.includes(cmd)) throw Object.assign(new Error('introuvable'), { code: 'ENOENT' });
    if (cmd === 'pnpm' && args[1] === 'path') return { stdout: `${H}/Library/pnpm/store/v10\n` };
    if (cmd === 'npm' && args[0] === 'config') return { stdout: `${H}/.npm\n` };
    if (cmd === 'brew' && args.includes('-n')) return { stdout: `This operation would free approximately ${brewLibere} of disk space.\n` };
    return { stdout: '' };
  };
  const pgrep = async args => lances.some(l => args.join(' ').includes(l));
  return { j, deps: { home: H, now: NOW, fs, exec, pgrep, journal: () => {} } };
}

const autorise = (m, p) => cibleAutorisee(H, p, { realpath: m.deps.fs.realpath });

describe('listes', () => {
  it('la liste noire et les interdits couvrent ce que la conception exige', () => {
    expect(LISTE_NOIRE['Library/Caches']).toEqual(expect.arrayContaining(['cloudkit', 'safari', 'familycircled', 'geoservices']));
    expect(LISTE_NOIRE['.cache']).toEqual(expect.arrayContaining(['huggingface', 'torch', 'ollama', 'whisper']));
    expect(INTERDITS).toEqual(expect.arrayContaining(['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', '.Trash']));
    expect(LISTE_BLANCHE.map(e => e.racine)).toContain(`Library/Application Support/Cursor/CachedData`);
    expect(LISTE_BLANCHE.map(e => e.racine)).not.toContain('Library/Application Support/Cursor/User/globalStorage');
  });
});

describe('cibleAutorisee (RF 2)', () => {
  const m = monde({
    chemins: [`${H}/Library/Caches/com.todesktop.cursor/x`, `${H}/Library/Caches/com.apple.x/y`, `${H}/.cache/huggingface/m`,
      `${H}/Desktop/x/y`, `${H}/Documents/secret/a`, `${CODE}/livreo/node_modules/react`, `${CODE}/livreo/src/a.ts`, `${H}/.cache/gh/a`],
    liens: { [`${H}/Library/Caches/piege`]: `${H}/Documents/secret`, [`${H}/Library/Caches/Bon`]: `${H}/Library/Caches/com.todesktop.cursor` },
  });
  it('accepte un cache ordinaire et les node_modules d\'un projet de ~/Desktop/Code', () => {
    expect(autorise(m, `${H}/Library/Caches/com.todesktop.cursor`)).toBe(true);
    expect(autorise(m, `${H}/.cache/gh`)).toBe(true);
    expect(autorise(m, `${CODE}/livreo/node_modules`)).toBe(true);
  });
  it('refuse ../, chemin relatif, barre finale', () => {
    expect(autorise(m, `${H}/Library/Caches/../../Documents/secret`)).toBe(false);
    expect(autorise(m, `${H}/Library/Caches/com.todesktop.cursor/../../../Documents`)).toBe(false);
    expect(autorise(m, `${H}/Library/Caches/com.todesktop.cursor/x/..`)).toBe(false);
    expect(autorise(m, `Library/Caches/com.todesktop.cursor`)).toBe(false);
    expect(autorise(m, `${H}/Library/Caches/com.todesktop.cursor/`)).toBe(false);
    expect(autorise(m, `${H}/Library//Caches/com.todesktop.cursor`)).toBe(false);
  });
  it('refuse un lien symbolique, même vers un endroit autorisé', () => {
    expect(autorise(m, `${H}/Library/Caches/piege`)).toBe(false);
    expect(autorise(m, `${H}/Library/Caches/Bon`)).toBe(false);
  });
  it('refuse la liste noire et les interdits, sans tenir compte des majuscules', () => {
    expect(autorise(m, `${H}/Library/Caches/com.apple.x`)).toBe(false);
    expect(autorise(m, `${H}/.cache/huggingface`)).toBe(false);
    expect(autorise(m, `${H}/Desktop/x`)).toBe(false);
    expect(autorise(m, `${H}/Documents/secret`)).toBe(false);
    expect(autorise(m, `${H}/library/caches/COM.APPLE.x`)).toBe(false);
  });
  it('jamais une racine elle-même, ni le dossier personnel, ni hors du dossier personnel', () => {
    expect(autorise(m, `${H}/Library/Caches`)).toBe(false);
    expect(autorise(m, `${H}/.cache`)).toBe(false);
    expect(autorise(m, CODE)).toBe(false);
    expect(autorise(m, H)).toBe(false);
    expect(autorise(m, '/Library/Caches/x')).toBe(false);
    expect(autorise(m, '/')).toBe(false);
  });
  it('node_modules : seulement le dossier node_modules d\'un projet, rien d\'autre sous ~/Desktop/Code', () => {
    expect(autorise(m, `${CODE}/livreo/src`)).toBe(false);
    expect(autorise(m, `${CODE}/livreo`)).toBe(false);
    expect(autorise(m, `${CODE}/node_modules`)).toBe(false);
    expect(autorise(m, `${CODE}/livreo/node_modules/react`)).toBe(false);
    expect(autorise(m, `${H}/Desktop/autre/node_modules`)).toBe(false);
  });
  it('node_modules : au plus 3 dossiers sous ~/Desktop/Code, comme la recherche des projets', () => {
    const p3 = `${CODE}/a/b/c/node_modules`, p4 = `${CODE}/a/b/c/d/node_modules`;
    const m2 = monde({ chemins: [`${p3}/x`, `${p4}/x`] });
    expect(autorise(m2, p3)).toBe(true);
    expect(autorise(m2, p4)).toBe(false);
  });
  it('une cible qui n\'est pas un texte est refusée', () => {
    expect(autorise(m, null)).toBe(false);
    expect(autorise(m, 'pnpm store prune')).toBe(false);
  });
});

describe('mesurer', () => {
  it('lit df -k /', async () => {
    const { deps, j } = monde({ libres: [26 * GO] });
    expect(await mesurer(deps)).toEqual({ libre: 26 * GO, total: 228 * GO });
    expect(j.exec[0]).toEqual(['df', '-k', '/']);
  });
});

const CURSOR_CHEMINS = [`${CURSOR}/CachedData/abc/x`, `${CURSOR}/Cache/Cache_Data/f`, `${CURSOR}/User/settings.json`, `${CURSOR}/User/globalStorage/state.vscdb`];

describe('candidats', () => {
  it('groupe les caches de Cursor en une proposition, sans réglages ni globalStorage', async () => {
    const { deps } = monde({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO, [`${CURSOR}/Cache/Cache_Data`]: GO } });
    const ps = await candidats(deps, { mode: 'caches' });
    const c = ps.find(p => p.id === 'cache:cursor');
    expect(c).toMatchObject({ genre: 'cache', libelle: 'caches de Cursor', taille: 4 * GO });
    expect(c.impact).toMatch(/Cursor recréera/);
    expect(c.cibles.sort()).toEqual([`${CURSOR}/Cache/Cache_Data`, `${CURSOR}/CachedData/abc`]);
    expect(ps.flatMap(p => p.cibles).some(x => /settings|globalStorage/.test(x))).toBe(false);
  });
  it('Cursor lancé → aucun candidat Cursor (RF 3)', async () => {
    const { deps } = monde({ chemins: [...CURSOR_CHEMINS, `${H}/Library/Caches/com.todesktop.230313mzl4w4u92/x`], lances: ['Cursor'],
      tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO, [`${H}/Library/Caches/com.todesktop.230313mzl4w4u92`]: GO } });
    const ps = await candidats(deps, { mode: 'tout' });
    expect(ps.flatMap(p => p.cibles).some(x => /Cursor|todesktop/.test(x))).toBe(false);
  });
  it('un dossier modifié il y a 10 min n\'est pas candidat', async () => {
    const { deps } = monde({ chemins: CURSOR_CHEMINS, ages: { [`${CURSOR}/CachedData/abc/x`]: 10 },
      tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO, [`${CURSOR}/Cache/Cache_Data`]: GO } });
    const c = (await candidats(deps, { mode: 'caches' })).find(p => p.id === 'cache:cursor');
    expect(c.cibles).toEqual([`${CURSOR}/Cache/Cache_Data`]);
  });
  it('sous 200 Mo : pas de proposition', async () => {
    const { deps } = monde({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 150 * MO } });
    expect((await candidats(deps, { mode: 'caches' })).find(p => p.id === 'cache:cursor')).toBeUndefined();
  });
  it('~/Library/Caches : seulement ce qui dort depuis 30 jours, hors com.apple et liste noire', async () => {
    const L = `${H}/Library/Caches`;
    const { deps } = monde({
      chemins: [`${L}/vieux/a`, `${L}/recent/a`, `${L}/com.apple.Music/a`, `${L}/CloudKit/a`, `${H}/.cache/huggingface/m`, `${H}/.cache/gh/a`],
      ages: { [`${L}/recent/a`]: 5 * 24 * 60 },
      tailles: { [`${L}/vieux`]: GO, [`${L}/recent`]: GO, [`${L}/com.apple.Music`]: GO, [`${L}/CloudKit`]: GO, [`${H}/.cache/huggingface`]: 5 * GO, [`${H}/.cache/gh`]: GO },
    });
    const c = (await candidats(deps, { mode: 'caches' })).find(p => p.id === 'cache:library');
    expect(c.cibles.sort()).toEqual([`${H}/.cache/gh`, `${L}/vieux`]);
    expect(c.taille).toBe(2 * GO);
  });
  it('outils de paquets : commandes nommées seulement, jamais Homebrew', async () => {
    const { deps, j } = monde({ chemins: [`${H}/.npm/_cacache/x`, `${H}/.gradle/caches/8.0/x`, `${H}/Library/Caches/Homebrew/x`],
      tailles: { [`${H}/.npm/_cacache`]: GO, [`${H}/.gradle/caches/8.0`]: GO, [`${H}/Library/Caches/Homebrew`]: GO }, brewLibere: '1.5GB' });
    const ps = await candidats(deps, { mode: 'tout' });
    const c = ps.find(p => p.id === 'cache:paquets');
    expect(c.cibles.sort()).toEqual([`${H}/.gradle/caches/8.0`, 'npm-cache-clean', 'pnpm-store-prune']);
    expect(c.taille).toBe(2 * GO);
    expect(ps.flatMap(p => [p.libelle, p.impact, ...p.cibles]).some(x => /brew/i.test(x))).toBe(false);
    expect(j.exec.some(e => e[0] === 'brew')).toBe(false);
  });
  it('mode caches : ni node_modules ni simulateurs', async () => {
    const P = `${CODE}/livreo`;
    const { deps } = monde({ chemins: [`${P}/node_modules/react`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR } }, tailles: { [`${P}/node_modules`]: GO } });
    expect((await candidats(deps, { mode: 'caches' })).some(p => p.genre !== 'cache')).toBe(false);
    expect((await candidats(deps, { mode: 'tout' })).find(p => p.id === 'nm:livreo')).toMatchObject({ genre: 'node_modules', cibles: [`${P}/node_modules`], taille: GO });
  });
  it('node_modules : projet avec changement non commité, commit < 30 j, fichier récent ou lancé → pas candidat', async () => {
    const proj = n => [`${CODE}/${n}/node_modules/react`, `${CODE}/${n}/.git/HEAD`];
    const { deps } = monde({
      chemins: ['sale', 'jeune', 'actif', 'lance', 'dort'].flatMap(proj),
      git: { [`${CODE}/sale`]: { commit: NOW - 60 * JOUR, sale: true }, [`${CODE}/jeune`]: { commit: NOW - 10 * JOUR }, [`${CODE}/actif`]: { commit: NOW - 60 * JOUR },
        [`${CODE}/lance`]: { commit: NOW - 60 * JOUR }, [`${CODE}/dort`]: { commit: NOW - 60 * JOUR } },
      actifs: [`${CODE}/actif`], lances: [`${CODE}/lance`],
      tailles: Object.fromEntries(['sale', 'jeune', 'actif', 'lance', 'dort'].map(n => [`${CODE}/${n}/node_modules`, GO])),
    });
    const ids = (await candidats(deps, { mode: 'tout' })).filter(p => p.genre === 'node_modules').map(p => p.id);
    expect(ids).toEqual(['nm:dort']);
  });
  it('simulateurs : indisponibles, et vieux hors iOS le plus récent et hors démarrés', async () => {
    const u = n => `0000000${n}-0000-0000-0000-000000000000`;
    const vieux = new Date(NOW - 200 * JOUR).toISOString(), recent = new Date(NOW - 10 * JOUR).toISOString();
    const sims = {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
        { udid: u(1), name: 'iPhone 14', state: 'Shutdown', isAvailable: true, lastBootedAt: vieux },
        { udid: u(2), name: 'iPhone 15', state: 'Shutdown', isAvailable: true, lastBootedAt: recent },
        { udid: u(3), name: 'iPhone X', state: 'Booted', isAvailable: true, lastBootedAt: vieux },
        { udid: u(4), name: 'iPhone SE', state: 'Shutdown', isAvailable: false },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [{ udid: u(5), name: 'iPhone 16', state: 'Shutdown', isAvailable: true, lastBootedAt: vieux }],
    };
    const D = `${H}/Library/Developer/CoreSimulator/Devices`;
    const { deps } = monde({ sims, tailles: Object.fromEntries([1, 2, 3, 4, 5].map(n => [`${D}/${u(n)}`, GO])) });
    const ps = await candidats(deps, { mode: 'tout' });
    expect(ps.find(p => p.id === 'sim:unavailable')).toMatchObject({ genre: 'simulateurs', cibles: ['simctl-unavailable'], taille: GO });
    const v = ps.find(p => p.id === 'sim:vieux');
    expect(v.cibles).toEqual([`simctl-delete:${u(1)}`]);
    expect(v.impact).toMatch(/iPhone 14/);
    // Simulateur ouvert : rien
    const m2 = monde({ sims, lances: ['Simulator'], tailles: Object.fromEntries([1, 4].map(n => [`${D}/${u(n)}`, GO])) });
    expect((await candidats(m2.deps, { mode: 'tout' })).some(p => p.genre === 'simulateurs')).toBe(false);
  });
  it('les impacts sont des phrases simples, sans chemin', async () => {
    const { deps } = monde({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO } });
    for (const p of await candidats(deps, { mode: 'tout' })) {
      expect(p.impact).not.toMatch(/\//);
      expect(p.impact.length).toBeLessThanOrEqual(200);
      expect(p.libelle.length).toBeLessThanOrEqual(80);
    }
  });
});

const prop = (o = {}) => ({ id: 'cache:cursor', genre: 'cache', libelle: 'caches de Cursor', taille: 4 * GO, impact: 'x', statut: 'oui', cibles: [`${CURSOR}/CachedData/abc`], ...o });

describe('executer', () => {
  it('supprime une cible vérifiée et rend la place libérée (df avant / après)', async () => {
    const { deps, j } = monde({ chemins: CURSOR_CHEMINS, libres: [10 * GO, 13 * GO] });
    expect(await executer(deps, prop())).toEqual({ libere: 3 * GO, libre: 13 * GO });
    expect(j.rm).toEqual([`${CURSOR}/CachedData/abc`]);
  });
  it('une cible devenue un lien vers ~/Documents → refus, rien supprimé', async () => {
    const { deps, j } = monde({ chemins: [...CURSOR_CHEMINS, `${H}/Documents/a/b`], liens: { [`${CURSOR}/Cache/Cache_Data`]: `${H}/Documents/a` } });
    const r = await executer(deps, prop({ cibles: [`${CURSOR}/CachedData/abc`, `${CURSOR}/Cache/Cache_Data`] }));
    expect(r.refus).toBe(true);
    expect(r.raison).toBeTruthy();
    expect(j.rm).toEqual([]);
  });
  it('une cible hors liste, ../ ou commande libre → refus, rien supprimé ni lancé', async () => {
    for (const mauvaise of [`${H}/Documents/a`, `${CURSOR}/CachedData/../../../../Documents`, `${CURSOR}/CachedData/abc/../../../../../Documents/a`, 'rm -rf ~', 'pnpm store prune; rm -rf /', 'simctl-delete:../../x', `${CURSOR}/User/settings.json`]) {
      const { deps, j } = monde({ chemins: [...CURSOR_CHEMINS, `${H}/Documents/a/b`] });
      const r = await executer(deps, prop({ cibles: [`${CURSOR}/CachedData/abc`, mauvaise] }));
      expect(r.refus, mauvaise).toBe(true);
      expect(j.rm).toEqual([]);
      expect(j.exec.filter(e => !['df', 'find', 'du'].includes(e[0]))).toEqual([]);
    }
  });
  it('Cursor ouvert au moment d\'exécuter → refus', async () => {
    const { deps, j } = monde({ chemins: CURSOR_CHEMINS, lances: ['Cursor'] });
    expect((await executer(deps, prop())).refus).toBe(true);
    expect(j.rm).toEqual([]);
  });
  it('modifié depuis moins d\'une heure → refus', async () => {
    const { deps, j } = monde({ chemins: CURSOR_CHEMINS, ages: { [`${CURSOR}/CachedData/abc/x`]: 20 } });
    expect((await executer(deps, prop())).refus).toBe(true);
    expect(j.rm).toEqual([]);
  });
  it('le genre doit correspondre : un node_modules dans une proposition « cache » est refusé', async () => {
    const P = `${CODE}/livreo`;
    const { deps, j } = monde({ chemins: [`${P}/node_modules/a`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR } } });
    expect((await executer(deps, prop({ cibles: [`${P}/node_modules`] }))).refus).toBe(true);
    expect((await executer(deps, prop({ genre: 'simulateurs', cibles: ['pnpm-store-prune'] }))).refus).toBe(true);
    expect(j.rm).toEqual([]);
  });
  it('node_modules : revérifie le projet (devenu actif → refus)', async () => {
    const P = `${CODE}/livreo`;
    const m = monde({ chemins: [`${P}/node_modules/a`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR, sale: true } } });
    expect((await executer(m.deps, prop({ id: 'nm:livreo', genre: 'node_modules', cibles: [`${P}/node_modules`] }))).refus).toBe(true);
    expect(m.j.rm).toEqual([]);
    const ok = monde({ chemins: [`${P}/node_modules/a`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR } } });
    expect((await executer(ok.deps, prop({ id: 'nm:livreo', genre: 'node_modules', cibles: [`${P}/node_modules`] }))).refus).toBeUndefined();
    expect(ok.j.rm).toEqual([`${P}/node_modules`]);
  });
  it('commandes nommées : argv fixe, jamais de shell', async () => {
    const u = 'A1B2C3D4-0000-0000-0000-000000000000';
    const { deps, j } = monde({ chemins: [`${H}/.gradle/caches/8.0/x`], sims: { 'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: u, name: 'iPhone', state: 'Shutdown', isAvailable: true }] } });
    await executer(deps, prop({ id: 'cache:paquets', cibles: ['pnpm-store-prune', 'npm-cache-clean', `${H}/.gradle/caches/8.0`] }));
    await executer(deps, prop({ id: 'sim:vieux', genre: 'simulateurs', cibles: ['simctl-unavailable', `simctl-delete:${u}`] }));
    const lances = j.exec.filter(e => !['df', 'find', 'du'].includes(e[0]) && !e.includes('list'));
    expect(lances).toEqual([['pnpm', 'store', 'prune'], ['npm', 'cache', 'clean', '--force'], ['xcrun', 'simctl', 'delete', 'unavailable'], ['xcrun', 'simctl', 'delete', u]]);
    expect(j.rm).toEqual([`${H}/.gradle/caches/8.0`]);
  });
  it('brew-cleanup n\'est plus une commande : refus, rien lancé', async () => {
    const { deps, j } = monde({ chemins: CURSOR_CHEMINS });
    expect((await executer(deps, prop({ id: 'cache:paquets', cibles: ['brew-cleanup'] }))).refus).toBe(true);
    expect(j.exec.some(e => e[0] === 'brew')).toBe(false);
  });
  it('un simulateur démarré entre-temps → refus', async () => {
    const u = 'A1B2C3D4-0000-0000-0000-000000000000';
    const { deps, j } = monde({ sims: { 'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: u, name: 'iPhone', state: 'Booted', isAvailable: true }] } });
    expect((await executer(deps, prop({ id: 'sim:vieux', genre: 'simulateurs', cibles: [`simctl-delete:${u}`] }))).refus).toBe(true);
    expect(j.exec.some(e => e.includes('delete'))).toBe(false);
  });
  it('une cible déjà partie est sautée sans erreur', async () => {
    const { deps, j } = monde({ chemins: CURSOR_CHEMINS });
    const r = await executer(deps, prop({ cibles: [`${CURSOR}/CachedData/disparu`] }));
    expect(r.refus).toBeUndefined();
    expect(j.rm).toEqual([]);
  });
  it('rien n\'a pu être supprimé → refus avec une raison simple, sans détail technique', async () => {
    const { deps } = monde({ chemins: CURSOR_CHEMINS, echecRm: [`${CURSOR}/CachedData/abc`] });
    expect(await executer(deps, prop())).toEqual({ refus: true, raison: 'un dossier n\'a pas pu être effacé' });
    const m = monde({ outils: [] });
    expect(await executer(m.deps, prop({ id: 'cache:paquets', cibles: ['npm-cache-clean'] }))).toEqual({ refus: true, raison: 'la commande de nettoyage a échoué' });
  });
});

function relaisIsaac({ etat = {}, acceptees = [], missions = [], echecs = {}, dejaProposees = [], ecarteesQG = [], ...m } = {}) {
  const w = monde(m);
  const appeler = async (action, corps) => {
    w.j.appels.push([action, corps]);
    if (echecs[action]) throw new Error('réseau');
    if (action === 'a-faire') return { acceptees, missions };
    if (action === 'proposer') {
      const ids = corps.propositions.map(p => p.id);
      return { proposees: ids.filter(id => !dejaProposees.includes(id) && !ecarteesQG.includes(id)).slice(0, 3),
        enAttente: ids.filter(id => dejaProposees.includes(id)), ecartees: ids.filter(id => ecarteesQG.includes(id)) };
    }
    return { ok: true };
  };
  return { ...w, deps: { ...w.deps, etat, appeler } };
}
const connue = p => ({ isaacProposees: { [p.id]: { genre: p.genre, cibles: p.cibles, quand: NOW - JOUR } } });

describe('passageIsaac', () => {
  const RECENT = { derniereMesureIsaac: NOW - 10 * MIN };
  it('n\'exécute que les propositions acceptées (statut « oui ») que le Mac a lui-même proposées (RF 1)', async () => {
    const oui = prop(), pasOui = prop({ id: 'cache:library', statut: 'proposee', cibles: [`${CURSOR}/Cache/Cache_Data`] });
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [oui, pasOui], etat: { ...RECENT, isaacProposees: { ...connue(oui).isaacProposees, ...connue(pasOui).isaacProposees } }, libres: [10 * GO, 13 * GO] });
    await passageIsaac(deps);
    expect(j.rm).toEqual([`${CURSOR}/CachedData/abc`]);
    expect(j.appels.filter(a => a[0] === 'faits')).toEqual([['faits', { resultats: [{ id: 'cache:cursor', libere: 3 * GO }], missions: [], libre: 13 * GO }]]);
  });
  it('une proposition « oui » que le Mac ne reconnaît pas (cibles changées) → refus, rien supprimé', async () => {
    const oui = prop({ cibles: [`${CURSOR}/CachedData/abc`, `${CURSOR}/Cache/Cache_Data`] });
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [oui], etat: { ...RECENT, ...connue(prop()) } });
    await passageIsaac(deps);
    expect(j.rm).toEqual([]);
    expect(j.appels.find(a => a[0] === 'faits')[1].resultats).toEqual([{ id: 'cache:cursor', refus: true, raison: 'ce Mac ne reconnaît pas cette proposition' }]);
  });
  it('a-faire rejoué après un bilan perdu : pas de seconde suppression, le bilan est renvoyé tel quel', async () => {
    const oui = prop();
    const r1 = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [oui], etat: { ...RECENT, ...connue(oui) }, echecs: { faits: true }, libres: [10 * GO, 13 * GO] });
    const patch = await passageIsaac(r1.deps);
    expect(r1.j.rm).toHaveLength(1);
    const r2 = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [oui], etat: { ...RECENT, ...patch } });
    const patch2 = await passageIsaac({ ...r2.deps, now: NOW + 5 * MIN });
    expect(r2.j.rm).toEqual([]);
    expect(r2.j.appels.filter(a => a[0] === 'faits').map(a => a[1])).toEqual([{ resultats: [{ id: 'cache:cursor', libere: 3 * GO }], missions: [], libre: 13 * GO }]);
    expect(patch2.isaacBilan).toBeNull();
  });
  it('plusieurs Oui dans un passage : un seul bilan (un seul message)', async () => {
    const a = prop(), b = prop({ id: 'cache:cursor-espaces', cibles: [`${CURSOR}/Cache/Cache_Data`] });
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [a, b], etat: { ...RECENT, isaacProposees: { ...connue(a).isaacProposees, ...connue(b).isaacProposees } } });
    await passageIsaac(deps);
    expect(j.appels.filter(x => x[0] === 'faits')).toHaveLength(1);
    expect(j.appels.filter(x => x[0] === 'faits')[0][1].resultats.map(r => r.id)).toEqual(['cache:cursor', 'cache:cursor-espaces']);
    expect(j.appels.some(x => x[0] === 'fait')).toBe(false);
  });
  it('workspaceStorage touché 2 jours avant le Oui → pas effacé (« utilisé récemment »)', async () => {
    const W = `${CURSOR}/User/workspaceStorage`;
    const oui = prop({ id: 'cache:cursor-espaces', cibles: [`${W}/abc`] });
    const etat = { ...RECENT, isaacProposees: { [oui.id]: { genre: 'cache', cibles: oui.cibles, seuils: { [`${W}/abc`]: 30 * 24 * 60 }, quand: NOW - 3 * JOUR } } };
    const { deps, j } = relaisIsaac({ chemins: [`${W}/abc/state.vscdb`], ages: { [`${W}/abc/state.vscdb`]: 2 * 24 * 60 }, acceptees: [oui], etat });
    await passageIsaac(deps);
    expect(j.rm).toEqual([]);
    expect(j.appels.find(a => a[0] === 'faits')[1].resultats).toEqual([{ id: oui.id, refus: true, raison: 'utilisé récemment' }]);
  });
  it('le seuil vient aussi du lieu : même sans seuil gardé, ~/Library/Caches exige 30 jours', async () => {
    const L = `${H}/Library/Caches/vieux`;
    const { deps, j } = monde({ chemins: [`${L}/a`], ages: { [`${L}/a`]: 3 * 24 * 60 } });
    expect(await executer(deps, prop({ id: 'cache:library', cibles: [L] }))).toEqual({ refus: true, raison: 'utilisé récemment' });
    expect(j.rm).toEqual([]);
  });
  it('les seuils restent sur le Mac : jamais envoyés au QG', async () => {
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, libres: [15 * GO] });
    const patch = await passageIsaac(deps);
    expect(JSON.stringify(j.appels.find(a => a[0] === 'proposer')[1])).not.toContain('seuils');
    expect(patch.isaacProposees['cache:cursor'].seuils[`${CURSOR}/CachedData/abc`]).toBe(60);
  });
  it('une proposition gardée depuis plus de 7 jours peut être renvoyée', async () => {
    const etat = { ...RECENT, isaacProposees: { 'cache:cursor': { genre: 'cache', cibles: [`${CURSOR}/CachedData/abc`], quand: NOW - 8 * JOUR } } };
    const { deps, j } = relaisIsaac({ etat, missions: [{ id: 'm1', texte: 'vide le cache' }], chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO } });
    await passageIsaac(deps);
    expect(j.appels.find(a => a[0] === 'proposer')[1].propositions.map(p => p.id)).toEqual(['cache:cursor']);
  });
  it('sous 20 Go, une fois par heure : rapport puis proposer', async () => {
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, libres: [15 * GO] });
    const patch = await passageIsaac(deps);
    expect(j.appels.map(a => a[0])).toEqual(['a-faire', 'rapport', 'proposer']);
    expect(j.appels[1][1]).toEqual({ libre: 15 * GO, total: 228 * GO });
    expect(j.appels[2][1].propositions.map(p => p.id)).toContain('cache:cursor');
    expect(patch.derniereMesureIsaac).toBe(NOW);
    expect(patch.isaacProposees['cache:cursor'].cibles.sort()).toEqual([`${CURSOR}/Cache/Cache_Data`, `${CURSOR}/CachedData/abc`]);
    // le passage suivant (5 min) ne remesure pas
    const r2 = relaisIsaac({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, libres: [15 * GO], etat: patch });
    await passageIsaac({ ...r2.deps, now: NOW + 5 * MIN });
    expect(r2.j.appels.map(a => a[0])).toEqual(['a-faire']);
  });
  it('au-dessus de 20 Go : rapport, pas de proposition', async () => {
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, libres: [30 * GO] });
    await passageIsaac(deps);
    expect(j.appels.map(a => a[0])).toEqual(['a-faire', 'rapport']);
  });
  it('mission « vide le cache » → propositions de caches même au-dessus de 20 Go, sans node_modules', async () => {
    const P = `${CODE}/livreo`;
    const { deps, j } = relaisIsaac({
      etat: RECENT, missions: [{ id: 'm1', agent: 'isaac', texte: 'vide le cache', quand: NOW }], libres: [30 * GO],
      chemins: [...CURSOR_CHEMINS, `${P}/node_modules/a`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR } },
      tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO, [`${P}/node_modules`]: GO },
    });
    await passageIsaac(deps);
    const p = j.appels.find(a => a[0] === 'proposer');
    expect(p[1].propositions.map(x => x.id)).toEqual(['cache:cursor']);
    expect(j.appels.filter(a => a[0] === 'mission')).toEqual([['mission', { id: 'm1', texte: 'vide le cache', etat: 'prise' }]]);
    expect(j.appels.find(a => a[0] === 'faits')[1].missions).toEqual([{ id: 'm1', texte: 'vide le cache', etat: 'proposee' }]);
    expect(j.appels.map(a => a[0])).toEqual(['a-faire', 'mission', 'proposer', 'faits']);
  });
  it('mission sans rien à libérer → « rien » avec la place libre', async () => {
    const { deps, j } = relaisIsaac({ etat: RECENT, missions: [{ id: 'm1', agent: 'isaac', texte: 'vide le cache', quand: NOW }], libres: [30 * GO] });
    await passageIsaac(deps);
    expect(j.appels.filter(a => a[0] === 'mission').map(a => a[1])).toEqual([{ id: 'm1', texte: 'vide le cache', etat: 'prise' }]);
    expect(j.appels.find(a => a[0] === 'faits')[1]).toEqual({ resultats: [], missions: [{ id: 'm1', texte: 'vide le cache', etat: 'rien' }], libre: 30 * GO });
    expect(j.appels.some(a => a[0] === 'proposer')).toBe(false);
  });
  it('mission dont tout attend déjà une réponse au QG → « attente », jamais « rien »', async () => {
    const { deps, j } = relaisIsaac({ etat: RECENT, missions: [{ id: 'm1', agent: 'isaac', texte: 'vide le cache', quand: NOW }], libres: [30 * GO],
      chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, dejaProposees: ['cache:cursor'] });
    await passageIsaac(deps);
    expect(j.appels.find(a => a[0] === 'faits')[1].missions[0].etat).toBe('attente');
  });
  it('mission dont tout attend chez ce Mac (pas renvoyé) → « attente »', async () => {
    const { deps, j } = relaisIsaac({ etat: { ...RECENT, ...connue(prop()) }, missions: [{ id: 'm1', texte: 'vide le cache' }],
      chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO } });
    await passageIsaac(deps);
    expect(j.appels.some(a => a[0] === 'proposer')).toBe(false);
    expect(j.appels.find(a => a[0] === 'faits')[1].missions[0].etat).toBe('attente');
  });
  it('mission dont tout a été refusé récemment → « ecartee », jamais « rien »', async () => {
    const { deps, j } = relaisIsaac({ etat: RECENT, missions: [{ id: 'm1', texte: 'vide le cache' }],
      chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, ecarteesQG: ['cache:cursor'] });
    await passageIsaac(deps);
    expect(j.appels.find(a => a[0] === 'faits')[1].missions[0].etat).toBe('ecartee');
  });
  it('le suivi de mission en échec ne bloque rien', async () => {
    const { deps, j } = relaisIsaac({ etat: RECENT, missions: [{ id: 'm1', agent: 'isaac', texte: 'vide le cache', quand: NOW }], libres: [30 * GO],
      chemins: CURSOR_CHEMINS, tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO }, echecs: { mission: true, faits: true } });
    const patch = await passageIsaac(deps);
    expect(j.appels.map(a => a[0])).toEqual(['a-faire', 'mission', 'proposer', 'faits']);
    expect(patch.isaacBilan.missions).toEqual([{ id: 'm1', texte: 'vide le cache', etat: 'proposee' }]);
  });
  it('modeMission : « cache » en mot entier seulement', () => {
    expect(modeMission('vide le cache')).toBe('caches');
    expect(modeMission('nettoie les caches')).toBe('caches');
    expect(modeMission('cacher la barre et fais de la place')).toBe('tout');
  });
  it('au plus 3 propositions par appel, en laissant de côté ce que ce Mac a déjà en attente', async () => {
    const L = `${H}/Library/Caches`;
    const P = n => `${CODE}/p${n}`;
    const { deps, j } = relaisIsaac({
      etat: { ...RECENT, isaacProposees: { 'cache:cursor': { genre: 'cache', cibles: [`${CURSOR}/CachedData/abc`], quand: NOW - JOUR } } },
      missions: [{ id: 'm1', agent: 'isaac', texte: 'fais de la place', quand: NOW }], libres: [30 * GO],
      chemins: [...CURSOR_CHEMINS, `${L}/vieux/a`, ...[1, 2, 3].flatMap(n => [`${P(n)}/node_modules/a`, `${P(n)}/.git/HEAD`])],
      git: Object.fromEntries([1, 2, 3].map(n => [P(n), { commit: NOW - 60 * JOUR }])),
      tailles: { [`${CURSOR}/CachedData/abc`]: 9 * GO, [`${L}/vieux`]: GO, [`${P(1)}/node_modules`]: GO, [`${P(2)}/node_modules`]: 3 * GO, [`${P(3)}/node_modules`]: 2 * GO },
    });
    await passageIsaac(deps);
    expect(j.appels.find(a => a[0] === 'proposer')[1].propositions.map(x => x.id)).toEqual(['cache:library', 'nm:p2', 'nm:p3']);
  });
  it('mission « fais de la place » → caches puis node_modules', async () => {
    const P = `${CODE}/livreo`;
    const { deps, j } = relaisIsaac({
      etat: RECENT, missions: [{ id: 'm1', agent: 'isaac', texte: 'fais de la place', quand: NOW }], libres: [30 * GO],
      chemins: [...CURSOR_CHEMINS, `${P}/node_modules/a`, `${P}/.git/HEAD`], git: { [P]: { commit: NOW - 60 * JOUR } },
      tailles: { [`${CURSOR}/CachedData/abc`]: 3 * GO, [`${P}/node_modules`]: 5 * GO },
    });
    await passageIsaac(deps);
    expect(j.appels.find(a => a[0] === 'proposer')[1].propositions.map(x => x.id)).toEqual(['cache:cursor', 'nm:livreo']);
  });
  it('a-faire en échec : rien n\'est exécuté, la mesure horaire se fait quand même', async () => {
    const { deps, j } = relaisIsaac({ chemins: CURSOR_CHEMINS, acceptees: [prop()], etat: connue(prop()), echecs: { 'a-faire': true }, libres: [30 * GO] });
    await passageIsaac(deps);
    expect(j.rm).toEqual([]);
    expect(j.appels.map(a => a[0])).toEqual(['a-faire', 'rapport']);
  });
  it('rapport en échec : la mesure sera retentée au passage suivant', async () => {
    const { deps } = relaisIsaac({ echecs: { rapport: true }, libres: [30 * GO] });
    const patch = await passageIsaac(deps);
    expect(patch.derniereMesureIsaac).toBeUndefined();
  });
});
