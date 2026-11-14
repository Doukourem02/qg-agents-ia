import { describe, expect, it, vi } from 'vitest';
import { chercherFailles, comparerVersions, graviteOSV, scoreCVSS3 } from './osv';
import type { Dependance } from './types';

const dep = (nom: string, version: string, directeProd = true, ecosysteme: 'npm' | 'PyPI' = 'npm'): Dependance => ({ nom, version, ecosysteme, directeProd });
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

/** Faux OSV : lots, détails par id, et page suivante éventuelle. */
function fauxOSV(opts: { lots?: (q: { package: { name: string }; version: string }[]) => unknown[]; details: Record<string, unknown>; pages?: Record<string, unknown> }) {
  const appels: string[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    appels.push(u);
    const corps = init?.body ? JSON.parse(String(init.body)) : null;
    if (u.endsWith('/v1/querybatch')) return json({ results: opts.lots!(corps.queries) });
    if (u.endsWith('/v1/query')) return json(opts.pages![corps.page_token ?? 'p0']);
    const m = /\/v1\/vulns\/(.+)$/.exec(u);
    if (m && opts.details[decodeURIComponent(m[1])]) return json(opts.details[decodeURIComponent(m[1])]);
    return new Response('', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, appels, brut: f };
}

const vulnA = {
  id: 'GHSA-aaaa', summary: 'x'.repeat(200), database_specific: { severity: 'HIGH' },
  affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }, { introduced: '5.0.0' }, { fixed: '5.1.0' }] }] }],
};

