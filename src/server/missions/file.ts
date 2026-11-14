import type { KV } from '../memoire';
import { CLES, ecrireEtat, Refus, type Mission } from '../qg';
import { contientSecret } from '../paul/secrets';
import { contientInvisible, estCommande } from '../paul/rapport';
import { neutraliserLiens } from '../lea/rapport';
import { agentsEnPause, enPauseA, lirePauses, type Pauses } from '../pause-agents';
import { AGENTS_MISSIONS, STATUTS_RAPPORT, type StatutRapport } from '@/data/missions';
import { NOMS_REELS } from '@/sim/actions-immediates';
import { refusFeu } from '../feu/textes';

// La file de la routine « QG · missions » (agents/Missions/CONSIGNES.md, scripts/missions.mjs) : chaque heure de 08:00
// à 20:00, elle prend les missions en attente de L, Light, Clara, Mafe, Léa, Paul et Ye (`a-faire`), les fait dans les
// limites de chaque agent, puis rend un rapport par mission (`rapport`), vérifié ici : champs autorisés, aucun secret,
// aucune injonction ni commande. Le QG écrit le résultat sur Telegram et dans le journal, et marque la mission faite.
//   qg:missions:encours     table id → Prise : remise à la routine, en attente de son rapport (rendue deux fois au plus)
//   qg:missions:historique  liste : ce qui est arrivé à chaque mission (200 au plus, la plus récente en tête)
//   qg:missions:passages    table « AAAA-MM-JJTHH » → { quand, pris } : les passages de la routine (le calendrier)
// Aucun texte de rapport n'est journalisé ailleurs que dans le journal du QG. Heure d'Abidjan = UTC.

export const CLES_MISSIONS = {
  encours: 'qg:missions:encours',
  historique: 'qg:missions:historique',
  passages: 'qg:missions:passages',
} as const;

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Au plus 5 missions par passage : la routine doit finir dans son heure. */
export const MAX_PAR_PASSAGE = 5;
/** Une mission remise sans rapport depuis 2 h est redonnée ; après 2 remises, elle est dite « sans rapport ». */
export const REMISE_MS = 2 * H;
export const ESSAIS_MAX = 2;
const HISTORIQUE_MAX = 200;
const GARDE_PASSAGES = 14 * JOUR;
export const MAX_TEXTE = 600;
export const MAX_RAISON = 200;
const CHAMPS = ['id', 'statut', 'texte', 'raison'];

export type Prise = { mission: Mission; pris: number; essais: number };
export type Trace = { id: string; agent: string; texte: string; depose: number; pris?: number; fini?: number; statut?: StatutRapport | 'sans-rapport' };
export type PassageMissions = { quand: number; pris: number };

const lire = <T>(brut: string | undefined | null): T | null => {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
};
const nom = (agent: string) => NOMS_REELS[agent] ?? agent;
/** La mission en quelques mots, pour Telegram et le journal. */
const court = (t: string, n = 100) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const cleHeure = (t: number) => new Date(t).toISOString().slice(0, 13);

async function lireHistorique(kv: KV): Promise<Trace[]> {
  return (await kv.lrange(CLES_MISSIONS.historique, 0, -1)).flatMap(v => lire<Trace>(v) ?? []);
}
/** Ajoute ou met à jour la trace d'une mission (la plus récente en tête). */
async function tracer(kv: KV, t: Trace) {
  const toutes = await lireHistorique(kv);
  const avant = toutes.find(x => x.id === t.id);
  const garde = [{ ...avant, ...t }, ...toutes.filter(x => x.id !== t.id)].slice(0, HISTORIQUE_MAX);
  await kv.del(CLES_MISSIONS.historique);
  for (const x of [...garde].reverse()) await kv.lpush(CLES_MISSIONS.historique, JSON.stringify(x));
}

export type DepsMissions = {
  envoyer: (texte: string) => Promise<unknown>;
  /** Ce que la page montre du bureau de l'agent (lecture seule, sans secret) : le contexte de la mission. */
  bureau?: (agent: string) => Promise<unknown>;
};

