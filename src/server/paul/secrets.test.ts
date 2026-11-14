import { describe, expect, it } from 'vitest';
import { contientSecret, masquerPaul } from './secrets';
import { masquer, reperer } from '../lea/cles';

const MDP = 'mot' + 'de' + 'passe' + '42';
const CLE = 'abcd' + '1234efgh' + '5678';

describe('les secrets génériques (Paul)', () => {
  it('adresse avec identifiants et affectation à vraie valeur : masquées et repérées', () => {
    expect(masquerPaul(`DATABASE_URL=postgres://moi:${MDP}@db.exemple:5432/x`)).toBe('DATABASE_URL=postgres://moi:[mot de passe masqué]@db.exemple:5432/x');
    expect(masquerPaul(`- \`OPENAI_API_KEY=${CLE}\``)).toBe('- `OPENAI_API_KEY=[secret masqué]`');
    expect(masquerPaul(`STRIPE_SECRET: "${CLE}"`)).toBe('STRIPE_SECRET: "[secret masqué]"');
    expect(contientSecret(`OPENAI_API_KEY=${CLE}`)).toBe(true);
    expect(contientSecret(`postgres://moi:${MDP}@hote`)).toBe(true);
  });
  it('valeurs factices, références et noms seuls : laissés tels quels', () => {
    for (const t of ['OPENAI_API_KEY=your_key_here', 'API_KEY=<ta clé>', 'API_KEY=$API_KEY', 'API_KEY=process.env.X', 'API_KEY=xxxxxxxx', 'Ajoute `OPENAI_API_KEY` dans Vercel.', 'TOKEN=abc', 'postgres://moi:<mdp>@hote']) {
      expect(masquerPaul(t)).toBe(t);
      expect(contientSecret(t)).toBe(false);
    }
  });
  it('de la prose ou du YAML ne sont pas des secrets', () => {
    for (const t of ['- ANTHROPIC_API_KEY : nécessaire pour Claude', 'GITHUB_TOKEN:\n  description: le jeton de lecture', 'STRIPE_SECRET = obligatoire', 'DB_PASSWORD: required']) {
      expect(masquerPaul(t)).toBe(t);
      expect(contientSecret(t)).toBe(false);
    }
    expect(contientSecret('DB_PASSWORD=Sup3rS3cret')).toBe(true);
  });
  it('masquer deux fois ne change plus rien ; le repérage de Léa reste le même', () => {
    const une = masquerPaul(`A_TOKEN=${CLE}\npostgres://u:${MDP}@h`);
    expect(masquerPaul(une)).toBe(une);
    // Léa : hors d'un .env, une affectation n'est ni repérée ni masquée (son comportement ne change pas)
    expect(reperer('src/a.ts', `@@ -0,0 +1 @@\n+OPENAI_API_KEY=${CLE}`)).toEqual([]);
    expect(masquer(`@@ -0,0 +1 @@\n+OPENAI_API_KEY=${CLE}`)).toContain(CLE);
  });
  it('rapide sur une très longue ligne sans espace (pas de temps quadratique)', () => {
    const t0 = performance.now();
    masquerPaul('x'.repeat(200_000) + '\n' + 'a'.repeat(100_000) + '://');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
