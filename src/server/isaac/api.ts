import { createHash } from 'node:crypto';
import type { KV } from '../memoire';
import { FILE_DU_MAC, MARQUE_ISAAC, ecrireEtat, prendreMissions, Refus } from '../qg';
import type { Bouton } from '../telegram';

// Les entrées d'Isaac pour son relais sur le Mac : une action = une fonction, testable sans réseau (l'envoi est injecté).
// Règle d'or : rien n'est supprimé sans le Oui du patron. `a-faire` ne rend que les propositions au statut exact « oui »
// et ne marque jamais rien comme exécuté : seul `fait` (rapporté par le relais après exécution) le fait.

export type Proposition = {
  id: string; genre: 'cache' | 'node_modules' | 'simulateurs'; libelle: string; taille: number; impact: string; cibles: string[];
  statut: 'proposee' | 'oui' | 'non' | 'faite' | 'refusee-mac' | 'expiree'; quand: number; decide?: number; libere?: number; raison?: string;
  /** Quand le Mac a rapporté le nettoyage. */
  faite?: number;
};
export const CLES_ISAAC = { propositions: 'isaac:propositions', place: 'isaac:place', vu: 'isaac:vu', refus: 'isaac:refus', codes: 'isaac:codes', pause: 'isaac:pause' } as const;
export type DepsIsaac = { envoyer: (texte: string, boutons?: Bouton[][]) => Promise<unknown> };

const MAX_PROPOSITIONS = 3;
const JOURS_REFUS = 30;
const MS_JOUR = 86_400_000;
const HEURES_PAUSE_MAC = 24;
/** Une proposition vaut 7 jours : après, un Oui est refusé et le Mac en refera une à jour. */
export const JOURS_VALIDITE = 7;
const expiree = (p: Proposition, now: number) => now - p.quand > JOURS_VALIDITE * MS_JOUR;
/** Telegram limite `callback_data` à 64 octets : le bouton porte un code court, jamais l'id (qui peut être long ou accentué). */
export const codeDe = (id: string) => createHash('sha1').update(id).digest('hex').slice(0, 10);
const GENRES = ['cache', 'node_modules', 'simulateurs'] as const;
const GO = 1024 ** 3;

const go = (octets: number) => (octets / GO).toFixed(1).replace('.', ',');
const tronquer = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const entier = (v: unknown, nom: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Refus(`« ${nom} » doit être un nombre positif`);
  return v;
};
const texteBorne = (v: unknown, nom: string, max: number) => {
  if (typeof v !== 'string' || !v.trim()) throw new Refus(`« ${nom} » manquant`);
  if (v.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return v;
};

function lire(brut: string | undefined): Proposition | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as Proposition; } catch { return null; }
}
const ecrire = (kv: KV, p: Proposition) => kv.hset(CLES_ISAAC.propositions, p.id, JSON.stringify(p));

async function rapport(kv: KV, corps: Record<string, unknown>, now: number) {
  const libre = entier(corps.libre, 'libre'), total = entier(corps.total, 'total');
  await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre, total, quand: now }));
  await kv.hset(CLES_ISAAC.vu, 'relais', String(now));
  // un passage du relais n'est pas un événement : état en direct seulement, pas de journal
  await ecrireEtat(kv, { agent: 'isaac', statut: 'termine', tache: `mesure la place : ${go(libre)} Go libres`, outil: 'Mac' }, now, { journal: false });
  return { ok: true };
}

function propositionValide(v: unknown): Omit<Proposition, 'statut' | 'quand'> {
  if (!v || typeof v !== 'object') throw new Refus('proposition illisible');
  const o = v as Record<string, unknown>;
  if (!GENRES.includes(o.genre as never)) throw new Refus(`« genre » inconnu (attendu : ${GENRES.join(', ')})`);
  if (!Array.isArray(o.cibles) || o.cibles.some(c => typeof c !== 'string' || !c)) throw new Refus('« cibles » doit être une liste de textes');
  return {
    id: texteBorne(o.id, 'id', 120), genre: o.genre as Proposition['genre'],
    libelle: texteBorne(o.libelle, 'libelle', 80), taille: entier(o.taille, 'taille'),
    impact: texteBorne(o.impact, 'impact', 200), cibles: o.cibles as string[],
  };
}

