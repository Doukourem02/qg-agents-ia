import { describe, expect, it } from 'vitest';
import { fichiersDeDependances, lireDependances } from './dependances';

const PNPM_V9 = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      next:
        specifier: ^14.1.0
        version: 14.1.0(react-dom@18.2.0(react@18.2.0))(react@18.2.0)
    devDependencies:
      vitest:
        specifier: ^2.0.0
        version: 2.0.5

packages:

  next@14.1.0:
    resolution: {integrity: sha512-aaa}
    engines: {node: '>=18.17.0'}

  '@scope/outil@1.4.2':
    resolution: {integrity: sha512-bbb}

  postcss@8.4.31:
    resolution: {integrity: sha512-ccc}

  vitest@2.0.5:
    resolution: {integrity: sha512-ddd}

snapshots:

  next@14.1.0(react-dom@18.2.0(react@18.2.0))(react@18.2.0):
    dependencies:
      postcss: 8.4.31

  postcss@8.4.31: {}
`;

describe('fichiersDeDependances', () => {
  it('garde les fichiers à la racine et un niveau plus bas, jamais dans node_modules', () => {
    expect(fichiersDeDependances(['package.json', 'pnpm-lock.yaml', 'apps/web/package.json', 'a/b/c/package.json', 'node_modules/x/package.json', 'requirements.txt', 'README.md']))
      .toEqual(['package.json', 'pnpm-lock.yaml', 'apps/web/package.json', 'requirements.txt']);
  });
  it('garde poetry.lock pour pouvoir le dire non lu', () => {
    expect(fichiersDeDependances(['poetry.lock', 'api/poetry.lock'])).toEqual(['poetry.lock', 'api/poetry.lock']);
  });
});

describe('lireDependances', () => {
  it('pnpm-lock v9 : versions résolues ; directeProd seulement pour les `dependencies` du package.json voisin', () => {
    const deps = lireDependances({ 'package.json': '{"dependencies":{"next":"^14.1.0"},"devDependencies":{"vitest":"^2.0.0"}}', 'pnpm-lock.yaml': PNPM_V9 })!;
    expect(deps).toContainEqual({ nom: 'next', version: '14.1.0', ecosysteme: 'npm', directeProd: true });
    expect(deps).toContainEqual({ nom: 'vitest', version: '2.0.5', ecosysteme: 'npm', directeProd: false });
    expect(deps).toContainEqual({ nom: 'postcss', version: '8.4.31', ecosysteme: 'npm', directeProd: false });
    expect(deps).toContainEqual({ nom: '@scope/outil', version: '1.4.2', ecosysteme: 'npm', directeProd: false });
    expect(deps.filter((d) => d.nom === 'next')).toHaveLength(1);
  });

  it('package-lock.json (v3, clé "packages") et yarn.lock v1 sont lus aussi', () => {
    const npm = lireDependances({
      'package.json': '{"dependencies":{"left-pad":"^1.3.0"}}',
      'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'x', dependencies: { 'left-pad': '^1.3.0' } }, 'node_modules/left-pad': { version: '1.3.0' }, 'node_modules/a/node_modules/@s/b': { version: '2.0.1' } } }),
    })!;
    expect(npm).toContainEqual({ nom: 'left-pad', version: '1.3.0', ecosysteme: 'npm', directeProd: true });
    expect(npm).toContainEqual({ nom: '@s/b', version: '2.0.1', ecosysteme: 'npm', directeProd: false });
    const yarn = lireDependances({
      'yarn.lock': '# yarn lockfile v1\n\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.22.5"\n  resolved "https://x"\n\nlodash@^4.17.0:\n  version "4.17.21"\n',
    })!;
    expect(yarn).toContainEqual({ nom: '@babel/core', version: '7.22.5', ecosysteme: 'npm', directeProd: false });
    expect(yarn).toContainEqual({ nom: 'lodash', version: '4.17.21', ecosysteme: 'npm', directeProd: false });
  });

  it('sans fichier de verrouillage : versions de package.json débarrassées de ^ et ~ ; plage non exacte (">=1 <2", "latest") ignorée', () => {
    expect(lireDependances({ 'package.json': '{"dependencies":{"a":"^1.2.3","b":"latest"}}' })).toEqual([{ nom: 'a', version: '1.2.3', ecosysteme: 'npm', directeProd: false }]);
    expect(lireDependances({ 'package.json': '{"dependencies":{"c":">=1 <2","d":"~2.0.1"}}' })).toEqual([{ nom: 'd', version: '2.0.1', ecosysteme: 'npm', directeProd: false }]);
  });

  it('sans aucun verrou : seule une version épinglée exactement est « directe de production » ; une plage (^, ~) reste pour la page', () => {
    const deps = lireDependances({ 'package.json': '{"dependencies":{"epingle":"4.17.20","plage":"^1.2.3","tilde":"~2.0.1"},"devDependencies":{"outil":"1.0.0"}}' });
    expect(deps).toEqual([
      { nom: 'epingle', version: '4.17.20', ecosysteme: 'npm', directeProd: true },
      { nom: 'plage', version: '1.2.3', ecosysteme: 'npm', directeProd: false },
      { nom: 'tilde', version: '2.0.1', ecosysteme: 'npm', directeProd: false },
      { nom: 'outil', version: '1.0.0', ecosysteme: 'npm', directeProd: false },
    ]);
  });

  it('pnpm, verrou à la racine : le package.json d\'un sous-paquet n\'est pas relu à part ; ses dépendances directes viennent de son importer', () => {
    const pnpm = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^2.0.0
        version: 2.0.5

  apps/web:
    dependencies:
      next:
        specifier: ^14.1.0
        version: 14.2.0(react@18.2.0)

packages:

  next@14.2.0:
    resolution: {integrity: a}

  vitest@2.0.5:
    resolution: {integrity: b}
`;
    const deps = lireDependances({
      'package.json': '{"devDependencies":{"vitest":"^2.0.0"}}',
      'pnpm-lock.yaml': pnpm,
      'apps/web/package.json': '{"dependencies":{"next":"^14.1.0"}}',
    })!;
    expect(deps).toContainEqual({ nom: 'next', version: '14.2.0', ecosysteme: 'npm', directeProd: true });
    expect(deps.filter(d => d.nom === 'next')).toHaveLength(1); // jamais le plancher 14.1.0 tiré du manifeste
    expect(deps).toContainEqual({ nom: 'vitest', version: '2.0.5', ecosysteme: 'npm', directeProd: false });
  });

  it('npm workspaces, verrou à la racine : sous-paquet couvert par le verrou, ses dépendances directes marquées à leur version résolue', () => {
    const deps = lireDependances({
      'package.json': '{"workspaces":["apps/*"]}',
      'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: {
        '': { workspaces: ['apps/*'] },
        'apps/web': { dependencies: { lodash: '^4.17.0', left: '^1.0.0' } },
        'node_modules/web': { resolved: 'apps/web', link: true },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/left': { version: '2.0.0' },
        'apps/web/node_modules/left': { version: '1.3.0' },
      } }),
      'apps/web/package.json': '{"dependencies":{"lodash":"^4.17.0","left":"^1.0.0"}}',
    })!;
    expect(deps).toContainEqual({ nom: 'lodash', version: '4.17.21', ecosysteme: 'npm', directeProd: true });
    expect(deps).toContainEqual({ nom: 'left', version: '1.3.0', ecosysteme: 'npm', directeProd: true });
    expect(deps).toContainEqual({ nom: 'left', version: '2.0.0', ecosysteme: 'npm', directeProd: false });
    expect(deps.find(d => d.nom === 'lodash' && d.version === '4.17.0')).toBeUndefined();
  });

  it('yarn workspaces, verrou à la racine : le sous-paquet n\'est pas relu à part ; ses dépendances de production comptent comme directes', () => {
    const deps = lireDependances({
      'package.json': '{"private":true,"workspaces":["packages/*"]}',
      'yarn.lock': '# yarn lockfile v1\n\nlodash@^4.17.0:\n  version "4.17.21"\n',
      'packages/a/package.json': '{"dependencies":{"lodash":"^4.17.0"}}',
    })!;
    expect(deps).toEqual([{ nom: 'lodash', version: '4.17.21', ecosysteme: 'npm', directeProd: true }]);
  });

  it('verrou à la racine qui ne couvre pas un sous-dossier : son manifeste est lu, une plage reste pour la page', () => {
    const pnpm = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      a:\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: a}\n";
    const deps = lireDependances({
      'package.json': '{"dependencies":{"a":"1.0.0"}}',
      'pnpm-lock.yaml': pnpm,
      'outils/package.json': '{"dependencies":{"left-pad":"^1.3.0","exact":"2.0.0"}}',
    })!;
    expect(deps).toContainEqual({ nom: 'left-pad', version: '1.3.0', ecosysteme: 'npm', directeProd: false });
    expect(deps).toContainEqual({ nom: 'exact', version: '2.0.0', ecosysteme: 'npm', directeProd: true });
    expect(deps).toContainEqual({ nom: 'a', version: '1.0.0', ecosysteme: 'npm', directeProd: true });
  });

  it('requirements.txt : seulement les lignes « nom==version », toutes directeProd', () => {
    expect(lireDependances({ 'requirements.txt': '# commentaire\ndjango==4.2.1\nrequests>=2\n-r autre.txt\nFlask==2.3.0 # note\n' })).toEqual([
      { nom: 'django', version: '4.2.1', ecosysteme: 'PyPI', directeProd: true },
      { nom: 'Flask', version: '2.3.0', ecosysteme: 'PyPI', directeProd: true },
    ]);
  });

  it('un fichier présent mais illisible → null (illisible, jamais une liste vide)', () => {
    expect(lireDependances({ 'package.json': '{pas du json' })).toBeNull();
    expect(lireDependances({ 'package.json': '{}', 'package-lock.json': 'nope' })).toBeNull();
    expect(lireDependances({ 'pnpm-lock.yaml': 'quelque chose\nd autre' })).toBeNull();
  });

  it('poetry.lock seul comme fichier Python → null (non lu, jamais sain)', () => {
    expect(lireDependances({ 'poetry.lock': '[[package]]\nname = "x"\nversion = "1.0.0"\n' })).toBeNull();
    expect(lireDependances({ 'api/poetry.lock': 'x', 'api/requirements.txt': 'django==4.2.1' })).not.toBeNull();
  });

  it('aucun fichier → [] ; doublons fusionnés (même nom, version, écosystème), directeProd gagne', () => {
    expect(lireDependances({})).toEqual([]);
    const deps = lireDependances({
      'package.json': '{"dependencies":{"a":"1.0.0"}}',
      'web/package.json': '{"devDependencies":{"a":"1.0.0"}}',
    })!;
    expect(deps).toEqual([{ nom: 'a', version: '1.0.0', ecosysteme: 'npm', directeProd: true }]);
  });

  it('verrou présent mais rien de reconnu → null ; verrou vraiment vide sans dépendances → []', () => {
    const v5 = "lockfileVersion: 5.4\n\npackages:\n\n  /next/14.1.0_react@18:\n    resolution: {integrity: x}\n";
    expect(lireDependances({ 'package.json': '{"dependencies":{"next":"14.1.0"}}', 'pnpm-lock.yaml': v5 })).toBeNull();
    expect(lireDependances({ 'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/x': { resolved: 'u' } } }) })).toBeNull();
    expect(lireDependances({ 'yarn.lock': 'format inconnu\n  truc\n' })).toBeNull();
    expect(lireDependances({ 'package.json': '{"dependencies":{"a":"1.0.0"}}', 'package-lock.json': JSON.stringify({ packages: { '': {} } }) })).toBeNull();
    expect(lireDependances({ 'package.json': '{"name":"x"}', 'package-lock.json': JSON.stringify({ packages: { '': {} } }) })).toEqual([]);
  });

  it('directeProd = version résolue de la dépendance directe : postcss direct 8.0.0 et indirect 8.4.31', () => {
    const pnpm = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      postcss:
        specifier: ^8.0.0
        version: 8.0.0

packages:

  postcss@8.0.0:
    resolution: {integrity: a}

  postcss@8.4.31:
    resolution: {integrity: b}
`;
    const p = lireDependances({ 'package.json': '{"dependencies":{"postcss":"^8.0.0"}}', 'pnpm-lock.yaml': pnpm })!;
    expect(p.find((d) => d.version === '8.0.0')!.directeProd).toBe(true);
    expect(p.find((d) => d.version === '8.4.31')!.directeProd).toBe(false);
    const n = lireDependances({
      'package.json': '{"dependencies":{"postcss":"8.0.0"}}',
      'package-lock.json': JSON.stringify({ packages: { '': { dependencies: { postcss: '8.0.0' } }, 'node_modules/postcss': { version: '8.0.0' }, 'node_modules/x/node_modules/postcss': { version: '8.4.31' } } }),
    })!;
    expect(n.find((d) => d.version === '8.0.0')!.directeProd).toBe(true);
    expect(n.find((d) => d.version === '8.4.31')!.directeProd).toBe(false);
  });
});
