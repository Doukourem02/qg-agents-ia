import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import { CLES_ACCORDS } from './accords';
import { CLE_PROPOSITIONS } from './l/posts';
import { CLES_CLARA } from './clara/stats';
import { CLES_MAFE } from './mafe/releve';
import { CLES_LUFFY } from './luffy/vigie';
import { CLES_ISAAC } from './isaac/api';
import { CLES_LIGHT } from './light/releve';
import { AGENTS_REELS } from '@/data/reels';
import { comptesRendus, marquerVisite } from './comptes-rendus';

const NOW = Date.UTC(2026, 10, 10, 10, 0);
const H = 3600_000, MIN = 60_000, GO = 1024 ** 3;
let kv: KV;
beforeEach(() => { kv = memoire(); });

const luffyVeille = () => kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - MIN));
const siteEnPanne = (id: string, depuis: number) => luffyVeille().then(() => kv.hset(CLES_LUFFY.etat, id, JSON.stringify({ echecs: 2, depuis, annoncee: true, raison: 'erreur 503 sur /health', vu: NOW })));
const panneFinie = async (nom: string, debut: number, fin: number) => { await luffyVeille(); await kv.lpush(CLES_LUFFY.pannes, JSON.stringify({ nom, debut, fin, raison: 'erreur 503' })); };
const question = (id: string) => kv.hset(CLES_CLARA.questions, id, JSON.stringify({ id, adresse: 'a@b.com', etape: 1, quand: NOW }));
const corbeille = (quand: number, n: number) =>
  kv.lpush(CLES.journal, JSON.stringify({ quand, agent: 'clara', type: 'etat', texte: 'mails mis à la corbeille', resultat: `${n} mails à la corbeille`, origine: 'agent' }));
const proposition = (id: string, taille: number, quand = NOW - H) =>
  kv.hset(CLES_ISAAC.propositions, id, JSON.stringify({ id, libelle: 'Caches /Users/x/Library', taille, impact: 'rien', quand, statut: 'proposee' }));
const mafe = (quand: number, extra = {}) =>
  kv.hset(CLES_MAFE.releves, '2026-11-10', JSON.stringify({ jour: '2026-11-10', quand, projets: [], priorite: { depot: 'm/qg', nom: 'QG', raison: 'la page est presque finie' }, aEcrire: [], ...extra }));
const light = (quand: number, vu?: number) => {
  const r = kv.hset(CLES_LIGHT.releves, '2026-11-10', JSON.stringify({ jour: '2026-11-10', quand, lignes: [], alertes: [], lectures: [], comptesNonLus: [], nomsInterdits: [], resume: 'Next.js a une nouvelle version. Rien d\'autre à signaler.' }));
  return r.then(() => kv.hset(CLES_LIGHT.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 't', cles: [], envoye: quand, ...(vu ? { vu } : {}), relances: [] })));
};
const textes = (l: { titre: string; phrases: string[] }[]) => l.flatMap(c => [c.titre, ...c.phrases]);