async function proposer(kv: KV, corps: Record<string, unknown>, deps: DepsIsaac, now: number) {
  if (!Array.isArray(corps.propositions)) throw new Refus('« propositions » doit être une liste');
  const candidates = corps.propositions.map(propositionValide);
  const [refus, existantes, pauses] = await Promise.all([kv.hgetall(CLES_ISAAC.refus), kv.hgetall(CLES_ISAAC.propositions), kv.hgetall(CLES_ISAAC.pause)]);
  const retenues: Proposition[] = [];
  // le relais en a besoin pour dire la vérité au patron (« attendent ta réponse » / « refusé il y a peu »), jamais « rien trouvé »
  const enAttente: string[] = [], ecartees: string[] = [];
  for (const c of candidates) {
    if (retenues.some(r => r.id === c.id) || enAttente.includes(c.id) || ecartees.includes(c.id)) continue;
    const depuis = Number(refus[c.id]);
    const pause = Number(pauses[c.id]);
    if ((Number.isFinite(depuis) && now - depuis < JOURS_REFUS * MS_JOUR) // refusé il y a moins de 30 jours
      || (Number.isFinite(pause) && now - pause < HEURES_PAUSE_MAC * 3_600_000)) { ecartees.push(c.id); continue; } // le Mac a refusé il y a moins de 24 h
    const existante = lire(existantes[c.id]);
    // déjà en cours (et encore valable) : jamais reproposé
    if (existante && (existante.statut === 'proposee' || existante.statut === 'oui') && !expiree(existante, now)) { enAttente.push(c.id); continue; }
    if (retenues.length >= MAX_PROPOSITIONS) continue;
    retenues.push({ ...c, statut: 'proposee', quand: now });
  }
  if (!retenues.length) return { proposees: [] as string[], enAttente, ecartees };
  // Enregistrées avant l'envoi : un Oui ne peut pas arriver sur une proposition inconnue.
  for (const p of retenues) { await ecrire(kv, p); await kv.hset(CLES_ISAAC.codes, codeDe(p.id), p.id); }
  const lignes = retenues.map(p => `• ${p.libelle} — ${go(p.taille)} Go — ${p.impact}`);
  const boutons: Bouton[][] = retenues.map(p => [
    { texte: `Oui · ${tronquer(p.libelle, 24)}`, donnee: `isc:o:${codeDe(p.id)}` },
    { texte: 'Non', donnee: `isc:n:${codeDe(p.id)}` },
  ]);
  try {
    await deps.envoyer(['🧹 Isaac propose de libérer de la place :', ...lignes].join('\n'), boutons);
  } catch (e) {
    // rien n'est parti : on retire ce qui vient d'être rangé pour que ces propositions puissent revenir
    for (const p of retenues) { await kv.hdel(CLES_ISAAC.propositions, p.id); await kv.hdel(CLES_ISAAC.codes, codeDe(p.id)); }
    throw e;
  }
  await ecrireEtat(kv, { agent: 'isaac', statut: 'termine', tache: `propose : ${retenues.map(p => p.libelle).join(', ')}`.slice(0, 140), outil: 'Mac' }, now);
  return { proposees: retenues.map(p => p.id), enAttente, ecartees };
}

