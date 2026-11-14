import type { KV } from '../memoire';
import { Refus } from '../qg';

// Les exports de statistiques LinkedIn (xlsx ou csv) que je dépose via Telegram.
// Le serveur ne les interprète pas : il range chaque feuille en tableau brut, L en tire le bilan.

export type Feuille = { nom: string; lignes: string[][] };
export type DepotStats = { id: string; nom: string; quand: number; feuilles: Feuille[]; traite: boolean };

export const CLE_STATS = 'l:stats';

const MAX_LIGNES = 80;
const MAX_CELLULE = 120;
const MAX_FEUILLES = 8;
const MAX_COLONNES = 15;

const extension = (nom: string) => nom.toLowerCase().match(/\.(xlsx|csv)$/)?.[1];
const sansExtension = (nom: string) => nom.replace(/\.(xlsx|csv)$/i, '');

export const estTableur = (nom: string) => extension(nom) !== undefined;

const nouvelId = () => Math.random().toString(36).slice(2, 8);

const jj = (n: number) => String(n).padStart(2, '0');

/** Une cellule en texte lisible : dates en jj/mm/aaaa, nombres sans artefact, vide pour rien. */
function enTexte(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const d = `${jj(v.getUTCDate())}/${jj(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    const h = v.getUTCHours() || v.getUTCMinutes() ? ` ${jj(v.getUTCHours())}:${jj(v.getUTCMinutes())}` : '';
    return d + h;
  }
  if (typeof v === 'boolean') return v ? 'vrai' : 'faux';
  return String(v).trim().slice(0, MAX_CELLULE);
}

/** Applique les limites : lignes entièrement vides retirées, 80 lignes, 15 colonnes, 120 caractères par cellule. */
function nettoyer(lignes: unknown[][]): string[][] {
  return lignes
    .map(l => l.slice(0, MAX_COLONNES).map(enTexte))
    .filter(l => l.some(c => c !== ''))
    .slice(0, MAX_LIGNES);
}

/** Découpe un csv (guillemets, `""` pour un guillemet, retours à la ligne dans un champ). */
function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (premiere.match(/;/g)?.length ?? 0) > (premiere.match(/,/g)?.length ?? 0) ? ';' : ',';
  const lignes: string[][] = [];
  let ligne: string[] = [], champ = '', entre = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entre) {
      if (c === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else entre = false; }
      else champ += c;
    } else if (c === '"') entre = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ); lignes.push(ligne); ligne = []; champ = '';
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

/** Lit un export (.xlsx ou .csv) et rend ses feuilles en texte ; refus 422 si ce n'est pas lisible. */
export async function lireTableur(nom: string, contenu: Uint8Array): Promise<Feuille[]> {
  const ext = extension(nom);
  if (!ext) throw new Refus('ce fichier n\'est pas un tableur (.xlsx ou .csv)', 422);
  let feuilles: Feuille[];
  if (ext === 'csv') {
    feuilles = [{ nom: sansExtension(nom), lignes: nettoyer(lireCsv(new TextDecoder().decode(contenu))) }];
  } else {
    try {
      const { default: lireXlsx } = await import('read-excel-file/node');
      const classeur = await lireXlsx(Buffer.from(contenu));
      feuilles = classeur.slice(0, MAX_FEUILLES).map(f => ({ nom: f.sheet, lignes: nettoyer(f.data) }));
    } catch {
      throw new Refus('fichier illisible', 422);
    }
  }
  feuilles = feuilles.filter(f => f.lignes.length > 0);
  if (!feuilles.length) throw new Refus('fichier vide', 422);
  return feuilles;
}

export async function deposerStats(kv: KV, nom: string, feuilles: Feuille[], now = Date.now()): Promise<DepotStats> {
  const d: DepotStats = { id: nouvelId(), nom, quand: now, feuilles, traite: false };
  await kv.hset(CLE_STATS, d.id, JSON.stringify(d));
  return d;
}

async function tous(kv: KV): Promise<DepotStats[]> {
  return Object.values(await kv.hgetall(CLE_STATS)).map(v => JSON.parse(v) as DepotStats);
}

/** Les dépôts pas encore traités, du plus ancien au plus récent. */
export async function statsATraiter(kv: KV): Promise<DepotStats[]> {
  return (await tous(kv)).filter(d => !d.traite).sort((a, b) => a.quand - b.quand);
}

export async function marquerStatsTraite(kv: KV, id: string): Promise<DepotStats> {
  const brut = (await kv.hgetall(CLE_STATS))[id];
  if (!brut) throw new Refus('dépôt de statistiques inconnu', 404);
  const d = JSON.parse(brut) as DepotStats;
  if (d.traite) throw new Refus('ce dépôt est déjà traité', 409);
  d.traite = true;
  await kv.hset(CLE_STATS, id, JSON.stringify(d));
  return d;
}
