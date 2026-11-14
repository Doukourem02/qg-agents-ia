// Le passage de Feu (QStash, toutes les 15 minutes, sans IA) : lit les bougies, calcule le statut de chaque paire,
// range l'état, envoie les alertes. Les alertes (hors Signal et débrief) : 6 messages par jour au plus, en respectant la
// pause générale (src/server/silence.ts) et ce que le patron a dit d'ignorer (bouton « Ignorer »).
import type { KV } from '../memoire';
import { ecrireEtat } from '../qg';
import { envoyerAlerte, type Envoyer } from '../silence';
import { capitalDe } from './compte';
import {
  CLES_FEU, ecrireEtatFeu, ecrirePassageFeu, garderRegles, lireCompte, lireEtatFeu, lirePassageFeu, lireReglesGardees,
  sousVerrouFeu, type EtatFeu, type PassageFeu,
} from './etat';
import { closes, nomPaire, usdt } from './indicateurs';
import { completerPositions, debrief, interditDe, journalDe, pauseDe, reconstituer } from './journal';
import { ErreurMarche, lireBougies, lireReglesPaires } from './marche';
import {
  messageDebrief, messageMacro, messageNiveau, messagePause, messagePositionObjectif, messagePositionStop, messageSignal,
  messageSurveillance,
} from './messages';
import { annonceEnCours, lireContexte, regimeDe, statutPaire } from './moteur';
import { PAIRES, type Bougie, type Compte, type Paire, type StatutPaire } from './types';
import type { Bouton } from '../telegram';

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Hors Signal et débrief : 6 messages d'alerte par jour au plus. */
export const ALERTES_PAR_JOUR = 6;
const MESSAGES_MAX = 60;
const GARDE_PLANS = 30 * JOUR;
/** Un ignoré tient 24 h au plus, ou jusqu'à ce que le statut de la paire change. */
export const IGNORE_MAX = JOUR;

export type DepsFeu = { fetch: typeof fetch; envoyer: Envoyer };
export type MessageFeu = { quand: number; texte: string; envoye: boolean; raison?: string; sujets: string[] };
type Alerte = { sujet: string; texte: string; ignorable: boolean; hors: boolean };
export type Ignore = { depuis: number; statut?: string };

const jour = (t: number) => new Date(t).toISOString().slice(0, 10);
const lire = <T>(brut: string | undefined | null): T | null => { if (!brut) return null; try { return JSON.parse(brut) as T; } catch { return null; } };

export async function lireMessages(kv: KV, n = MESSAGES_MAX): Promise<MessageFeu[]> {
  return (await kv.lrange(CLES_FEU.messages, 0, n - 1)).flatMap(v => lire<MessageFeu>(v) ?? []);
}
async function noterMessage(kv: KV, m: MessageFeu) {
  await kv.lpush(CLES_FEU.messages, JSON.stringify(m));
  await kv.ltrim(CLES_FEU.messages, 0, MESSAGES_MAX - 1);
}

export async function lireIgnoresFeu(kv: KV): Promise<Record<string, Ignore>> {
  const out: Record<string, Ignore> = {};
  for (const [k, v] of Object.entries(await kv.hgetall(CLES_FEU.ignores))) { const i = lire<Ignore>(v); if (i) out[k] = i; }
  return out;
}

/** Le bouton « Ignorer » d'un sujet : `fei:<sujet>` (« paire:BTCUSDT », « macro:<heure> »). */
export const boutonIgnorer = (sujet: string): Bouton => ({ texte: sujet.startsWith('macro:') ? 'Ignorer cette annonce' : `Ignorer ${nomPaire(sujet.split(':')[1] ?? '')}`, donnee: `fei:${sujet}` });

/** Les bougies des trois unités de temps pour chaque paire, lues en parallèle. */
async function lireMarche(f: typeof fetch): Promise<Record<Paire, { b4h: Bougie[]; b1h: Bougie[]; b15m: Bougie[] }>> {
  const lus = await Promise.all(PAIRES.map(async p => {
    const [b4h, b1h, b15m] = await Promise.all([lireBougies(f, p, '4h'), lireBougies(f, p, '1h'), lireBougies(f, p, '15m')]);
    return [p, { b4h, b1h, b15m }] as const;
  }));
  return Object.fromEntries(lus) as Record<Paire, { b4h: Bougie[]; b1h: Bougie[]; b15m: Bougie[] }>;
}

