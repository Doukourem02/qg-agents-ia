import { describe, expect, it, vi } from 'vitest';
import { memoire } from '../memoire';
import { consommerEtat, enregistrerConnexion, lireConnexion, nouvelEtat, statutLinkedIn, traiterRetour } from './connexion';

const JOUR = 24 * 3600 * 1000;
const T0 = 1_800_000_000_000;
const c = { jeton: 'JETON-SECRET-123', expireDans: 60 * 24 * 3600, auteur: 'urn:li:person:abc', nom: 'Moi' };

describe('état', () => {
  it('se consomme une fois', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    expect(e).toMatch(/^[0-9a-f]{32}$/);
    expect(await consommerEtat(kv, e, T0 + 1000)).toBe(true);
    expect(await consommerEtat(kv, e, T0 + 2000)).toBe(false);
  });
  it('inconnu ou trop vieux : refusé', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    expect(await consommerEtat(kv, 'a'.repeat(32), T0)).toBe(false);
    expect(await consommerEtat(kv, e, T0 + 11 * 60 * 1000)).toBe(false);
  });
  it('une clé par état, qui s’efface seule après 10 minutes', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const kv = memoire(); const e = await nouvelEtat(kv, T0);
      expect(await kv.get(`linkedin:etat:${e}`)).toBe(String(T0));
      expect(await kv.hgetall('linkedin:etats')).toEqual({});
      vi.setSystemTime(T0 + 601 * 1000);
      expect(await kv.get(`linkedin:etat:${e}`)).toBeNull();
      expect(await consommerEtat(kv, e, T0 + 1000)).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('deux retours simultanés : un seul gagne', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    const r = await Promise.all([consommerEtat(kv, e, T0 + 1), consommerEtat(kv, e, T0 + 1)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});

describe('connexion chiffrée', () => {
  it('relit avec le bon secret, jamais en clair', async () => {
    const kv = memoire(); await enregistrerConnexion(kv, c, 's1', T0);
    expect(JSON.stringify(await kv.hgetall('linkedin:connexion'))).not.toContain(c.jeton);
    expect((await lireConnexion(kv, 's1', T0 + 1000))?.jeton).toBe(c.jeton);
    expect(await lireConnexion(kv, 's2', T0 + 1000)).toBeNull();
    expect(await lireConnexion(kv, undefined, T0 + 1000)).toBeNull();
    expect(await lireConnexion(kv, 's1', T0 + 61 * JOUR)).toBeNull();
  });
  it('statut', async () => {
    const kv = memoire();
    expect(await statutLinkedIn(kv, T0)).toEqual({ connecte: false });
    await enregistrerConnexion(kv, c, 's1', T0);
    expect(await statutLinkedIn(kv, T0)).toMatchObject({ connecte: true, joursRestants: 60, nom: 'Moi' });
    expect(await statutLinkedIn(kv, T0 + 61 * JOUR)).toMatchObject({ connecte: false, nom: 'Moi' });
  });
});

describe('traiterRetour', () => {
  const mk = () => ({
    clientId: 'id', secret: 's1',
    echanger: vi.fn(async () => ({ jeton: c.jeton, expireDans: c.expireDans })),
    profil: vi.fn(async () => ({ auteur: c.auteur, nom: c.nom })),
  });
  it('erreur ou état inconnu : pas d\'appel', async () => {
    const kv = memoire(), d = mk();
    expect((await traiterRetour(kv, { error: 'access_denied', state: 'x', code: 'c' }, d, T0)).ok).toBe(false);
    expect((await traiterRetour(kv, { code: 'c', state: 'a'.repeat(32) }, d, T0)).ok).toBe(false);
    expect(d.echanger).not.toHaveBeenCalled();
  });
  it('enregistre, et refuse un état rejoué', async () => {
    const kv = memoire(), d = mk(), e = await nouvelEtat(kv, T0);
    const r = await traiterRetour(kv, { code: 'c', state: e }, d, T0 + 1000);
    expect(r.ok).toBe(true);
    expect((await lireConnexion(kv, 's1', T0 + 2000))?.auteur).toBe(c.auteur);
    expect((await traiterRetour(kv, { code: 'c', state: e }, d, T0 + 3000)).ok).toBe(false);
  });
  it('échec de l\'échange ou du profil : raison courte, sans détail', async () => {
    for (const casse of ['echanger', 'profil'] as const) {
      const kv = memoire(), d = mk(), e = await nouvelEtat(kv, T0);
      d[casse].mockRejectedValue(new Error('corps brut JETON-SECRET-123'));
      const r = await traiterRetour(kv, { code: 'c', state: e }, d, T0);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain('JETON-SECRET');
      expect(await lireConnexion(kv, 's1', T0)).toBeNull();
    }
  });
});

describe('traiterRetour : le code d\'erreur de LinkedIn', () => {
  it('le montre, nettoyé, sans rien d\'autre', async () => {
    const r = await traiterRetour(memoire(), { error: 'unauthorized_scope_error<script>' }, {
      clientId: 'c', secret: 's', echanger: async () => { throw new Error('non'); }, profil: async () => { throw new Error('non'); },
    });
    expect(r).toEqual({ ok: false, raison: 'LinkedIn a refusé ou annulé la connexion (unauthorized_scope_errorscript)' });
  });
});
