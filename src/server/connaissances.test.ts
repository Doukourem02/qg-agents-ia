import { describe, expect, it } from 'vitest';
import { memoire } from './memoire';
import FICHIER from '@/data/connaissances.json';
import { AGENTS } from '@/sim/routing';
import { CLE_CONNAISSANCES, CONNAISSANCES_DEPOT, MAX_CONNAISSANCES, connaissancesValides, enregistrerConnaissances, lireConnaissances } from './connaissances';

const copie = () => JSON.parse(JSON.stringify(FICHIER)) as { projet: Record<string, unknown>; personnages: Record<string, unknown>[] };
const avec = (id: string, champ: string, valeur: unknown) => {
  const c = copie();
  c.personnages.find(p => p.id === id)![champ] = valeur;
  return c;
};

describe('connaissances : le fichier du dépôt', () => {
  it('est valide, compact (≤ 6 000 caractères) et couvre les 17 personnages', () => {
    expect(JSON.stringify(CONNAISSANCES_DEPOT).length).toBeLessThanOrEqual(6_000);
    expect(CONNAISSANCES_DEPOT.personnages.map(p => p.id).sort()).toEqual(AGENTS.map(a => a.id).sort());
    expect(JSON.stringify(CONNAISSANCES_DEPOT)).not.toMatch(/https?:|www\.|@/);
  });
  it('dit les vérités clés : qui fait les missions et quand, pas de post LinkedIn, Light pour L', () => {
    const t = JSON.stringify(CONNAISSANCES_DEPOT);
    expect(t).toContain('agissent tout de suite');
    expect(t).toContain('au passage « QG · missions » (chaque heure, 8 h-20 h)');
    expect(t).not.toContain('Seul Isaac lit vraiment');
    expect(t).toContain('L rédige de nouveau ses brouillons');
    expect(CONNAISSANCES_DEPOT.personnages.find(p => p.id === 'light')!.clin).toContain('pour L');
  });
  it('Telegram : accords, alertes, compte rendu du matin, réunions de crise ; Kuroro y parle, et connaît les commandes', () => {
    const t = (CONNAISSANCES_DEPOT.projet as Record<string, unknown>).telegram;
    expect(t).toBe('Le bot « QG accords » : accords (Oui/Non), alertes urgentes, compte rendu du matin (08:15), réunions de crise. Le patron y parle à Kuroro ; le code lit « ignore Livreo » (connu : plus d\'alerte tant que rien ne change), « reprends Livreo », « pas d\'alertes pendant 2 h », « reprends les alertes », « vérifie mes sites », « mets Ye en pause ».');
    expect(CONNAISSANCES_DEPOT.personnages.find(p => p.id === 'kuroro')!.routine).toContain('Telegram');
  });
});

describe('connaissances : la vérité sur les agents réels', () => {
  const perso = (id: string) => CONSIGNES_PERSO.find(p => p.id === id)!;
  const CONSIGNES_PERSO = CONNAISSANCES_DEPOT.personnages;
  it('Zoro, Léa, Paul et Ye sont réels', () => {
    expect(perso('zoro').statut).toBe('Réel depuis le 11 novembre.');
    expect(perso('lea').statut).toBe('Réelle depuis le 11 novembre.');
    expect(perso('paul').statut).toBe('Réel depuis le 12 novembre.');
    expect(perso('paul').interdit).toContain('Écrire sans mon Valider');
    expect(perso('ye').statut).toBe('Réelle depuis le 12 novembre.');
    expect(perso('ye').interdit).toContain('Publier sans mon Valider');
    expect(perso('ye').interdit).toContain('ajouter une compétence');
    expect(perso('feu').interdit).toContain('Passer un ordre');
    expect(perso('feu').statut).toContain('pas encore en service');
    const phases = JSON.stringify(CONNAISSANCES_DEPOT.projet);
    expect(phases).toContain('Zoro, Léa, Paul et Ye sont réels');
    expect(phases).not.toContain('mise en service');
    expect(phases).not.toContain('Ye à venir');
    expect(phases).not.toMatch(/Zoro, Léa, Paul, Ye à venir/);
  });
});

