import { describe, expect, it } from 'vitest';
import { agentsNommes, annonce, estQuestion, finPauseAgent, lireActionsImmediates } from './actions-immediates';

// Jeudi 12 novembre 2026, 15:00 (Abidjan = UTC).
const T = Date.UTC(2026, 10, 12, 15, 0);
const LUNDI_16 = Date.UTC(2026, 10, 16);
const types = (t: string) => lireActionsImmediates(t, T).map(a => a.type);

describe('les actions immédiates : reconnues par le code', () => {
  it('Luffy : vérifier les sites, de plusieurs façons', () => {
    for (const t of ['vérifie mes sites', 'Vérifie les sites maintenant', 'Luffy, revérifie tout', 'check les sites stp', 'tu peux vérifier mes sites ?',
      'salut Kuroro, regarde si mes sites sont en ligne', 'refais une vérif des sites', 'relance Luffy']) {
      expect(types(t), t).toEqual(['luffy-verifier']);
    }
  });
  it('Zoro : refaire le tour de sécurité', () => {
    for (const t of ['refais le tour de sécurité', 'Zoro, refais le tour', 'vérifie la sécurité maintenant', 'lance Zoro', 'regarde les failles']) {
      expect(types(t), t).toEqual(['zoro-verifier']);
    }
    expect(types('vérifie les sites et la sécurité')).toEqual(['luffy-verifier', 'zoro-verifier']);
  });
  it('une question, une négation ou un autre travail ne sont jamais des actions', () => {
    for (const t of ['mes sites sont en ligne ?', 'est-ce que Luffy a vérifié les sites ?', 'pourquoi Luffy vérifie les sites ?', 'Luffy a vérifié les sites ?',
      'quand Zoro refait le tour de sécurité ?', 'ne vérifie pas les sites', 'pas besoin de vérifier les sites', 'ajoute un site à Luffy',
      'écris un post sur la sécurité', 'Luffy fais attention', 'vérifie mes mails', 'Ye regarde la fiche du site portfolio', 'salut', '']) {
      expect(types(t), t).toEqual([]);
    }
  });
  it('mettre un vrai agent en pause, avec ou sans durée', () => {
    expect(lireActionsImmediates('mets Ye en pause cette semaine', T)).toEqual([{ type: 'pause-agent', agent: 'ye', jusqua: LUNDI_16 }]);
    expect(lireActionsImmediates('Mets Paul en pause jusqu’à lundi', T)).toEqual([{ type: 'pause-agent', agent: 'paul', jusqua: LUNDI_16 }]);
    expect(lireActionsImmediates('suspends Clara pendant 2 jours', T)).toEqual([{ type: 'pause-agent', agent: 'clara', jusqua: T + 2 * 86_400_000 }]);
    expect(lireActionsImmediates('mets L en pause', T)).toEqual([{ type: 'pause-agent', agent: 'L', jusqua: null }]);
    expect(lireActionsImmediates('pause Léa aujourd’hui', T)).toEqual([{ type: 'pause-agent', agent: 'lea', jusqua: Date.UTC(2026, 10, 13) }]);
  });
  it('reprendre un agent ; la pause des alertes et les agents simulés restent à part', () => {
    expect(lireActionsImmediates('reprends Paul', T)).toEqual([{ type: 'reprendre-agent', agent: 'paul' }]);
    expect(lireActionsImmediates('sors Ye de pause', T)).toEqual([{ type: 'reprendre-agent', agent: 'ye' }]);
    expect(types('reprends Livreo')).toEqual([]); // les ignorés (src/server/telegram-commandes.ts)
    expect(types('pas d\'alertes de Luffy pendant 2 h')).toEqual([]);
    expect(types('mets Obito en pause')).toEqual([]);
    expect(types('mets Ye et Paul en pause')).toEqual([]); // un seul agent à la fois
    expect(types('Ye est en pause ?')).toEqual([]);
  });
  it('les durées d’une pause', () => {
    expect(finPauseAgent('cette semaine', Date.UTC(2026, 10, 16, 9))).toBe(Date.UTC(2026, 10, 23)); // un lundi : le lundi suivant
    expect(finPauseAgent('jusqu’à demain', T)).toBe(Date.UTC(2026, 10, 13));
    expect(finPauseAgent('jusqu’à jeudi', T)).toBe(Date.UTC(2026, 10, 19)); // dit un jeudi : jeudi prochain
    expect(finPauseAgent('pour 3 h', T)).toBe(T + 3 * 3_600_000);
    expect(finPauseAgent('une semaine', T)).toBe(T + 7 * 86_400_000);
    expect(finPauseAgent('', T)).toBeNull();
  });
  it('les agents nommés, et L seulement en majuscule', () => {
    expect(agentsNommes('mets L en pause')).toEqual(['L']);
    expect(agentsNommes('l’agent de Léa')).toEqual(['lea']);
    expect(estQuestion('tu peux vérifier mes sites ?')).toBe(false);
    expect(estQuestion('Luffy, tu as vérifié ?')).toBe(true);
  });
  it('ce que le QG répond tout de suite, selon le canal', () => {
    expect(annonce({ type: 'luffy-verifier' }, 'telegram', T)).toBe('Luffy vérifie tes sites maintenant : le résultat arrive ici dans une minute.');
    expect(annonce({ type: 'zoro-verifier' }, 'page', T)).toBe('Zoro refait le tour de sécurité maintenant (quelques minutes) : le résultat arrive sur Telegram.');
    expect(annonce({ type: 'pause-agent', agent: 'ye', jusqua: LUNDI_16 }, 'telegram', T)).toBe('D’accord : Ye est en pause jusqu’à lundi 16 à 00:00. Ses passages prévus d’ici là sont sautés (« en pause (par toi) » dans le calendrier) et ses missions l’attendent. Écris « reprends Ye » pour la reprendre avant.');
    expect(annonce({ type: 'pause-agent', agent: 'paul', jusqua: null }, 'telegram', T)).toContain('en pause jusqu’à ce que tu le reprennes');
    expect(annonce({ type: 'reprendre-agent', agent: 'paul' }, 'telegram', T)).toBe('Paul reprend : ses prochains passages ont lieu comme prévu.');
  });
});