describe('comptesRendus', () => {
  it('Luffy endormi : aucun site affirmé en panne, une ligne douce à la place', async () => {
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 2 * H));
    await kv.hset(CLES_LUFFY.etat, 'boutique', JSON.stringify({ echecs: 2, depuis: NOW - 6 * H, annoncee: true, raison: 'x', vu: NOW - 2 * H }));
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ agent: 'luffy', urgent: false, phrases: ['Luffy ne vérifie plus tes sites.'] });
  });

  it('Luffy jamais passé : rien sur Luffy même avec un état resté en mémoire', async () => {
    await kv.hset(CLES_LUFFY.etat, 'boutique', JSON.stringify({ echecs: 2, depuis: NOW - 6 * H, annoncee: true, raison: 'x', vu: NOW }));
    expect((await comptesRendus(kv, NOW)).liste).toEqual([]);
  });

  it('rien du tout : liste vide, première visite', async () => {
    expect(await comptesRendus(kv, NOW)).toEqual({ depuis: null, now: NOW, liste: [] });
  });

  it('RF 1 : seuls les vrais agents apparaissent', async () => {
    await siteEnPanne('boutique', NOW - 6 * H); await question('q1'); await proposition('p1', 2 * GO); await mafe(NOW - H); await light(NOW - H);
    await kv.hset(CLE_PROPOSITIONS, 'p', JSON.stringify({ id: 'p', semaine: 'w', quand: NOW, sujets: [{ titre: 'a' }] }));
    await kv.hset(CLES.etats, 'zoro', JSON.stringify({ agent: 'zoro', statut: 'au travail', tache: 't', quand: NOW }));
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste.length).toBeGreaterThanOrEqual(5);
    for (const c of liste) expect(AGENTS_REELS as readonly string[]).toContain(c.agent);
  });

  it('RF 2 : après une visite, rien de nouveau (même sans rien d\'urgent)', async () => {
    await mafe(NOW - H); await light(NOW - H, NOW - 30 * MIN); await panneFinie('Portfolio', NOW - 3 * H, NOW - 2 * H); await corbeille(NOW - H, 5);
    expect((await comptesRendus(kv, NOW - 10 * MIN)).liste.length).toBeGreaterThan(0);
    await marquerVisite(kv, NOW);
    expect(await comptesRendus(kv, NOW + MIN)).toEqual({ depuis: NOW, now: NOW + MIN, liste: [] });
  });

  it('RF 3 : une panne en cours reste, même d\'avant la visite ; une panne revenue avant la visite n\'y est plus', async () => {
    await siteEnPanne('boutique', NOW - 6 * H);
    await panneFinie('Portfolio', NOW - 5 * H, NOW - 4 * H);
    await marquerVisite(kv, NOW - H);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ agent: 'luffy', urgent: true, ouvre: 'bureauLuffy' });
    expect(liste[0].phrases[0]).toMatch(/en panne depuis 6 h/);
    expect(textes(liste).join(' ')).not.toMatch(/Portfolio/);
  });

  it('Luffy : un retour depuis la visite est dit avec la durée de la panne', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await panneFinie('Portfolio', NOW - 2 * H, NOW - 2 * H + 25 * MIN);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste[0]).toMatchObject({ agent: 'luffy', urgent: false });
    expect(liste[0].phrases).toEqual(['Portfolio est revenu après 25 min de panne.']);
  });

  it('RF 4 : une source qui échoue n\'empêche pas les autres', async () => {
    await mafe(NOW - H); await question('q1');
    const casse: KV = { ...kv, hgetall: async (k) => { if (k === CLES_LUFFY.etat || k === CLES_ISAAC.place) throw new Error('panne'); return kv.hgetall(k); } };
    const { liste } = await comptesRendus(casse, NOW);
    expect(liste.map(c => c.agent).sort()).toEqual(['clara', 'mafe']);
  });

  it('ordre : urgents d\'abord (Luffy, Clara, Isaac, L), puis les autres du plus récent au plus ancien', async () => {
    await mafe(NOW - 3 * H); await light(NOW - H, NOW - 30 * MIN);
    await proposition('p1', 2 * GO); await question('q1'); await siteEnPanne('boutique', NOW - H);
    await kv.hset(CLE_PROPOSITIONS, 'p', JSON.stringify({ id: 'p', semaine: 'w', quand: NOW, sujets: [{ titre: 'a' }] }));
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste.map(c => c.agent)).toEqual(['luffy', 'clara', 'isaac', 'L', 'light', 'mafe']);
    expect(liste.map(c => c.urgent)).toEqual([true, true, true, true, false, false]);
  });

  it('première visite : tout ce qui existe ; titres ≤ 40, phrases ≤ 140, sans « 503 » ni « / »', async () => {
    await siteEnPanne('boutique', NOW - 6 * H); await panneFinie('Portfolio', NOW - 9 * H, NOW - 8 * H);
    await proposition('p1', 11 * GO); await mafe(NOW - H, { phrase: 'Commence par QG / la page — ' + 'très long '.repeat(30) }); await light(NOW - H);
    const { depuis, liste } = await comptesRendus(kv, NOW);
    expect(depuis).toBeNull();
    expect(liste.map(c => c.agent)).toEqual(expect.arrayContaining(['luffy', 'isaac', 'mafe', 'light']));
    for (const c of liste) {
      expect(c.titre.length).toBeLessThanOrEqual(40);
      expect(c.phrases.length).toBeGreaterThanOrEqual(1); expect(c.phrases.length).toBeLessThanOrEqual(3);
      for (const p of c.phrases) expect(p.length).toBeLessThanOrEqual(140);
    }
    const tout = textes(liste).join(' ');
    expect(tout).not.toMatch(/503|\/|http|Users/);
  });

  it('Clara : questions (urgent) et mails à la corbeille depuis la visite (journal)', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await question('q1'); await question('q2');
    await corbeille(NOW - 4 * H, 50); // avant la visite : ne compte pas
    await corbeille(NOW - 2 * H, 8); await corbeille(NOW - H, 6);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste[0]).toMatchObject({ agent: 'clara', urgent: true, ouvre: 'bureauClara' });
    expect(liste[0].phrases).toEqual(['2 questions sur tes mails t\'attendent.', '14 mails de tes bannis sont partis à la corbeille.']);
  });

  it('Clara : un résultat illisible dans le journal est sauté, pas deviné', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await kv.lpush(CLES.journal, JSON.stringify({ quand: NOW - H, agent: 'clara', type: 'etat', texte: 'mails mis à la corbeille', resultat: 'fait' }));
    expect((await comptesRendus(kv, NOW)).liste).toEqual([]);
  });

  it('Isaac : propositions en attente (urgent) avec la place à libérer', async () => {
    await proposition('p1', 6 * GO); await proposition('p2', 5 * GO);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste[0]).toMatchObject({ agent: 'isaac', urgent: true, ouvre: 'bureauIsaac' });
    expect(liste[0].phrases[0]).toBe('2 propositions pour libérer 11 Go t\'attendent sur Telegram.');
  });

  it('Isaac : la place libre seulement si sous 20 Go, ou s\'il a libéré depuis', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 26 * GO, quand: NOW - H }));
    expect((await comptesRendus(kv, NOW)).liste).toEqual([]);
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 12 * GO, quand: NOW - H }));
    expect((await comptesRendus(kv, NOW)).liste[0].phrases).toEqual(['Ton Mac n\'a plus que 12 Go libres.']);
  });

  it('Isaac : ce qui a été libéré depuis la visite, avec la place', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 26 * GO, quand: NOW - H }));
    await kv.hset(CLES_ISAAC.propositions, 'p9', JSON.stringify({ id: 'p9', libelle: 'Caches', taille: 4 * GO, impact: '', quand: NOW - 5 * H, statut: 'faite', libere: 4 * GO, faite: NOW - 2 * H }));
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste[0]).toMatchObject({ agent: 'isaac', urgent: false });
    expect(liste[0].phrases).toEqual(['Isaac a libéré 4 Go depuis ta dernière visite.', 'Ton Mac a 26 Go libres.']);
  });

  it('Mafe : le relevé plus récent que la visite ; sinon à défaut de phrase, la priorité', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await mafe(NOW - 4 * H);
    expect((await comptesRendus(kv, NOW)).liste).toEqual([]);
    await mafe(NOW - H);
    expect((await comptesRendus(kv, NOW)).liste[0]).toMatchObject({ agent: 'mafe', urgent: false, ouvre: 'bureauMafe', phrases: ['Commence par QG — la page est presque finie.'] });
    await mafe(NOW - H, { phrase: 'Tout est calme sur tes projets.' });
    expect((await comptesRendus(kv, NOW)).liste[0].phrases).toEqual(['Tout est calme sur tes projets.']);
  });

  it('Light : résumé du relevé récent ; urgent s\'il n\'a pas été vu', async () => {
    await marquerVisite(kv, NOW - 3 * H);
    await light(NOW - H);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste[0]).toMatchObject({ agent: 'light', urgent: true, ouvre: 'releveLight' });
    expect(liste[0].phrases).toEqual(['Next.js a une nouvelle version.', 'Rien d\'autre à signaler.']);
    await light(NOW - H, NOW - 30 * MIN);
    expect((await comptesRendus(kv, NOW)).liste[0].urgent).toBe(false);
  });

  it('L : brouillon à valider et sujet à choisir (urgents) ; rien d\'autre', async () => {
    await kv.hset(CLES_ACCORDS.tous, 'a1', JSON.stringify({ id: 'a1', agent: 'L', action: 'x', resume: 'y', statut: 'en attente', demande: NOW }));
    await kv.lpush(CLES_ACCORDS.attente, 'a1');
    await kv.hset(CLE_PROPOSITIONS, 'p', JSON.stringify({ id: 'p', semaine: 'w', quand: NOW - 2 * H, sujets: [{ titre: 'a' }, { titre: 'b' }] }));
    await marquerVisite(kv, NOW - H);
    const { liste } = await comptesRendus(kv, NOW);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ agent: 'L', urgent: true, ouvre: 'bureauL' });
    expect(liste[0].phrases).toEqual(['Un brouillon attend ton accord.', '2 sujets de post attendent ton choix.']);
  });

  it('une visite notée « jusqu\'à » l\'heure de la liste vue : un relevé arrivé entre le GET et le POST reste', async () => {
    const { now } = await comptesRendus(kv, NOW);
    await mafe(NOW + 2 * MIN); // arrive après la liste vue
    await marquerVisite(kv, NOW + 5 * MIN, now);
    expect((await comptesRendus(kv, NOW + 6 * MIN)).liste.map(c => c.agent)).toEqual(['mafe']);
    await marquerVisite(kv, NOW + 5 * MIN, NOW + 99 * MIN); // jamais dans le futur
    expect((await comptesRendus(kv, NOW + 6 * MIN)).depuis).toBe(NOW + 5 * MIN);
  });
});