/** Tout ce que le code sait du compte, du journal et de la discipline maintenant (partagé avec la page et le lot). */
export function situation(etat: EtatFeu, compte: Compte | null, prix: Record<string, number>, now: number) {
  const capital = capitalDe(etat, compte, prix);
  const regime = regimeDe(capital.montant);
  const { operations, positions: brutes } = reconstituer(compte?.cle === 'ok' ? compte.executes : [], etat.plans);
  const positions = completerPositions(brutes, compte);
  const journal = journalDe(operations, positions, capital.montant, now);
  const pause = pauseDe(operations, regime, capital.montant, now);
  const annonce = annonceEnCours(etat.annonces, now);
  const interdit = interditDe(operations, journal, pause, regime, capital.montant, now)
    ?? (annonce ? `fenêtre macro : ${annonce.nom} à ${new Date(annonce.quand).toISOString().slice(11, 16)} UTC, pas d'entrée dans l'heure avant ni après` : null);
  const engage = positions.reduce((s, p) => s + p.quantite * p.prixEntree, 0);
  const operationsStandard = 0; // les 10 premières du régime standard : à compter dès qu'on y passe (aucune aujourd'hui)
  return { capital, regime, operations, positions, journal, pause, interdit, engage, operationsStandard };
}

/** Une ligne courte pour les notes d'un Signal : où sont les USDT. */
function noteFonds(compte: Compte | null): string[] {
  if (compte?.cle !== 'ok') return ['Solde réel pas encore lu (clé en lecture seule pas encore créée) : le plan part des 8,50 USDT déclarés ; vérifie ton Spot avant de poser l\'ordre.'];
  const spot = compte.spot.USDT?.libre ?? 0, earn = compte.earn.USDT ?? 0;
  if (earn > 0 && spot < 5) return [`Tes USDT dorment en Simple Earn (${usdt(earn)}) : retire-les vers le Spot avant de poser l'ordre.`];
  return [];
}

/**
 * Le passage : le cœur sans réseau (le marché et l'envoi sont injectés). `marche` est fourni par les tests ; sinon
 * il est lu sur le miroir public.
 */
export async function passageFeu(kv: KV, deps: DepsFeu, now: number, apres?: (statuts: StatutPaire[]) => Promise<void>): Promise<unknown> {
  return sousVerrouFeu(kv, async () => {
    const etat = await lireEtatFeu(kv, now);
    let regles = await lireReglesGardees(kv, now);
    let marche: Awaited<ReturnType<typeof lireMarche>>;
    try {
      regles ??= await lireReglesPaires(deps.fetch, PAIRES).then(async r => { await garderRegles(kv, r, now); return r; });
      marche = await lireMarche(deps.fetch);
    } catch (e) {
      const raison = e instanceof ErreurMarche ? e.message : 'lecture impossible';
      const avant = await lirePassageFeu(kv);
      // le dernier statut reste dans la page avec son heure de lecture : jamais présenté comme actuel
      await ecrirePassageFeu(kv, { ...(avant ?? { statuts: [] }), quand: avant?.quand ?? now, erreur: `${raison} (${new Date(now).toISOString().slice(11, 16)} UTC)` });
      await ecrireEtat(kv, { agent: 'feu', statut: 'erreur', tache: `n'a pas pu lire le marché : ${raison}`.slice(0, 140), outil: 'Bi' }, now, { journal: false });
      return { ok: false, raison };
    }
    const prix: Record<string, number> = Object.fromEntries(PAIRES.map(p => [p, marche[p].b15m.at(-1)?.c ?? NaN]));
    const compte = await lireCompte(kv);
    const sit = situation(etat, compte, prix, now);

    const statuts = PAIRES.map(p => statutPaire({
      paire: p, ...marche[p], now, niveaux: etat.niveaux[p], regles: regles![p],
      compte: { capital: sit.capital.montant, regime: sit.regime, frais: etat.frais, operationsStandard: sit.operationsStandard, positions: sit.positions.length, engage: sit.engage },
      interdit: sit.interdit,
    }));

    // Feu tient ses niveaux à jour : le sommet repris est noté (sa zone devient un support à retester), puis oublié s'il est recassé
    let change = false;
    for (const p of PAIRES) {
      const n = etat.niveaux[p];
      if (!n.contexte) continue;
      const ctx = lireContexte(marche[p].b4h, marche[p].b1h, n, now);
      if (ctx.repris !== null && !n.contexte.repris) { n.contexte = { ...n.contexte, repris: ctx.repris }; change = true; }
      if (ctx.repris === null && n.contexte.repris) { n.contexte = { prix: n.contexte.prix }; change = true; }
    }
    const signaux = statuts.filter(s => s.statut === 'Signal' && s.plan);
    for (const s of signaux) {
      const p = s.plan!;
      if (!etat.plans.some(x => x.paire === s.paire && x.entree === p.entree && now - x.quand < JOUR)) {
        etat.plans.push({ quand: now, paire: s.paire, entree: p.entree, objectif: p.objectif, stop: p.stop, stopLimite: p.stopLimite });
        change = true;
      }
    }
    const avantPlans = etat.plans.length;
    etat.plans = etat.plans.filter(x => now - x.quand < GARDE_PLANS);
    if (change || etat.plans.length !== avantPlans) await ecrireEtatFeu(kv, etat);

    const passage: PassageFeu = { quand: now, statuts };
    await ecrirePassageFeu(kv, passage);

    const alertes = await alertesDuPassage(kv, etat, statuts, marche, sit, compte, now);
    const envoyes = await envoyer(kv, deps, alertes, statuts, now);
    if (apres) await apres(statuts).catch(() => console.error('feu : suite du passage impossible'));

    const resume = statuts.map(s => `${s.paire.replace('USDT', '')} ${s.statut}`).join(', ');
    if (envoyes.length) await ecrireEtat(kv, { agent: 'feu', statut: 'termine', tache: `prévient : ${envoyes.join(' ; ')}`.slice(0, 140), outil: 'Tg' }, now);
    else await ecrireEtat(kv, { agent: 'feu', statut: 'termine', tache: `lit le marché : ${resume}`.slice(0, 140), outil: 'Bi' }, now, { journal: false });
    return { ok: true, statuts: statuts.map(s => ({ paire: s.paire, statut: s.statut, prix: s.prix, manque: s.manque })), alertes: envoyes };
  });
}

