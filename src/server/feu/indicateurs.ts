// Feu : les outils de lecture du marché, en code pur (aucun réseau, aucune IA). Testés dans feu.test.ts.
import type { Bougie, Structure } from './types';

/** Seulement les bougies terminées à `now` (la dernière de Binance est celle en cours). */
export const closes = (b: readonly Bougie[], now: number) => b.filter(x => x.f < now);

/** RSI de Wilder sur `n` périodes, à partir des clôtures ; null s'il n'y a pas assez de bougies. */
export function rsi(clotures: readonly number[], n = 14): number | null {
  if (clotures.length < n + 1) return null;
  let gain = 0, perte = 0;
  for (let i = 1; i <= n; i++) {
    const d = clotures[i] - clotures[i - 1];
    if (d > 0) gain += d; else perte -= d;
  }
  gain /= n; perte /= n;
  for (let i = n + 1; i < clotures.length; i++) {
    const d = clotures[i] - clotures[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    perte = (perte * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (perte === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / perte);
}

/**
 * Les hauts et bas marquants (pivots) : une bougie dont le haut dépasse les `k` voisines de chaque côté (un sommet), ou
 * dont le bas passe sous elles (un creux). Les `k` dernières bougies ne peuvent pas encore en être un.
 */
export function pivots(b: readonly Bougie[], k = 2): { hauts: { i: number; prix: number; t: number }[]; bas: { i: number; prix: number; t: number }[] } {
  const hauts: { i: number; prix: number; t: number }[] = [], bas: { i: number; prix: number; t: number }[] = [];
  for (let i = k; i < b.length - k; i++) {
    let sommet = true, creux = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      // à gauche strictement, à droite au moins égal : un double sommet ne compte qu'une fois
      if (j < i ? b[j].h >= b[i].h : b[j].h > b[i].h) sommet = false;
      if (j < i ? b[j].l <= b[i].l : b[j].l < b[i].l) creux = false;
    }
    if (sommet) hauts.push({ i, prix: b[i].h, t: b[i].t });
    if (creux) bas.push({ i, prix: b[i].l, t: b[i].t });
  }
  return { hauts, bas };
}

/**
 * La structure : hauts et bas plus hauts (haussière), plus bas (baissière), sinon un range. Il faut deux sommets et
 * deux creux pour le dire ; sinon « indéterminée » (jamais devinée).
 */
export function structure(b: readonly Bougie[], k = 2): Structure {
  const { hauts, bas } = pivots(b, k);
  if (hauts.length < 2 || bas.length < 2) return 'indeterminee';
  const [h1, h2] = hauts.slice(-2).map(x => x.prix), [b1, b2] = bas.slice(-2).map(x => x.prix);
  if (h2 > h1 && b2 > b1) return 'haussiere';
  if (h2 < h1 && b2 < b1) return 'baissiere';
  return 'range';
}

/** Arrondi vers le bas au pas (prix ou quantité), sans erreur de virgule flottante. */
export function auPas(v: number, pas: number): number {
  if (!(pas > 0)) return v;
  const decimales = Math.max(0, Math.round(-Math.log10(pas)));
  const n = Math.floor(v / pas + 1e-9);
  return Number((n * pas).toFixed(decimales));
}
/** Arrondi vers le haut au pas. */
export function auPasHaut(v: number, pas: number): number {
  if (!(pas > 0)) return v;
  const decimales = Math.max(0, Math.round(-Math.log10(pas)));
  const n = Math.ceil(v / pas - 1e-9);
  return Number((n * pas).toFixed(decimales));
}

const NBSP = ' ';
/** Un prix lisible : « 71 717 », « 2 005,4 » (espaces fines, virgule), au plus `dec` décimales. */
export function prixFr(v: number, dec = 2): string {
  const s = v.toLocaleString('fr-FR', { maximumFractionDigits: v >= 1000 ? Math.min(dec, 1) : dec, minimumFractionDigits: 0 });
  return s.replace(/[   ]/g, NBSP);
}
/** Un montant en USDT : « 8,50 USDT ». */
export const usdt = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[   ]/g, NBSP)} USDT`;
/** Un pourcentage : « 2,4 % ». */
export const pct = (v: number, dec = 1) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: dec })} %`;
/** « 14:05 » (UTC = Abidjan). */
export const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** « ven. 13 nov. 13:30 ». */
export const jourHeure = (ms: number) => `${new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(ms)}`;
/** « BTC/USDT ». */
export const nomPaire = (p: string) => p.replace(/USDT$/, '/USDT');