/** Le dossier des consignes de l'agent dans le dépôt, et son script quand il en a un. */
const DOSSIERS: Record<string, string> = { L: 'L', light: 'Light', clara: 'Clara', mafe: 'Mafe', lea: 'Lea', paul: 'Paul', ye: 'Ye', feu: 'Feu' };

/**
 * `a-faire` : les missions à faire maintenant (les plus anciennes d'abord, 5 au plus), sans celles d'un agent en pause.
 * Une mission remise depuis plus de 2 h sans rapport est redonnée une fois ; ensuite, le patron le sait.
 * Chaque appel est noté (le calendrier : passage fait, ou rien à faire).
 */
export async function aFaire(kv: KV, deps: DepsMissions, now = Date.now()) {
  const pauses = await lirePauses(kv).catch((): Pauses => ({}));
  const enPause = new Set(agentsEnPause(pauses, now));
  const sortie: Prise[] = [];

  for (const [id, brut] of Object.entries(await kv.hgetall(CLES_MISSIONS.encours))) {
    const p = lire<Prise>(brut);
    if (!p) { await kv.hdel(CLES_MISSIONS.encours, id); continue; }
    if (now - p.pris < REMISE_MS || enPause.has(p.mission.agent)) continue;
    if (p.essais >= ESSAIS_MAX) {
      await kv.hdel(CLES_MISSIONS.encours, id);
      await tracer(kv, { id, agent: p.mission.agent, texte: court(p.mission.texte), depose: p.mission.quand, fini: now, statut: 'sans-rapport' });
      await ecrireEtat(kv, { agent: p.mission.agent, statut: 'erreur', tache: `mission sans rapport : ${court(p.mission.texte, 110)}` }, now);
      await deps.envoyer(`⛔ ${nom(p.mission.agent)} · ta mission « ${court(p.mission.texte)} » n’a pas pu être faite : la routine des missions n’a pas rendu de rapport (${ESSAIS_MAX} essais). Redonne-la si tu en as encore besoin.`).catch(() => console.error('missions : message « sans rapport » pas parti'));
      continue;
    }
    if (sortie.length < MAX_PAR_PASSAGE) sortie.push({ ...p, pris: now, essais: p.essais + 1 });
  }

  for (const agent of AGENTS_MISSIONS) {
    if (enPause.has(agent)) continue;
    while (sortie.length < MAX_PAR_PASSAGE) {
      const v = lire<Mission>(await kv.rpop(CLES.missions(agent)));
      if (!v) break;
      sortie.push({ mission: v, pris: now, essais: 1 });
    }
  }

  const nouvelles = sortie.filter(p => p.essais === 1);
  for (const p of sortie) {
    await kv.hset(CLES_MISSIONS.encours, p.mission.id, JSON.stringify(p));
    await tracer(kv, { id: p.mission.id, agent: p.mission.agent, texte: court(p.mission.texte), depose: p.mission.quand, pris: now });
  }
  for (const p of nouvelles) {
    await ecrireEtat(kv, { agent: p.mission.agent, statut: 'au travail', tache: `mission prise : ${court(p.mission.texte, 120)}` }, now, { journal: false });
  }
  await noterPassage(kv, sortie.length, now);

  const bureaux = new Map<string, unknown>();
  const missions = [];
  for (const p of sortie) {
    const agent = p.mission.agent;
    if (deps.bureau && !bureaux.has(agent)) bureaux.set(agent, await deps.bureau(agent).catch(() => null));
    missions.push({
      id: p.mission.id, agent, nom: nom(agent), texte: p.mission.texte, depose: p.mission.quand, essai: p.essais,
      consignes: `agents/${DOSSIERS[agent]}/CONSIGNES.md`, script: `scripts/${agent.toLowerCase()}.mjs`,
      ...(deps.bureau ? { bureau: bureaux.get(agent) ?? null } : {}),
    });
  }
  return { missions, ...(missions.length ? {} : { rien: 'Aucune mission en attente : rien à faire, arrête-toi.' }) };
}