/** Les alertes de ce passage (niveaux, statuts, positions, macro, pause, débriefs), avec leurs marques posées à part. */
async function alertesDuPassage(kv: KV, etat: EtatFeu, statuts: StatutPaire[], marche: Record<Paire, { b1h: Bougie[] }>, sit: ReturnType<typeof situation>, compte: Compte | null, now: number): Promise<Alerte[]> {
  const t = await kv.hgetall(CLES_FEU.alertes);
  const marquer = (champ: string, v = '1') => kv.hset(CLES_FEU.alertes, champ, v);
  const out: Alerte[] = [];
  const statutDe = (p: string) => statuts.find(s => s.paire === p)!;

  // 1. Les niveaux : une bougie 1h terminée qui clôture au-delà (la précédente ne l'était pas). Au premier passage,
  //    on note seulement où on en est (aucune vieille clôture n'est annoncée).
  for (const p of PAIRES) {
    const b = closes(marche[p].b1h, now);
    const derniere = b.at(-1);
    if (!derniere) continue;
    const champ = `vu:${p}`;
    const vu = t[champ] !== undefined ? Number(t[champ]) : null;
    if (vu !== null) {
      for (const n of etat.niveaux[p].surveilles) {
        const au = (c: number) => (n.sens === 'haut' ? c > n.prix : c < n.prix);
        const croise = b.filter((x, i) => x.t > vu && i > 0 && au(x.c) && !au(b[i - 1].c)).at(-1);
        if (croise) out.push({ sujet: `paire:${p}`, texte: messageNiveau(statutDe(p), n, croise), ignorable: true, hors: false });
      }
    }
    if (String(derniere.t) !== t[champ]) await marquer(champ, String(derniere.t));
  }

  // 2. Les statuts : un passage en Surveillance ou en Signal (jamais pour une baisse vers Hypothèse : pas de vibration pour rien)
  const avant = lire<Record<string, string>>(t.statuts) ?? {};
  for (const s of statuts) {
    const a = avant[s.paire];
    if (s.statut === 'Signal' && a !== 'Signal') out.push({ sujet: `signal:${s.paire}`, texte: messageSignal(s, noteFonds(compte)), ignorable: false, hors: true });
    else if (s.statut === 'Surveillance' && a === 'Hypothèse') out.push({ sujet: `paire:${s.paire}`, texte: messageSurveillance(s), ignorable: true, hors: false });
  }
  await marquer('statuts', JSON.stringify(Object.fromEntries(statuts.map(s => [s.paire, s.statut]))));

  // 3. Les positions : à moins de 0,5 % du stop, ou objectif touché (une fois chacun par position)
  for (const pos of sit.positions) {
    const s = statuts.find(x => x.paire === pos.paire);
    if (!s) continue;
    const cle = `pos:${pos.paire}:${pos.ouverture}`;
    if (pos.stop && s.prix > 0 && (s.prix - pos.stop) / pos.stop < 0.005 && !t[`${cle}:stop`]) { out.push({ sujet: `position:${pos.paire}`, texte: messagePositionStop(pos, s.prix, s.lu), ignorable: false, hors: false }); await marquer(`${cle}:stop`); }
    if (pos.objectif && s.prix >= pos.objectif && !t[`${cle}:obj`]) { out.push({ sujet: `position:${pos.paire}`, texte: messagePositionObjectif(pos, s.prix, s.lu), ignorable: false, hors: false }); await marquer(`${cle}:obj`); }
  }

  // 4. Les annonces macro : la veille, puis une heure avant
  for (const a of etat.annonces.filter(x => !x.aConfirmer)) {
    if (now >= a.quand - JOUR && now < a.quand - 75 * MIN && !t[`macro:${a.quand}:veille`]) { out.push({ sujet: `macro:${a.quand}`, texte: messageMacro(a, 'veille'), ignorable: true, hors: false }); await marquer(`macro:${a.quand}:veille`); }
    if (now >= a.quand - 75 * MIN && now < a.quand && !t[`macro:${a.quand}:heure`]) { out.push({ sujet: `macro:${a.quand}`, texte: messageMacro(a, 'heure'), ignorable: true, hors: false }); await marquer(`macro:${a.quand}:heure`); }
  }

  // 5. La pause qui commence ou qui finit
  const pauseAvant = lire<{ jusqua: number; raison: string } | null>(t.pause);
  if (sit.pause && (!pauseAvant || pauseAvant.jusqua !== sit.pause.jusqua)) out.push({ sujet: 'pause', texte: messagePause(true, sit.pause.raison, sit.pause.jusqua), ignorable: false, hors: false });
  if (!sit.pause && pauseAvant) out.push({ sujet: 'pause', texte: messagePause(false, pauseAvant.raison, null), ignorable: false, hors: false });
  await marquer('pause', JSON.stringify(sit.pause));

  // 6. Le débrief en cinq lignes, à chaque clôture (une fois par opération ; au premier compte lu, l'historique est seulement noté)
  const debriefes = lire<number[]>(t.debriefs);
  const clotures = sit.operations.map(o => o.cloture);
  if (debriefes) {
    for (const o of sit.operations.filter(x => !debriefes.includes(x.cloture))) {
      const j = sit.journal;
      const resume = `Journal : ${j.operations} opération(s), ${j.gagnantes} gagnante(s), ${j.perdantes} perdante(s), net ${usdt(j.net)}, frais ${usdt(j.frais)}${j.plansRespectes !== null ? `, plans respectés ${Math.round(j.plansRespectes * 100)} %` : ''}.`;
      out.push({ sujet: `debrief:${o.paire}`, texte: messageDebrief(o.paire, debrief(o, sit.capital.montant), resume), ignorable: false, hors: true });
    }
  }
  if (compte?.cle === 'ok' && JSON.stringify(debriefes) !== JSON.stringify(clotures)) await marquer('debriefs', JSON.stringify(clotures));
  return out;
}

