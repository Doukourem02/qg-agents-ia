import { describe, expect, it } from 'vitest';
import { finDePause, lireCommande } from './telegram-commandes';

// Les commandes de Telegram, reconnues par le code : variantes françaises, fautes courantes, et les questions qui n'en
// sont jamais. Jeudi 12 novembre 2026, 14:00 (Abidjan = UTC).

const NOW = Date.UTC(2026, 10, 12, 14, 0);
const H = 3_600_000, MIN = 60_000;
const type = (t: string) => lireCommande(t, NOW)?.type ?? null;

describe('« ignore »', () => {
  it('les variantes et les fautes courantes', () => {
    for (const t of [
      'ignore Livreo', 'Ignore livreo', 'ignorer Livreo', 'ingore Livreo', 'igonre livreo', 'ignor livreo', 'Livreo c\'est normal, ignore',
      'Livreo cest normal', 'ne t\'inquiète pas pour Livreo', 'ne t’inquiete pas pour livreo', 't\'inquiète pas pour Livreo',
      'tinquiete pas pour livreo', 'tais-toi pour les failles de Zoro', 'tait toi pour les failles de zoro', 'laisse tomber Livreo',
      'Livreo c\'est connu', 'tu peux ignorer Livreo ?', 'ne me parle plus de Livreo',
    ]) expect(type(t), t).toBe('ignorer');
  });
  it('une question n\'est jamais une commande', () => {
    for (const t of ['Livreo est revenu ?', 'pourquoi tu ignores Livreo', 'est-ce que Livreo est en panne ?', 'c\'est normal que Livreo soit en panne ?', 'quoi de neuf ?']) {
      expect(type(t), t).toBeNull();
    }
  });
  it('une conversation reste une conversation', () => {
    for (const t of ['salut Kuroro', 'dis à Mafe de préparer mon point', 'merci', 'je fais une pause café, on en reparle']) expect(type(t), t).toBeNull();
  });
});

describe('« reprends »', () => {
  it('reprendre un ignoré', () => {
    for (const t of ['reprends Livreo', 'reprend livreo', 'Reprendre Zoro', 'réactive Livreo', 'remets Léa', 'reprends tout']) expect(type(t), t).toBe('reprendre');
  });
  it('reprendre les alertes : la fin de la pause', () => {
    for (const t of ['reprends les alertes', 'reprend les alertes', 'réactive les alertes', 'fin de la pause', 'fin du silence', 'remets les alertes']) {
      expect(type(t), t).toBe('fin-pause');
    }
  });
});

describe('la pause générale', () => {
  it('une durée', () => {
    expect(lireCommande('pas d\'alertes pendant 2 h', NOW)).toEqual({ type: 'pause', jusqua: NOW + 2 * H });
    expect(lireCommande('Pas d’alertes pendant 2h', NOW)).toEqual({ type: 'pause', jusqua: NOW + 2 * H });
    expect(lireCommande('silence 30 min', NOW)).toEqual({ type: 'pause', jusqua: NOW + 30 * MIN });
    expect(lireCommande('pause 1h30', NOW)).toEqual({ type: 'pause', jusqua: NOW + 90 * MIN });
    expect(lireCommande('pas d\'alerte pendant une heure', NOW)).toEqual({ type: 'pause', jusqua: NOW + H });
    expect(lireCommande('ignore tout pendant deux heures', NOW)).toEqual({ type: 'pause', jusqua: NOW + 2 * H });
  });
  it('une heure de fin', () => {
    expect(lireCommande('silence jusqu\'à demain 8 h', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 13, 8, 0) });
    expect(lireCommande('silence jusqu’à demain 8h', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 13, 8, 0) });
    expect(lireCommande('pas d\'alertes jusqu\'à 18h30', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 12, 18, 30) });
    // « jusqu'à 8 h » à 14:00 : demain matin
    expect(lireCommande('silence jusqu\'à 8h', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 13, 8, 0) });
    expect(lireCommande('silence jusqu\'à demain matin', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 13, 8, 0) });
    expect(lireCommande('pas d\'alertes jusqu\'à ce soir', NOW)).toEqual({ type: 'pause', jusqua: Date.UTC(2026, 10, 12, 20, 0) });
  });
  it('sans durée : Kuroro la demande ; trop longue : refusée', () => {
    expect(lireCommande('tais-toi', NOW)).toEqual({ type: 'pause', jusqua: null });
    expect(lireCommande('silence', NOW)).toEqual({ type: 'pause', jusqua: null });
    expect(lireCommande('pas d\'alertes', NOW)).toEqual({ type: 'pause', jusqua: null });
    expect(lireCommande('silence pendant 72 h', NOW)).toEqual({ type: 'pause-trop-longue' });
  });
  it('finDePause : rien de lisible → null', () => {
    expect(finDePause('pas d alertes', NOW)).toBeNull();
    expect(finDePause('jusqu a 25h', NOW)).toBeNull();
  });
});