async function noterPassage(kv: KV, pris: number, now: number) {
  const cle = cleHeure(now);
  const avant = lire<PassageMissions>((await kv.hmget(CLES_MISSIONS.passages, [cle]))[cle]);
  await kv.hset(CLES_MISSIONS.passages, cle, JSON.stringify({ quand: avant?.quand ?? now, pris: (avant?.pris ?? 0) + pris } satisfies PassageMissions));
  for (const [k, v] of Object.entries(await kv.hgetall(CLES_MISSIONS.passages))) {
    const p = lire<PassageMissions>(v);
    if (!p || now - p.quand > GARDE_PASSAGES) await kv.hdel(CLES_MISSIONS.passages, k);
  }
}

// ───────────── Le rapport ─────────────

const norme = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
/**
 * Une injonction adressée à un agent ou à Kuroro (le journal est relu par Kuroro comme des faits) : « ignore tes
 * consignes », « tu dois », « désormais tu… », les formules anglaises, ou une commande à lancer.
 */
const INJONCTION = /\b(ignore[rsz]? (tes|les|vos|toutes? les|ces|ses|leurs) (consignes|regles|instructions|interdits|limites)|tu dois|vous devez|il faut que tu|oublie (tes|les|vos|ses)|n oublie pas|desormais tu|a partir de maintenant tu|tu es (maintenant|desormais)|ignore (previous|all|the|any)|system prompt|instructions? (precedentes|du systeme|systeme)|always|never|must|you should|you must|do not|don t)\b/;
export const estInjonction = (t: string) => INJONCTION.test(norme(t)) || estCommande(t);

function texteVerifie(v: unknown, champ: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Refus(`« ${champ} » : un texte non vide est attendu`, 400);
  const t = v.trim();
  if (t.length > max) throw new Refus(`« ${champ} » : ${max} caractères au plus`, 422);
  if (contientInvisible(t.replace(/\n/g, ''))) throw new Refus(`« ${champ} » : caractère invisible refusé`, 422);
  if (contientSecret(t)) throw new Refus(`« ${champ} » : un secret a été reconnu, rien n'est envoyé`, 422);
  if (estInjonction(t)) throw new Refus(`« ${champ} » : une consigne ou une commande a été reconnue, rien n'est envoyé`, 422);
  return neutraliserLiens(t);
}

/** Le rapport vérifié. Forme fausse → 400 ; contenu refusé → 422. Les messages ne recopient jamais une valeur reçue. */
export function validerRapport(corps: Record<string, unknown>): { id: string; statut: StatutRapport; texte: string; raison?: string } {
  if (Object.keys(corps).some(k => !CHAMPS.includes(k))) throw new Refus(`champ non autorisé (seulement : ${CHAMPS.join(', ')})`, 400);
  if (typeof corps.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(corps.id)) throw new Refus('« id » : l\'id de la mission, tel que rendu par a-faire', 400);
  if (typeof corps.statut !== 'string' || !(STATUTS_RAPPORT as readonly string[]).includes(corps.statut)) throw new Refus(`« statut » : ${STATUTS_RAPPORT.join(', ')}`, 400);
  const statut = corps.statut as StatutRapport;
  const texte = texteVerifie(corps.texte, 'texte', MAX_TEXTE);
  if (statut === 'impossible' && corps.raison === undefined) throw new Refus('« raison » : obligatoire quand la mission est impossible', 400);
  const raison = corps.raison === undefined ? undefined : texteVerifie(corps.raison, 'raison', MAX_RAISON).replace(/\s+/g, ' ');
  return { id: corps.id, statut, texte, ...(raison ? { raison } : {}) };
}

const LIBELLES: Record<StatutRapport, string> = { fait: 'faite', 'a-valider': 'à valider', impossible: 'impossible' };