async function aFaire(kv: KV, now: number) {
  await kv.hset(CLES_ISAAC.vu, 'relais', String(now));
  const toutes = Object.values(await kv.hgetall(CLES_ISAAC.propositions)).map(lire);
  // seulement « oui » exact ; rien n'est marqué exécuté ici (rejouable tant que `fait` n'est pas reçu)
  const oui = toutes.filter((p): p is Proposition => p !== null && p.statut === 'oui');
  // un Oui sur une proposition de plus de 7 jours n'est plus exécuté : elle est marquée expirée
  for (const p of oui.filter(p => expiree(p, now))) await ecrire(kv, { ...p, statut: 'expiree' });
  const acceptees = oui.filter(p => !expiree(p, now));
  const missions = await prendreMissions(kv, 'isaac');
  for (const m of missions) {
    await ecrireEtat(kv, { agent: 'isaac', statut: 'au travail', tache: `mission prise : ${m.texte}`.slice(0, 140), outil: 'Mac' }, now);
  }
  return { acceptees, missions };
}

type Resultat = { ligne: string; libere?: number } | null;

/** Applique un résultat du Mac à une proposition « oui ». null : inconnue ou pas (plus) acceptée, rien ne change. */
async function appliquerResultat(kv: KV, corps: Record<string, unknown>, now: number): Promise<Resultat> {
  const id = texteBorne(corps.id, 'id', 120);
  const p = lire((await kv.hmget(CLES_ISAAC.propositions, [id]))[id]);
  // le relais ne rapporte que ce qui a reçu un Oui ; sinon rien n'a le droit d'avoir été exécuté
  if (!p || p.statut !== 'oui') return null;
  if (corps.refus === true) {
    const raison = typeof corps.raison === 'string' && corps.raison.trim() ? corps.raison.trim().slice(0, 200) : 'refusé par le Mac';
    await ecrire(kv, { ...p, statut: 'refusee-mac', raison, faite: now });
    await kv.hset(CLES_ISAAC.pause, p.id, String(now));
    await ecrireEtat(kv, { agent: 'isaac', statut: 'termine', tache: `refuse : ${p.libelle}`.slice(0, 140), outil: 'Mac' }, now, { journal: false });
    return { ligne: `Isaac n'a rien supprimé pour ${p.libelle} : ${raison}.` };
  }
  const libere = entier(corps.libere, 'libere');
  await ecrire(kv, { ...p, statut: 'faite', libere, faite: now });
  await ecrireEtat(kv, { agent: 'isaac', statut: 'termine', tache: `libère ${go(libere)} Go (${p.libelle})`.slice(0, 140), outil: 'Mac' }, now);
  return { ligne: `🧹 Fait : ${go(libere)} Go libérés (${p.libelle}).`, libere };
}

async function rangerLibre(kv: KV, libre: number, now: number) {
  // On garde la taille totale du disque de la dernière mesure (le Mac n'envoie que la place libre ici).
  let total: number | undefined;
  try { total = (JSON.parse((await kv.hgetall(CLES_ISAAC.place)).mesure ?? '{}') as { total?: number }).total; } catch { total = undefined; }
  await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre, ...(total ? { total } : {}), quand: now }));
}

/** Ancienne action, un résultat à la fois (gardée pour compatibilité ; le relais envoie `faits`). */
async function fait(kv: KV, corps: Record<string, unknown>, deps: DepsIsaac, now: number) {
  const id = texteBorne(corps.id, 'id', 120);
  const p = lire((await kv.hmget(CLES_ISAAC.propositions, [id]))[id]);
  if (!p) throw new Refus('proposition inconnue', 404);
  if (p.statut !== 'oui') throw new Refus(`cette proposition n'est pas acceptée (${p.statut})`, 409);
  const libre = corps.refus === true ? undefined : entier(corps.libre, 'libre');
  const r = await appliquerResultat(kv, corps, now);
  if (!r) return { ok: true };
  if (libre !== undefined) await rangerLibre(kv, libre, now);
  // le message d'origine, un résultat à la fois
  await deps.envoyer(r.libere === undefined || libre === undefined ? r.ligne : `🧹 Fait : ${go(r.libere)} Go libérés. Il reste ${go(libre)} Go libres.`);
  return { ok: true };
}

