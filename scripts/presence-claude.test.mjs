import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { construireRequete, nomDuProjet, URL_PRESENCE } from './presence-claude.mjs';

describe('nomDuProjet', () => {
  it.each([
    ['/Users/m/Desktop/Code/QG-agents-IA/qg', 'QG'], ['/x/PROJET_TERRA', 'Terra'], ['/x/mon_portfolio/', 'Portfolio'],
    ['/x/app_livraison', 'Livreo'], ['/x/boutique-shop', 'Boutique Shop'], ['/x/BotTrading', 'Trading'], ['/x/APP_PRO', 'App Pro'],
    ['/x/autre-dossier', 'autre-dossier'], ['/x/constructor', 'constructor'],
  ])('%s → %s', (dossier, nom) => expect(nomDuProjet(dossier)).toBe(nom));
});

describe('construireRequete', () => {
  it('actif : POST de la présence avec le projet et le laissez-passer', () => {
    const { url, init } = construireRequete('actif', 'QG', 'secret');
    expect(url).toBe(URL_PRESENCE);
    expect(url).toBe('https://mon-qg.vercel.app/api/agents/presence');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-vercel-protection-bypass': 'secret' });
    expect(JSON.parse(init.body)).toEqual({ agent: 'stalker', actif: true, projet: 'QG' });
  });
  it('fin : actif faux, sans projet', () => {
    expect(JSON.parse(construireRequete('fin', 'QG', 's').init.body)).toEqual({ agent: 'stalker', actif: false });
  });
  it('une autre commande : rien', () => {
    expect(construireRequete('zzz', 'QG', 's')).toBeNull();
    expect(construireRequete(undefined, 'QG', 's')).toBeNull();
  });
  it('le script ne montre jamais rien (ni laissez-passer, ni erreur) et sort toujours à 0', () => {
    const src = readFileSync(new URL('./presence-claude.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/console\.|process\.std(out|err)\.write|writeFile/);
    expect(src).toContain("process.exit(0)");
    expect(src).toContain('AbortSignal.timeout(DELAI_MS)');
  });
});
