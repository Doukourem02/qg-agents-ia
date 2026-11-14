import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estFichierCle, estFichierEnv, masquer, reperer } from './cles';

const DEBUT = '-----BEGIN ';
const FIN = '-----END ';
const CORPS = 'MIIE'.repeat(16);
const ajout = (contenu: string) => `@@ -0,0 +1,1 @@\n+${contenu}`;

describe('reperer', () => {
  it('formes connues dans une ligne ajoutée, avec la bonne ligne', () => {
    const patch = '@@ -1,2 +10,3 @@\n const a = 1;\n+const t = "ghp_' + 'A'.repeat(36) + '";\n-const b = 2;';
    expect(reperer('src/x.ts', patch)).toEqual([{ ligne: 11, genre: 'clé GitHub' }]);
  });

  it('les lignes retirées et le contexte ne comptent pas', () => {
    const s = 'ghp_' + 'A'.repeat(36);
    const patch = `@@ -1,3 +1,3 @@\n k = "${s}"\n-old = "${s}"\n+ok = 1\n\\ No newline at end of file`;
    expect(reperer('src/x.ts', patch)).toEqual([]);
  });

  it('la ligne tient compte des lignes de contexte et ignore les retirées', () => {
    const s = 'AKIA' + 'B'.repeat(16);
    const patch = `@@ -5,3 +20,3 @@\n a\n-b\n+c\n+d = "${s}"`;
    expect(reperer('a.ts', patch)).toEqual([{ ligne: 22, genre: 'clé AWS' }]);
  });

  it('chaque forme', () => {
    const formes: [string, string][] = [
      ['github_pat_' + 'a1B2'.repeat(6), 'clé GitHub'],
      ['gho_' + 'A'.repeat(36), 'clé GitHub'],
      ['sk-ant-api03-' + 'b'.repeat(40), 'clé Anthropic'],
      ['sk-' + 'c'.repeat(48), 'clé OpenAI'],
      ['sk-proj-' + 'd'.repeat(48), 'clé OpenAI'],
      ['AKIA' + 'E'.repeat(16), 'clé AWS'],
      ['sk_live_' + 'f'.repeat(24), 'clé Stripe'],
      ['AIza' + 'g'.repeat(35), 'clé Google'],
      ['xoxb-' + '1234567890-abcdef', 'jeton Slack'],
      ['rk_live_' + 'f'.repeat(24), 'clé Stripe'],
      [DEBUT + 'RSA PRIVATE KEY-----' + CORPS, 'clé privée'],
      [DEBUT + 'PRIVATE KEY-----' + CORPS, 'clé privée'],
      ['12345678:AA' + 'h'.repeat(33), 'jeton Telegram'],
      ['1234567890:AA' + 'H_-'.repeat(11), 'jeton Telegram'],
    ];
    for (const [secret, genre] of formes) {
      expect(reperer('src/x.ts', ajout(`x = "${secret}"`)), secret.slice(0, 8)).toEqual([{ ligne: 1, genre }]);
    }
  });

  it('une clé privée sur plusieurs lignes ne compte qu’une fois', () => {
    const patch = `@@ -0,0 +1,3 @@\n+${DEBUT}PRIVATE KEY-----\n+${CORPS}\n+${FIN}PRIVATE KEY-----`;
    expect(reperer('k.pem', patch)).toEqual([{ ligne: 1, genre: 'clé privée' }]);
  });

  it('.env* : affectations de secrets', () => {
    const patch = '@@ -0,0 +1,6 @@\n+API_KEY=valeurReelle42\n+DB_PASSWORD=\n+# TOKEN_X=abc\n+MON_SECRET="abc123def"\n+NOM=bob\n+export AUTH_TOKEN=zzz9';
    expect(reperer('.env.local', patch)).toEqual([
      { ligne: 1, genre: 'secret dans un .env' },
      { ligne: 4, genre: 'secret dans un .env' },
      { ligne: 6, genre: 'secret dans un .env' },
    ]);
  });

  it('.env : valeurs factices → rien', () => {
    const valeurs = ['', 'xxx', 'xxxxxxxx', 'changeme', 'your_api_key', '<ta clé>', '…', '...', 'example', 'test'];
    const patch = `@@ -0,0 +1,${valeurs.length} @@\n` + valeurs.map((v, i) => `+K${i}_KEY=${v}`).join('\n');
    expect(reperer('apps/web/.env.production', patch)).toEqual([]);
  });

  it('une affectation de secret hors .env n’est pas signalée', () => {
    expect(reperer('src/config.ts', ajout('API_KEY=valeurReelle42'))).toEqual([]);
  });

  it('rien dans un fichier ordinaire → []', () => {
    expect(reperer('src/x.ts', '@@ -1,1 +1,2 @@\n a\n+const b = 2;')).toEqual([]);
  });

  it('une clé Anthropic n’est pas aussi comptée OpenAI', () => {
    const r = reperer('x.ts', ajout('k=sk-ant-api03-' + 'b'.repeat(60)));
    expect(r).toEqual([{ ligne: 1, genre: 'clé Anthropic' }]);
  });
});

