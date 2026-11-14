import { describe, it, expect } from 'vitest';
import { OUTILS_SUIVIS, ecartMajeur, lireManifeste, serieMajeure, versionMin, type Version } from './versions';

const v = (a: number, b: number, c: number): Version => ({ brut: `${a}.${b}.${c}`, parties: [a, b, c] });

describe('versionMin', () => {
  it('prend la plus basse version permise par la plage', () => {
    expect(versionMin('^55.0.12')?.parties).toEqual([55, 0, 12]);
    expect(versionMin('~58.0.14')?.parties).toEqual([58, 0, 14]);
    expect(versionMin('>=5')?.parties).toEqual([5, 0, 0]);
    expect(versionMin('5.9.3')?.parties).toEqual([5, 9, 3]);
    expect(versionMin('^4')?.parties).toEqual([4, 0, 0]);
  });
  it('donne le brut normalisé x.y.z', () => {
    expect(versionMin('^4')?.brut).toBe('4.0.0');
    expect(versionMin('^20.1')?.brut).toBe('20.1.0');
  });
  it('lit la première alternative et ignore un v initial et les espaces', () => {
    expect(versionMin('^20 || ^22')?.parties).toEqual([20, 0, 0]);
    expect(versionMin('v22.11.0\n')?.parties).toEqual([22, 11, 0]);
    expect(versionMin('>= 18.2.0')?.parties).toEqual([18, 2, 0]);
  });
  it('rend null pour une plage illisible', () => {
    for (const p of ['workspace:*', 'latest', '*', 'github:a/b', 'file:../x', '', '<5', 'lts/*']) {
      expect(versionMin(p)).toBeNull();
    }
  });
});

describe('serieMajeure', () => {
  it('garde le majeur hors série 0, sinon la série 0.x', () => {
    expect(serieMajeure(v(55, 0, 12))).toBe('55');
    expect(serieMajeure(v(0, 83, 4))).toBe('0.83');
    expect(serieMajeure(v(0, 0, 7))).toBe('0.0.7');
  });
});

describe('ecartMajeur', () => {
  it('compte les majeurs écartés', () => {
    expect(ecartMajeur(v(55, 0, 0), v(58, 0, 19))).toBe(3);
    expect(ecartMajeur(v(0, 83, 4), v(0, 88, 0))).toBe(5);
    expect(ecartMajeur(v(0, 45, 4), v(0, 46, 0))).toBe(1);
    expect(ecartMajeur(v(16, 4, 3), v(16, 5, 0))).toBe(0);
  });
  it('compte au moins 1 entre séries différentes', () => {
    expect(ecartMajeur(v(0, 88, 0), v(1, 0, 0))).toBeGreaterThanOrEqual(1);
  });
  it('ne rend jamais un nombre négatif', () => {
    expect(ecartMajeur(v(17, 0, 0), v(16, 0, 0))).toBe(0);
  });
});

describe('OUTILS_SUIVIS', () => {
  it('contient la liste exacte des outils suivis', () => {
    expect([...OUTILS_SUIVIS]).toEqual([
      'next', 'react', 'react-native', 'expo', 'expo-router', 'typescript', 'tailwindcss', 'prisma', '@prisma/client',
      'drizzle-orm', 'payload', 'sanity', '@supabase/supabase-js', '@clerk/nextjs', 'better-auth', 'express', 'fastify',
      'socket.io', 'three', 'zustand', '@tanstack/react-query', 'wxt', '@upstash/redis',
    ]);
  });
});

describe('lireManifeste', () => {
  it('lit le nom, les outils suivis et Node depuis engines, sans les autres paquets', () => {
    const r = lireManifeste('{"name":"terra","dependencies":{"expo":"~58.0.14","lodash":"^4"},"devDependencies":{"typescript":"~6.0.3"},"engines":{"node":">=20"}}');
    expect(r.nom).toBe('terra');
    expect(r.usages).toEqual([
      { paquet: 'expo', version: v(58, 0, 14) },
      { paquet: 'typescript', version: v(6, 0, 3) },
      { paquet: 'node', version: v(20, 0, 0) },
    ]);
  });
  it('lit Node depuis le .nvmrc', () => {
    expect(lireManifeste('{}', { nvmrc: 'v22.11.0\n' }).usages).toEqual([{ paquet: 'node', version: v(22, 11, 0) }]);
  });
  it('privilégie le .nvmrc sur engines.node et garde une seule entrée node', () => {
    const r = lireManifeste('{"engines":{"node":">=20"}}', { nvmrc: '22.11.0' });
    expect(r.usages).toEqual([{ paquet: 'node', version: v(22, 11, 0) }]);
  });
  it('ignore une plage illisible pour un outil suivi', () => {
    expect(lireManifeste('{"dependencies":{"next":"workspace:*"}}').usages).toEqual([]);
  });
  it('JSON invalide → aucun usage', () => {
    expect(lireManifeste('pas du json')).toEqual({ usages: [] });
  });
});