/** Tous les résultats d'un passage (et la fin des missions) : un seul message Telegram. Rejoué : rien de neuf, aucun message. */
async function faits(kv: KV, corps: Record<string, unknown>, deps: DepsIsaac, now: number) {
  const resultats = corps.resultats ?? [];
  const missions = corps.missions ?? [];
  if (!Array.isArray(resultats) || !Array.isArray(missions)) throw new Refus('« resultats » et « missions » doivent être des listes');
  const libre = corps.libre === undefined ? undefined : entier(corps.libre, 'libre');
  const lignes: string[] = [], ignores: string[] = [];
  let unFait = false;
  for (const brut of resultats) {
    const o = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
    const r = await appliquerResultat(kv, o, now);
    if (!r) { ignores.push(String(o.id)); continue; }
    lignes.push(r.ligne);
    if (r.libere !== undefined) unFait = true;
  }
  if (libre !== undefined && resultats.length) await rangerLibre(kv, libre, now);
  if (unFait && libre !== undefined) lignes.push(`Il reste ${go(libre)} Go libres.`);
  const cles: string[] = [];
  for (const brut of missions) {
    const r = await etatMission(kv, (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>, libre, now);
    if (r.cle) cles.push(r.cle);
    if (r.ligne) lignes.push(r.ligne);
  }
  if (lignes.length) {
    try { await deps.envoyer(lignes.join('\n')); }
    catch (e) { for (const c of cles) await kv.del(c); throw e; } // les missions pourront être redites
  }
  return { ok: true, ignores };
}

const ETATS_MISSION = ['prise', 'proposee', 'rien', 'attente', 'ecartee'] as const;
const JOURNAL_MISSION = {
  prise: 'mission prise', proposee: 'mission : propositions envoyées', rien: 'mission : rien à libérer',
  attente: 'mission : propositions en attente de ta réponse', ecartee: 'mission : rien de nouveau',
} as const;
const MESSAGE_MISSION = {
  attente: 'Tes propositions attendent déjà ta réponse sur Telegram.',
  ecartee: 'Rien de nouveau : ce que j\'ai trouvé, tu l\'as refusé il y a peu.',
} as const;

/** « J'ai déjà des propositions pour toi » : lesquelles, et où répondre (plutôt qu'une phrase vague). */
async function messageAttente(kv: KV, now: number) {
  const noms = Object.values(await kv.hgetall(CLES_ISAAC.propositions)).map(lire)
    .filter((p): p is Proposition => p !== null && p.statut === 'proposee' && !expiree(p, now)).map(p => `« ${p.libelle} »`);
  if (!noms.length) return MESSAGE_MISSION.attente;
  return `Je t'ai déjà proposé de libérer ${noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0]}. `
    + 'Ces propositions sont plus haut dans la conversation : réponds Oui ou Non sous chacune, et je m\'en occupe.';
}

/** Range une étape de mission (idempotent). Rend la ligne à dire au patron, s'il y en a une, et la clé posée. */
async function etatMission(kv: KV, corps: Record<string, unknown>, libreDefaut: number | undefined, now: number) {
  const id = texteBorne(corps.id, 'id', 120);
  const texte = typeof corps.texte === 'string' ? corps.texte.trim().slice(0, 300) : '';
  const etat = corps.etat as (typeof ETATS_MISSION)[number];
  if (!ETATS_MISSION.includes(etat)) throw new Refus(`« etat » inconnu (attendu : ${ETATS_MISSION.join(', ')})`);
  const libre = corps.libre === undefined ? libreDefaut : entier(corps.libre, 'libre');
  const cle = `isaac:mission:${id}:${etat}`;
  if (!(await kv.setnx(cle, '1', 7 * 86_400))) return { doublon: true as const };
  try {
    // « prise » : a-faire l'a déjà mise au journal en la prenant ; ici seulement l'état en direct
    const tache = etat === 'prise' ? `${JOURNAL_MISSION.prise} : ${texte}` : JOURNAL_MISSION[etat];
    await ecrireEtat(kv, { agent: 'isaac', statut: etat === 'prise' ? 'au travail' : 'termine', tache: tache.slice(0, 140), outil: 'Mac' }, now, { journal: etat !== 'prise' });
  } catch (e) { await kv.del(cle); throw e; }
  const ligne = etat === 'rien' ? `Isaac n'a rien trouvé à libérer pour l'instant${libre === undefined ? '' : ` (${go(libre)} Go libres)`}.`
    : etat === 'attente' ? await messageAttente(kv, now)
    : etat === 'ecartee' ? MESSAGE_MISSION[etat] : undefined;
  return { ligne, cle };
}

/** Une étape de mission à la fois (le relais l'utilise pour « prise » ; la fin passe par `faits`). */
async function mission(kv: KV, corps: Record<string, unknown>, deps: DepsIsaac, now: number) {
  const r = await etatMission(kv, corps, undefined, now);
  if ('doublon' in r) return { ok: true, doublon: true };
  if (r.ligne) {
    try { await deps.envoyer(r.ligne); } catch (e) { await kv.del(r.cle); throw e; } // rien n'est parti : le relais pourra redire
  }
  return { ok: true };
}

/** Un second clic sur un bouton : ce qui a déjà été décidé, en clair. */
const DEJA: Partial<Record<Proposition['statut'], (l: string) => string>> = {
  non: l => `Tu as déjà dit Non pour « ${l} » : je n'y touche pas.`,
  oui: l => `Tu as déjà dit Oui pour « ${l} » : je l'efface dans la minute, si ton Mac est allumé.`,
  faite: l => `« ${l} » est déjà effacé.`,
};

/** Le Oui ou le Non du patron (bouton Telegram). Renvoie la réponse courte du webhook. Rejoué : « déjà noté », rien ne change. */
export async function deciderIsaac(kv: KV, ref: string, oui: boolean, now: number = Date.now()): Promise<string> {
  const id = (await kv.hmget(CLES_ISAAC.codes, [ref]))[ref] ?? ref; // le bouton porte un code court
  const p = lire((await kv.hmget(CLES_ISAAC.propositions, [id]))[id]);
  if (!p) return 'Cette proposition est inconnue.';
  if (p.statut !== 'proposee') return DEJA[p.statut]?.(p.libelle) ?? `Tu as déjà répondu pour « ${p.libelle} ».`;
  if (expiree(p, now)) {
    await ecrire(kv, { ...p, statut: 'expiree' });
    return 'Cette proposition est trop ancienne ; Isaac en refera une à jour.';
  }
  await ecrire(kv, { ...p, statut: oui ? 'oui' : 'non', decide: now });
  if (!oui) {
    await kv.hset(CLES_ISAAC.refus, id, String(now));
    return `Noté : je laisse « ${p.libelle} » tranquille.`;
  }
  await kv.lpush(FILE_DU_MAC, MARQUE_ISAAC); // le Mac lance Isaac tout de suite, sans attendre son passage de 5 min
  return `Noté : j'efface « ${p.libelle} » dans la minute, si ton Mac est allumé.`;
}

export async function traiterActionIsaac(
  kv: KV, action: string, corps: Record<string, unknown>, deps: DepsIsaac, now: number = Date.now(),
): Promise<unknown> {
  switch (action) {
    case 'rapport': return rapport(kv, corps, now);
    case 'proposer': return proposer(kv, corps, deps, now);
    case 'a-faire': return aFaire(kv, now);
    case 'fait': return fait(kv, corps, deps, now);
    case 'faits': return faits(kv, corps, deps, now);
    case 'mission': return mission(kv, corps, deps, now);
    default: throw new Refus('action inconnue', 404);
  }
}