/**
 * L'envoi : un Signal ou un débrief part seul ; le reste est regroupé en un seul message (une vibration), avec un
 * bouton « Ignorer » par sujet. Plafond : 6 messages d'alerte par jour (hors Signal et débrief) ; au-delà, l'alerte est
 * gardée dans la page. La pause générale garde tout pour sa fin (src/server/silence.ts).
 */
async function envoyer(kv: KV, deps: DepsFeu, alertes: Alerte[], statuts: StatutPaire[], now: number): Promise<string[]> {
  if (!alertes.length) return [];
  const ignores = await lireIgnoresFeu(kv);
  // un ignoré tombe tout seul après 24 h, ou quand le statut de la paire a changé
  const actifs = new Set<string>();
  for (const [sujet, i] of Object.entries(ignores)) {
    const paire = sujet.startsWith('paire:') ? sujet.slice(6) : null;
    const statut = paire ? statuts.find(s => s.paire === paire)?.statut : undefined;
    if (now - i.depuis > IGNORE_MAX || (paire && i.statut && statut && statut !== i.statut)) await kv.hdel(CLES_FEU.ignores, sujet);
    else actifs.add(sujet);
  }
  const dits: string[] = [];
  const resumeDe = (a: Alerte) => a.texte.split('\n')[0].replace(/^🔥 Feu · /, '').slice(0, 70);
  for (const a of alertes.filter(x => x.hors)) {
    try { await envoyerAlerte(kv, deps.envoyer, a.texte, undefined, now); await noterMessage(kv, { quand: now, texte: a.texte, envoye: true, sujets: [a.sujet] }); dits.push(resumeDe(a)); } catch {
      console.error('feu : envoi Telegram échoué');
      await noterMessage(kv, { quand: now, texte: a.texte, envoye: false, raison: 'Telegram n\'a pas répondu', sujets: [a.sujet] });
    }
  }
  const autres = alertes.filter(x => !x.hors);
  const tues = autres.filter(a => a.ignorable && actifs.has(a.sujet));
  for (const a of tues) await noterMessage(kv, { quand: now, texte: a.texte, envoye: false, raison: 'ignoré par toi', sujets: [a.sujet] });
  const reste = autres.filter(a => !tues.includes(a));
  if (!reste.length) return dits;
  const champ = `jour:${jour(now)}`;
  const deja = Number((await kv.hmget(CLES_FEU.alertes, [champ]))[champ] ?? 0);
  const texte = reste.map(a => a.texte).join('\n\n');
  const sujets = [...new Set(reste.map(a => a.sujet))];
  if (deja >= ALERTES_PAR_JOUR) {
    await noterMessage(kv, { quand: now, texte, envoye: false, raison: `plafond de ${ALERTES_PAR_JOUR} alertes par jour atteint`, sujets });
    return dits;
  }
  const boutons = [...new Set(reste.filter(a => a.ignorable).map(a => a.sujet))].map(s => [boutonIgnorer(s)]);
  try {
    await envoyerAlerte(kv, deps.envoyer, texte, boutons.length ? boutons : undefined, now);
    await kv.hincrby(CLES_FEU.alertes, champ, 1);
    await noterMessage(kv, { quand: now, texte, envoye: true, sujets });
    dits.push(...reste.map(resumeDe));
  } catch {
    console.error('feu : envoi Telegram échoué');
    await noterMessage(kv, { quand: now, texte, envoye: false, raison: 'Telegram n\'a pas répondu', sujets });
  }
  return dits;
}