describe('reperer : cas limites', () => {
  it('clé privée remplacée sur place (en-tête en contexte)', () => {
    const patch = `@@ -1,4 +1,4 @@\n ${DEBUT}PRIVATE KEY-----\n-${'O'.repeat(64)}\n+${CORPS}\n ${FIN}PRIVATE KEY-----`;
    expect(reperer('k.pem', patch)).toEqual([{ ligne: 2, genre: 'clé privée' }]);
  });

  it('une clé privée dans une phrase de code, sans corps, n’est pas signalée', () => {
    const patch = ajout('const pem = `' + DEBUT + 'PRIVATE KEY-----\\n${process.env.K}`;');
    expect(reperer('src/pem.ts', patch)).toEqual([]);
    expect(masquer(patch)).toBe(patch);
  });

  it('jeton Telegram dans l’adresse de l’API, repéré et masqué', () => {
    const jeton = '123456789:AA' + 'z'.repeat(33);
    const patch = ajout(`fetch("https://api.telegram.org/bot${jeton}/sendMessage")`);
    expect(reperer('src/t.ts', patch)).toEqual([{ ligne: 1, genre: 'jeton Telegram' }]);
    expect(masquer(patch)).not.toContain(jeton);
    expect(masquer(patch)).toContain('bot[jeton Telegram masquée]/sendMessage');
  });

  it('fichier .env en CRLF', () => {
    expect(reperer('.env', ajout('API_KEY=valeurReelle42\r'))).toEqual([{ ligne: 1, genre: 'secret dans un .env' }]);
    expect(reperer('.env', ajout('API_KEY=changeme\r'))).toEqual([]);
  });

  it('pas de fausse alerte : mot ordinaire et exemple Slack', () => {
    expect(reperer('src/x.ts', ajout('class="task-list-item-with-a-very-long-name-for-the-checkbox-input-element"'))).toEqual([]);
    expect(reperer('README.md', ajout('SLACK_TOKEN=xoxb-your-token'))).toEqual([]);
  });

  it('+++ dans un bloc est une ligne ajoutée qui avance le compteur', () => {
    const s = 'AKIA' + 'B'.repeat(16);
    const patch = `@@ -0,0 +1,3 @@\n+a\n++++ titre\n+k="${s}"`;
    expect(reperer('a.ts', patch)).toEqual([{ ligne: 3, genre: 'clé AWS' }]);
  });

  it('deux secrets différents sur une ligne : les deux repérés et masqués', () => {
    const a = 'ghp_' + 'A'.repeat(36);
    const b = 'AKIA' + 'B'.repeat(16);
    const patch = ajout(`x="${a}" y="${b}"`);
    expect(reperer('a.ts', patch)).toEqual([{ ligne: 1, genre: 'clé GitHub' }, { ligne: 1, genre: 'clé AWS' }]);
    expect(masquer(patch)).toBe('@@ -0,0 +1,1 @@\n+x="[clé GitHub masquée]" y="[clé AWS masquée]"');
  });

  it('le fichier de test lui-même ne déclenche jamais Léa', () => {
    const source = readFileSync(new URL('./cles.test.ts', import.meta.url), 'utf8');
    const patch = '@@ -0,0 +1,1 @@\n' + source.split('\n').map((l) => '+' + l).join('\n');
    expect(reperer('src/server/lea/cles.test.ts', patch)).toEqual([]);
  });
});