/** Le message Telegram du résultat. */
export function messageRapport(m: Mission, r: { statut: StatutRapport; texte: string; raison?: string }): string {
  const tete = `${nom(m.agent)} · ta mission « ${court(m.texte)} »`;
  switch (r.statut) {
    case 'fait': return `✅ ${tete} : c’est fait.\n${r.texte}`;
    case 'a-valider': return `🟡 ${tete} : à valider, rien n’est fait sans ton accord.\n${r.texte}`;
    case 'impossible': return `⛔ ${tete} : impossible (${r.raison}).\n${r.texte}`;
  }
}

/**
 * `rapport` : le résultat d'une mission remise par `a-faire`. Le message part d'abord sur Telegram ; s'il ne part pas,
 * rien n'est marqué (503, la routine peut renvoyer). Puis la mission est marquée faite, dans le journal et l'historique.
 */
export async function rendreRapport(kv: KV, corps: Record<string, unknown>, deps: DepsMissions, now = Date.now()) {
  const r = validerRapport(corps);
  const p = lire<Prise>((await kv.hmget(CLES_MISSIONS.encours, [r.id]))[r.id]);
  if (!p) throw new Refus('mission inconnue ou déjà rendue', 404);
  // Feu : ses règles valent aussi pour une réponse de mission
  const feu = p.mission.agent === 'feu' ? refusFeu(`${r.texte}\n${r.raison ?? ''}`) : null;
  if (feu) throw new Refus(`« texte » : ${feu}, rien n'est envoyé`, 422);
  try { await deps.envoyer(messageRapport(p.mission, r)); } catch {
    throw new Refus('le message Telegram n\'est pas parti : renvoie le rapport dans un moment', 503);
  }
  await kv.hdel(CLES_MISSIONS.encours, r.id);
  await tracer(kv, { id: r.id, agent: p.mission.agent, texte: court(p.mission.texte), depose: p.mission.quand, pris: p.pris, fini: now, statut: r.statut });
  await ecrireEtat(kv, {
    agent: p.mission.agent, statut: 'termine',
    tache: `mission ${LIBELLES[r.statut]} : ${court(p.mission.texte, 110)}`,
    resultat: court((r.statut === 'impossible' ? `${r.raison} · ${r.texte}` : r.texte).replace(/\s+/g, ' '), 200),
  }, now);
  return { ok: true, statut: r.statut };
}

// ───────────── Le calendrier ─────────────

export type DonneesMissions = { passages: Record<string, PassageMissions>; traces: Trace[]; enAttente: Mission[]; pauses: Pauses };

export async function lireDonneesMissions(kv: KV): Promise<DonneesMissions> {
  const [brutPassages, traces, pauses, ...listes] = await Promise.all([
    kv.hgetall(CLES_MISSIONS.passages), lireHistorique(kv), lirePauses(kv),
    ...AGENTS_MISSIONS.map(a => kv.lrange(CLES.missions(a), 0, -1)),
  ]);
  const passages: Record<string, PassageMissions> = {};
  for (const [k, v] of Object.entries(brutPassages)) { const p = lire<PassageMissions>(v); if (p) passages[k] = p; }
  return { passages, traces, pauses, enAttente: listes.flat().flatMap(v => lire<Mission>(v) ?? []) };
}

/**
 * L'état du passage de `quand` (une heure pile) : fait s'il a pris des missions ; à venir pendant son heure ; raté si
 * une mission attendait (déposée avant, agent pas en pause) et n'a pas été prise dans l'heure ; pas nécessaire sinon.
 */
export function etatPassageMissions(quand: number, now: number, d: DonneesMissions): 'fait' | 'a-venir' | 'rate' | 'sans-objet' {
  const p = d.passages[cleHeure(quand)];
  if (p && p.pris > 0) return 'fait';
  if (now < quand + H) return 'a-venir';
  if (p) return 'sans-objet';
  const attendait = (agent: string, depose: number, pris: number | undefined) =>
    depose < quand && (pris === undefined || pris >= quand + H) && !enPauseA(d.pauses, agent, quand);
  const rate = d.enAttente.some(m => attendait(m.agent, m.quand, undefined)) || d.traces.some(t => attendait(t.agent, t.depose, t.pris));
  return rate ? 'rate' : 'sans-objet';
}