describe('graviteOSV', () => {
  it('gravité : database_specific.severity, sinon score CVSS, sinon moyenne', () => {
    expect(graviteOSV({ database_specific: { severity: 'HIGH' } })).toBe('haute');
    expect(graviteOSV({ database_specific: { severity: 'MODERATE' } })).toBe('moyenne');
    expect(graviteOSV({ database_specific: { severity: 'MEDIUM' } })).toBe('moyenne');
    expect(graviteOSV({ database_specific: { severity: 'LOW' } })).toBe('basse');
    expect(graviteOSV({ database_specific: { severity: 'CRITICAL' } })).toBe('critique');
    expect(graviteOSV({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toBe('critique');
    expect(graviteOSV({ severity: [{ type: 'CVSS_V3', score: '7.5' }] })).toBe('haute');
    expect(graviteOSV({ severity: [{ type: 'CVSS_V3', score: '4.0' }] })).toBe('moyenne');
    expect(graviteOSV({ severity: [{ type: 'CVSS_V3', score: '2.1' }] })).toBe('basse');
    expect(graviteOSV({})).toBe('moyenne');
    expect(graviteOSV(null)).toBe('moyenne');
    expect(graviteOSV({ severity: [{ type: 'CVSS_V3', score: 'n’importe quoi' }] })).toBe('moyenne');
  });
});

describe('scoreCVSS3', () => {
  it('formule officielle 3.1', () => {
    expect(scoreCVSS3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(scoreCVSS3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
    expect(scoreCVSS3('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1);
    expect(scoreCVSS3('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N')).toBe(5.5);
    expect(scoreCVSS3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
    expect(scoreCVSS3('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
  });
  it('vecteur incomplet ou inconnu → null', () => {
    expect(scoreCVSS3('CVSS:3.1/AV:N')).toBeNull();
    expect(scoreCVSS3('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeNull();
    expect(scoreCVSS3('')).toBeNull();
  });
});

describe('comparerVersions', () => {
  it('compare segment par segment, numériquement', () => {
    expect(comparerVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(comparerVersions('1.0', '1.0.0')).toBe(0);
    expect(comparerVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(comparerVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(comparerVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(comparerVersions('2.31.0', '2.4')).toBeGreaterThan(0);
  });
});

describe('chercherFailles', () => {
  it('une requête groupée, puis le détail une fois par id', async () => {
    const o = fauxOSV({
      lots: () => [{ vulns: [{ id: 'GHSA-aaaa' }] }, { vulns: [{ id: 'GHSA-aaaa' }] }, {}],
      details: { 'GHSA-aaaa': vulnA },
    });
    const r = await chercherFailles([dep('lodash', '4.17.0'), dep('lodash', '4.0.0', false), dep('ok', '1.0.0')], o.f);
    expect(o.appels.filter((u) => u.endsWith('/v1/querybatch'))).toHaveLength(1);
    expect(o.appels.filter((u) => u.includes('/v1/vulns/'))).toHaveLength(1);
    expect(r).toHaveLength(2);
  });

  it('lots de 1000 au plus', async () => {
    const deps = Array.from({ length: 2500 }, (_, i) => dep(`p${i}`, '1.0.0'));
    const o = fauxOSV({ lots: (q) => q.map(() => ({})), details: {} });
    expect(await chercherFailles(deps, o.f)).toEqual([]);
    expect(o.appels.filter((u) => u.endsWith('/v1/querybatch'))).toHaveLength(3);
  });

  it('une faille par (paquet, version, id) ; directeProd recopié ; résumé tronqué à 120 ; corrigeeEn = plus petite fixed supérieure', async () => {
    const o = fauxOSV({
      lots: () => [{ vulns: [{ id: 'GHSA-aaaa' }] }, { vulns: [{ id: 'GHSA-aaaa' }] }],
      details: { 'GHSA-aaaa': vulnA },
    });
    const r = await chercherFailles([dep('lodash', '4.17.0', true), dep('lodash', '5.0.1', false)], o.f);
    expect(r).toEqual([
      { id: 'GHSA-aaaa', paquet: 'lodash', version: '4.17.0', gravite: 'haute', corrigeeEn: '4.17.21', directeProd: true, resume: 'x'.repeat(120) },
      { id: 'GHSA-aaaa', paquet: 'lodash', version: '5.0.1', gravite: 'haute', corrigeeEn: '5.1.0', directeProd: false, resume: 'x'.repeat(120) },
    ]);
  });

  it('corrigeeEn null si aucune version corrigée supérieure', async () => {
    const o = fauxOSV({ lots: () => [{ vulns: [{ id: 'GHSA-aaaa' }] }], details: { 'GHSA-aaaa': vulnA } });
    const r = await chercherFailles([dep('lodash', '9.0.0')], o.f);
    expect(r?.[0].corrigeeEn).toBeNull();
  });

  it('corrigeeEn ignore les plages GIT (hash de commit), garde SEMVER/ECOSYSTEM', async () => {
    const aff = (ranges: unknown[]) => ({ id: 'PYSEC-1', affected: [{ package: { name: 'requests', ecosystem: 'PyPI' }, ranges }] });
    const git = { type: 'GIT', events: [{ introduced: '0' }, { fixed: '5f3a9c1d2e' }] };
    const eco = { type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '2.31.1' }] };
    const o = fauxOSV({ lots: () => [{ vulns: [{ id: 'PYSEC-1' }] }], details: { 'PYSEC-1': aff([git, eco]) } });
    const r = await chercherFailles([dep('requests', '2.0.0', true, 'PyPI')], o.f);
    expect(r?.[0].corrigeeEn).toBe('2.31.1');
    const o2 = fauxOSV({ lots: () => [{ vulns: [{ id: 'PYSEC-1' }] }], details: { 'PYSEC-1': aff([git]) } });
    const r2 = await chercherFailles([dep('requests', '2.0.0', true, 'PyPI')], o2.f);
    expect(r2?.[0].corrigeeEn).toBeNull();
  });

  it('page suivante : les failles supplémentaires sont lues', async () => {
    const o = fauxOSV({
      lots: () => [{ vulns: [{ id: 'GHSA-aaaa' }], next_page_token: 'p1' }],
      pages: { p1: { vulns: [{ id: 'GHSA-bbbb' }] } },
      details: { 'GHSA-aaaa': vulnA, 'GHSA-bbbb': { ...vulnA, id: 'GHSA-bbbb' } },
    });
    const r = await chercherFailles([dep('lodash', '4.17.0')], o.f);
    expect(r?.map((x) => x.id).sort()).toEqual(['GHSA-aaaa', 'GHSA-bbbb']);
  });

  it('OSV en 5xx ou détail illisible → null (jamais [])', async () => {
    expect(await chercherFailles([dep('a', '1.0.0')], async () => new Response('', { status: 503 }))).toBeNull();
    const o = fauxOSV({ lots: () => [{ vulns: [{ id: 'X' }] }], details: {} });
    expect(await chercherFailles([dep('a', '1.0.0')], o.f)).toBeNull();
    expect(await chercherFailles([dep('a', '1.0.0')], async () => { throw new Error('réseau'); })).toBeNull();
  });

  it('réponse de lot de mauvaise taille → null', async () => {
    const o = fauxOSV({ lots: () => [], details: {} });
    expect(await chercherFailles([dep('a', '1.0.0')], o.f)).toBeNull();
  });

  it('échéance déjà passée → null sans appel ; délai dépassé → null', async () => {
    const f = vi.fn();
    const c = new AbortController();
    c.abort();
    expect(await chercherFailles([dep('a', '1.0.0')], f as unknown as typeof fetch, c.signal)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    const lent = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('coupé', 'TimeoutError')));
    })) as unknown as typeof fetch;
    const c2 = new AbortController();
    setTimeout(() => c2.abort(), 20);
    expect(await chercherFailles([dep('a', '1.0.0')], lent, c2.signal)).toBeNull();
  });

  it('aucune dépendance → [] sans appel réseau', async () => {
    const f = vi.fn();
    expect(await chercherFailles([], f as unknown as typeof fetch)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