describe('reperer : clés privées difficiles (I5)', () => {
  const CORPS2 = 'QUJD'.repeat(16);
  it('ancienne clé chiffrée (Proc-Type, DEK-Info, ligne vide) : corps 4 lignes après l’en-tête, repérée et masquée', () => {
    const patch = [
      '@@ -0,0 +1,7 @@', `+${DEBUT}RSA PRIVATE KEY-----`, '+Proc-Type: 4,ENCRYPTED', '+DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
      '+', `+${CORPS}`, `+${CORPS2}`, `+${FIN}RSA PRIVATE KEY-----`,
    ].join('\n');
    expect(reperer('src/cle.ts', patch)).toEqual([{ ligne: 1, genre: 'clé privée' }]);
    const m = masquer(patch);
    expect(m).not.toContain(CORPS);
    expect(m).not.toContain(CORPS2);
  });

  it('bloc qui commence au milieu d’une clé (fin sans début) : corps masqué, clé repérée', () => {
    const patch = `@@ -5,4 +5,4 @@\n ${CORPS}\n-${'O'.repeat(64)}\n+${CORPS2}\n ${FIN}PRIVATE KEY-----`;
    expect(reperer('src/cle.ts', patch)).toEqual([{ ligne: 6, genre: 'clé privée' }]);
    const m = masquer(patch);
    expect(m).not.toContain(CORPS);
    expect(m).not.toContain(CORPS2);
  });

  it('bloc au milieu d’un corps de clé, sans début ni fin : lignes de clé masquées', () => {
    const patch = `@@ -8,3 +8,3 @@\n ${CORPS}\n-${CORPS2}\n+${CORPS2.toLowerCase()}`;
    const m = masquer(patch);
    expect(m).not.toContain(CORPS);
    expect(m).not.toContain(CORPS2.toLowerCase());
  });
});

describe('fichiers de clé et .env (I5, M11)', () => {
  it('estFichierCle : formats de clés, jamais une clé publique', () => {
    for (const c of ['cle.pem', 'certs/serveur.key', 'a/b.p12', 'x.pfx', 'android/app.jks', 'release.keystore', 'id_rsa', '.ssh/id_ed25519', 'id_ecdsa', 'id_dsa', 'id_rsa.pem'])
      expect(estFichierCle(c), c).toBe(true);
    for (const c of ['id_rsa.pub', '.ssh/id_ed25519.pub', 'src/key.ts', 'keys.json', 'pem.md', 'src/id_rsa_parser.ts', 'id_rsa.ts', 'id_ecdsa_perso', 'id_rsa.bak'])
      expect(estFichierCle(c), c).toBe(false);
  });
  it('.envrc est un fichier .env', () => {
    expect(estFichierEnv('.envrc')).toBe(true);
    expect(reperer('.envrc', ajout('export API_TOKEN=valeurReelle42'))).toEqual([{ ligne: 1, genre: 'secret dans un .env' }]);
  });
  it('.env : une adresse avec identifiants (://utilisateur:mot@) est un secret', () => {
    const patch = '@@ -0,0 +1,3 @@\n+DATABASE_URL=postgres://moi:' + 'motDePasse' + '@db.exemple.com:5432/base\n+SITE=https://exemple.com\n+REDIS=redis://db.exemple.com:6379';
    expect(reperer('.env', patch)).toEqual([{ ligne: 1, genre: 'secret dans un .env' }]);
    expect(reperer('src/config.ts', patch)).toEqual([]);
  });
});

describe('estFichierEnv', () => {
  it('reconnaît les .env réels', () => {
    for (const c of ['.env', '.env.local', 'apps/web/.env.production']) expect(estFichierEnv(c), c).toBe(true);
  });
  it('refuse les modèles et autres', () => {
    for (const c of ['.env.example', 'env.ts', 'src/env.ts', '.env.sample', 'a/.environment']) expect(estFichierEnv(c), c).toBe(false);
  });
});

describe('masquer', () => {
  it('le secret disparaît, la ligne reste', () => {
    const s = 'sk-ant-api03-' + 'b'.repeat(40);
    const m = masquer(`+key=${s}\n`);
    expect(m).not.toContain(s);
    expect(m).toContain('[clé Anthropic masquée]');
    expect(m).toBe('+key=[clé Anthropic masquée]\n');
  });

  it('la ligne reste autour', () => {
    const s = 'ghp_' + 'A'.repeat(36);
    expect(masquer(`+const t = "${s}";`)).toBe('+const t = "[clé GitHub masquée]";');
  });

  it('masque aussi le contexte et les lignes retirées', () => {
    const s = 'AKIA' + 'B'.repeat(16);
    const m = masquer(`@@ -1,2 +1,1 @@\n a="${s}"\n-b="${s}"`);
    expect(m).not.toContain(s);
    expect(m).toBe('@@ -1,2 +1,1 @@\n a="[clé AWS masquée]"\n-b="[clé AWS masquée]"');
  });

  it('masque le corps d’une clé privée', () => {
    const corps = CORPS;
    const m = masquer(`+${DEBUT}PRIVATE KEY-----\n+${corps}\n+${FIN}PRIVATE KEY-----\n+suite = 1`);
    expect(m).not.toContain(corps);
    expect(m).toContain('[clé privée masquée]');
    expect(m).toContain('+suite = 1');
  });

  it('un patch sans secret reste identique', () => {
    const p = '@@ -1,1 +1,2 @@\n a\n+const b = 2;\n';
    expect(masquer(p)).toBe(p);
  });
});