describe('connaissancesValides', () => {
  it('refuse une forme fausse', () => {
    expect(() => connaissancesValides(null)).toThrow();
    expect(() => connaissancesValides({ personnages: [] })).toThrow(/projet/);
    expect(() => connaissancesValides({ ...copie(), personnages: {} })).toThrow(/personnages/);
    expect(() => connaissancesValides(avec('light', 'role', ''))).toThrow(/light\.role/);
    expect(() => connaissancesValides(avec('light', 'humeur', 'x'))).toThrow(/champ inconnu/);
    expect(() => connaissancesValides({ ...copie(), projet: { 'Mauvaise clé': 'x' } })).toThrow(/rubrique/);
  });
  it('exige les 17 personnages, une seule fois chacun, et aucun inconnu', () => {
    const c = copie();
    expect(() => connaissancesValides({ ...c, personnages: c.personnages.slice(1) })).toThrow(/manquants : kuroro/);
    expect(() => connaissancesValides({ ...c, personnages: [...c.personnages, c.personnages[0]] })).toThrow(/double/);
    expect(() => connaissancesValides({ ...c, personnages: [...c.personnages, { id: 'goku', nom: 'Goku', statut: 'x', role: 'x' }] })).toThrow(/inconnu/);
  });
  it('refuse adresses web, mails et numéros de téléphone', () => {
    expect(() => connaissancesValides(avec('clara', 'fait', 'Voir https://exemple.org'))).toThrow(/adresse web/);
    expect(() => connaissancesValides(avec('clara', 'fait', 'Voir mon-qg.vercel.app'))).toThrow(/adresse web/);
    expect(() => connaissancesValides(avec('clara', 'fait', 'Écrire à moi@exemple.ci'))).toThrow(/mail/);
    expect(() => connaissancesValides(avec('clara', 'fait', 'Appeler le +225 07 07 07 07 07'))).toThrow(/numéro/);
    expect(() => connaissancesValides({ ...copie(), projet: { quoi: ['ok', 'www.exemple'] } })).toThrow(/adresse web/);
    // un chiffre ordinaire passe
    expect(connaissancesValides(avec('clara', 'fait', '15 084 mails à la corbeille')).personnages.find(p => p.id === 'clara')!.fait).toBe('15 084 mails à la corbeille');
  });
  it(`refuse plus de ${MAX_CONNAISSANCES} caractères, et un champ trop long`, () => {
    expect(() => connaissancesValides(avec('L', 'fait', 'a'.repeat(401)))).toThrow(/trop long/);
    const c = copie();
    for (const p of c.personnages) for (const k of ['fait', 'routine', 'parler', 'interdit', 'ou']) p[k] = 'mot '.repeat(80).trim();
    expect(() => connaissancesValides(c)).toThrow(/trop long : \d+ caractères/);
  });
  it('nettoie les espaces', () => {
    expect(connaissancesValides(avec('L', 'fait', '  deux   espaces  ')).personnages.find(p => p.id === 'L')!.fait).toBe('deux espaces');
  });
});

describe('lireConnaissances : KV d’abord, sinon le dépôt', () => {
  it('sans rien dans KV : le dépôt', async () => {
    expect(await lireConnaissances(memoire())).toBe(CONNAISSANCES_DEPOT);
  });
  it('après un envoi : la version de KV', async () => {
    const kv = memoire();
    const r = await enregistrerConnaissances(kv, avec('light', 'statut', 'Réel, version fraîche.'));
    expect(r).toMatchObject({ ok: true, personnages: 17 });
    expect((await lireConnaissances(kv)).personnages.find(p => p.id === 'light')!.statut).toBe('Réel, version fraîche.');
  });
  it('un envoi refusé ne touche pas à la version en place', async () => {
    const kv = memoire();
    await expect(enregistrerConnaissances(kv, avec('light', 'fait', 'https://x.org'))).rejects.toThrow();
    expect(await lireConnaissances(kv)).toBe(CONNAISSANCES_DEPOT);
  });
  it('une version KV abîmée : le dépôt', async () => {
    const kv = memoire();
    await kv.hset(CLE_CONNAISSANCES, 'json', '{pas du json');
    expect(await lireConnaissances(kv)).toBe(CONNAISSANCES_DEPOT);
    await kv.hset(CLE_CONNAISSANCES, 'json', JSON.stringify({ projet: {}, personnages: [] }));
    expect(await lireConnaissances(kv)).toBe(CONNAISSANCES_DEPOT);
  });
});