/** Le bouton « Ignorer » (`fei:<sujet>`) : plus de message pour ce sujet pendant 24 h, ou jusqu'à ce que le statut change. */
export async function ignorerSujet(kv: KV, sujet: string, now: number): Promise<string> {
  if (!/^(paire:(BTCUSDT|ETHUSDT)|macro:\d{10,15})$/.test(sujet)) return 'Je ne sais pas quoi ignorer.';
  const paire = sujet.startsWith('paire:') ? sujet.slice(6) : null;
  const passage = await lirePassageFeu(kv);
  const statut = paire ? passage?.statuts.find(s => s.paire === paire)?.statut : undefined;
  await kv.hset(CLES_FEU.ignores, sujet, JSON.stringify({ depuis: now, ...(statut ? { statut } : {}) } satisfies Ignore));
  return paire
    ? `D'accord : plus d'alerte de niveau sur ${nomPaire(paire)} pendant 24 h, ou jusqu'à ce que son statut change. Un Signal te sera toujours envoyé.`
    : 'D\'accord : je ne te reparle plus de cette annonce. La fenêtre sans entrée reste appliquée.';
}

/** « reprends Feu » : tout ce qui était ignoré chez Feu revient. */
export async function reprendreFeu(kv: KV): Promise<number> {
  const tous = Object.keys(await kv.hgetall(CLES_FEU.ignores));
  for (const s of tous) await kv.hdel(CLES_FEU.ignores, s);
  return tous.length;
}

