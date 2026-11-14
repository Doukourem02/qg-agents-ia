import { ROUTINES, prochainCreneau, type Creneau, type VuesQG } from './vues';

// Les faits déjà rédigés pour Kuroro : des phrases prêtes à dire, construites ici à partir des vraies vues du QG,
// pour que le modèle (petit, local) n'ait rien à calculer : ce que chaque agent a fait aujourd'hui et à quelle heure,
// où arrive son travail (la page ou Telegram, quels jours), et le moment de la journée. Plus de « devrait ».
// Rien d'heure relative (« il y a 5 min ») : ces phrases ne changent qu'avec l'état, le début du prompt reste lu.
// Heure d'Abidjan = UTC.

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']; // 0 = lundi, comme ROUTINES
const JOURS_UTC = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (t: number) => { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const jourUTC = (t: number) => Math.floor(t / JOUR);

/**
 * Où arrive le travail de chaque routine (voir docs/La quotidienne.md, « Ce qui arrive sur Telegram »).
 * Chaque routine de ROUTINES doit avoir la sienne (test).
 */
export const OU: Record<string, string> = {
  'l-sujets': 'sur Telegram',
  'l-redaction': 'sur Telegram, pour ton accord',
  'light-releve': 'dans la page ; sur Telegram seulement s’il y a une alerte',
  'light-relance': 'sur Telegram, seulement si tu n’as pas vu le relevé',
  'clara-menage': 'sur Telegram (Oui/Non), seulement s’il y a de nouveaux expéditeurs',
  'mafe-point': 'dans la page (son bureau), pas sur Telegram',
  'mafe-mardi': 'sur Telegram',
  'mafe-vendredi': 'sur Telegram',
  'zoro-securite': 'dans la page ; sur Telegram seulement si c’est important',
  'paul-readme': 'sur Telegram (Valider/Refuser)',
  'ye-portfolio': 'sur Telegram (Valider/Refuser), seulement si une fiche a bougé',
  'feu-analyse': 'sur Telegram, quatre fois par jour (08:00, 12:00, 16:00, 20:00)',
  'kuroro-matin': 'sur Telegram, un seul message, même si tout va bien',
  'qg-missions': 'sur Telegram, le résultat de chaque mission ; seulement s’il y a des missions en attente',
};

/** Ceux qui passent en continu, hors créneaux (une phrase fixe). */
export const CONTINU: Record<string, string> = {
  L: 'Sa boîte est relevée chaque heure (tes notes sur les posts en cours).',
  clara: 'Chaque heure à h05, elle met à la corbeille les mails des bannis, sans t’écrire.',
  luffy: 'Il vérifie tes 6 sites toutes les 5 min ; sur Telegram seulement si un site tombe (après 2 échecs), puis quand il revient.',
  isaac: 'Toutes les 5 min, Mac allumé, il fait ce que tu as accepté et mesure la place chaque heure ; sur Telegram pour une proposition sur ton Mac ou la réponse à une mission.',
  lea: 'Elle relit tes pushes chaque heure (h23) ; sur Telegram seulement pour une faille grave.',
};

/** « du lundi au vendredi », « chaque jour », « le mardi et le jeudi ». */
function lesJours(jours: number[]) {
  if (jours.length === 7) return 'chaque jour';
  if (jours.length === 5 && jours.every((j, i) => j === i)) return 'du lundi au vendredi';
  const noms = jours.map(j => JOURS[j]);
  return `le ${noms.length > 1 ? `${noms.slice(0, -1).join(', le ')} et le ${noms.at(-1)}` : noms[0]}`;
}
/** « à 14:00 et 19:00 », ou « toutes les heures de 08:00 à 20:00 » pour un passage horaire. */
const lesHeures = (heures: string[]) => {
  const pleines = heures.map(h => Number(h.slice(0, 2)));
  if (heures.length >= 4 && heures.every(h => h.endsWith(':00')) && pleines.every((h, i) => i === 0 || h === pleines[i - 1] + 1)) {
    return `toutes les heures de ${heures[0]} à ${heures.at(-1)}`;
  }
  return `à ${heures.length > 1 ? `${heures.slice(0, -1).join(', ')} et ${heures.at(-1)}` : heures[0]}`;
};

/** Le titre sans « (Telegram) » : la phrase dit déjà où il arrive. */
const titre = (t: string) => t.replace(/\s*\(Telegram\)/, '');

/** Où arrive le travail de l'agent, toute la semaine : une phrase par routine, plus son rythme continu. */
export function ouArrive(agent: string, now: number): string[] {
  const phrases = ROUTINES.filter(r => r.agent === agent).map(r => {
    const etat = r.pause !== undefined && r.pause <= now ? ' (en pause pour l’instant)' : r.actif !== undefined && r.actif > now ? ' (pas encore en service)' : '';
    return `${titre(r.titre)} : ${lesJours(r.jours)} ${lesHeures(r.heures)}, ${OU[r.id] ?? 'dans la page'}${etat}.`;
  });
  return CONTINU[agent] ? [...phrases, CONTINU[agent]] : phrases;
}

/** « aujourd’hui à 18:00 », « demain vendredi à 08:15 », « lundi 16 à 07:00 ». */
export function quand(t: number, now: number) {
  const ecart = jourUTC(t) - jourUTC(now), d = new Date(t);
  return `${ecart === 0 ? 'aujourd’hui' : ecart === 1 ? `demain ${JOURS_UTC[d.getUTCDay()]}` : `${JOURS_UTC[d.getUTCDay()]} ${d.getUTCDate()}`} à ${hm(t)}`;
}

/** Un créneau d'aujourd'hui, dit tel qu'il est (null : rien à en dire, une relance qui n'a pas lieu d'être). */
function phraseCreneau(c: Creneau, now: number, prochain: string | null): string | null {
  const ou = OU[c.routine] ?? 'dans la page', t = titre(c.titre);
  // un passage conditionnel (relances, missions) ne se dit que s'il a eu lieu, ou s'il était attendu et n'a pas eu lieu
  if (c.conditionnel && c.etat !== 'fait' && c.etat !== 'rate') return null;
  switch (c.etat) {
    case 'fait': return `${t} : fait aujourd’hui à ${hm(c.entree?.quand ?? c.quand)}, ${ou}.`;
    case 'rate': return `${t} : raté aujourd’hui (prévu à ${c.heure}, rien n’est arrivé).`;
    case 'a-venir': return c.conditionnel ? null : c.quand > now
      ? `${t} : pas encore passé aujourd’hui, prévu à ${c.heure}, ${ou}.`
      : `${t} : prévu à ${c.heure}, pas encore fini (compté raté s’il n’a rien envoyé à ${hm(c.quand + H)}).`;
    case 'pause': return `${t} : en pause par le patron (prévu à ${c.heure}, rien n’est fait pour l’instant).`;
    case 'rien-a-faire': return `${t} : rien à faire aujourd’hui.`;
    case 'inactif': return `${t} : pas aujourd’hui (pas encore en service à ${c.heure})${prochain ? ` ; le premier : ${prochain}` : ''}.`;
    default: return null;
  }
}

/** Ce que l'agent a fait aujourd'hui et ce qui reste, en phrases prêtes à dire. */
export function aujourdhui(agent: string, vues: VuesQG, now: number): string[] {
  const { creneaux, aujourdhui: jour, lundi } = vues.calendrier;
  const prochain = prochainCreneau(agent, lundi, now);
  const p = prochain ? quand(prochain.quand, now) : null;
  const duJour = creneaux.filter(c => c.agent === agent && c.jour === jour);
  // « QG · missions » passe chaque heure : une seule phrase pour ses passages faits, pas une par heure
  const missions = duJour.filter(c => c.routine === 'qg-missions' && c.etat === 'fait');
  const phrases = duJour.filter(c => !missions.includes(c)).flatMap(c => phraseCreneau(c, now, p) ?? []);
  if (missions.length) phrases.push(`QG · missions : ${missions.length > 1 ? `${missions.length} passages avec des missions aujourd’hui, le dernier` : 'des missions faites aujourd’hui'} à ${hm(missions.at(-1)!.quand)}, ${OU['qg-missions']}.`);
  if (!ROUTINES.some(r => r.agent === agent)) return phrases;
  if (!phrases.length) return [`Rien de prévu aujourd’hui (${JOURS_UTC[new Date(now).getUTCDay()]})${prochain ? ` ; prochain passage : ${prochain.titre}, ${p}` : ''}.`];
  // le prochain passage, s'il n'est pas déjà dit (un passage plus tard aujourd'hui)
  const dejaDit = prochain && jourUTC(prochain.quand) === jourUTC(now);
  return prochain && !dejaDit && !phrases.some(x => x.includes('le premier')) ? [...phrases, `Prochain passage : ${prochain.titre}, ${p}.`] : phrases;
}

/** « il est 07:53, jeudi matin (12 novembre 2026) ». */
export function moment(now: number): string {
  const d = new Date(now), h = d.getUTCHours();
  const partie = h < 4 ? 'dans la nuit' : h < 12 ? 'matin' : h < 14 ? 'midi' : h < 18 ? 'après-midi' : h < 22 ? 'soir' : 'soir, tard';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `il est ${hm(now)}, ${JOURS_UTC[d.getUTCDay()]} ${partie} (${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()})`;
}

// ───────────── Les faits utiles à son message ─────────────

/** De qui parle son message (sans accents, en minuscules) : le nom de l'agent, ou ce dont il s'occupe. */
const SUJETS: [string, RegExp][] = [
  ['mafe', /\bmafe\b|point du matin|\ble point\b|\bbilan\b|ou je me suis arrete/],
  ['light', /\blight\b|\breleve\b|\bversions?\b|\bveille\b/],
  ['clara', /\bclara\b|\bmails?\b|\bcourriers?\b|\bexpediteurs?\b|\bcorbeille\b|\bgmail\b/],
  ['luffy', /\bluffy\b|\bsites?\b|\ben panne\b|\bhors ligne\b/],
  ['isaac', /\bisaac\b|\bmac\b|\bcache\b|\bdisque\b|\bnode_modules\b/],
  ['zoro', /\bzoro\b|\bsecurite\b|\bfailles?\b|\bcles?\b/],
  ['lea', /\blea\b|\bpush(es)?\b|\brelecture\b|\bbugs?\b|\bcommits?\b/],
  ['paul', /\bpaul\b|\breadme\b|\bclaude\.?md\b/],
  ['ye', /\bye\b|\bportfolio\b|\bfiches?\b|\bsanity\b/],
  ['feu', /\bfeu\b|\btrad(ing|er)\b|\bbinance\b|\bcrypto|\bbtc\b|\beth\b|\bbitcoin\b|\bethereum\b/],
  ['L', /\blinkedin\b|\bposts?\b|\bsujets?\b|\bbrouillons?\b/],
  ['kuroro', /\bcompte rendu\b|\btelegram\b|\bkuroro\b/],
];
/** « Y a un truc urgent ? », « tout roule ? » : ce qui l'attend. */
const TOUR_D_HORIZON = /\burgent|\btout roule|\bca roule|\bquoi de neuf|\bdu nouveau|\bca va au qg|\bla boite|\bresume|\bun probleme|\bdes problemes|\btout va bien|\btout est ok/;

type FaitsRediges = {
  agents: { id: string; nom: string; ou_arrive?: string[]; faits?: string[] }[];
  aujourd_hui: Record<string, string[]>;
  ce_qui_t_attend: string[];
};

/** Les agents dont parle son message (leur nom, ou ce dont ils s'occupent). */
export function sujetsDe(message: string): string[] {
  const t = message.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
  // L, seul et en majuscule (« et L ? ») : « l » est partout en minuscules (« l'a », « l'heure »)
  return SUJETS.filter(([id, r]) => r.test(t) || (id === 'L' && /(^|[\s,(])L($|[\s,?!.)])/.test(message))).map(([id]) => id);
}

/**
 * Les faits utiles à son dernier message, redits juste avant la fin du prompt : un petit modèle mélange les agents
 * quand la réponse est au milieu de 4 700 jetons. Les agents dont il parle (leur journée, où arrive leur travail, ce
 * qu'ils savent), et ce qui l'attend pour un tour d'horizon. '' si le message ne parle de rien de connu.
 */
export function aProposDe(message: string, f: FaitsRediges): string {
  const t = message.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
  const ids = sujetsDe(message);
  const lignes = ids.flatMap(id => {
    const a = f.agents.find(x => x.id === id);
    if (!a) return [];
    const nom = id === 'kuroro' ? 'Kuroro (toi)' : a.nom;
    const morceaux = [...(f.aujourd_hui[nom] ?? []), ...(a.ou_arrive ?? []), ...(a.faits ?? [])];
    return morceaux.length ? [`${nom} : ${morceaux.join(' ')}`] : [];
  });
  if (TOUR_D_HORIZON.test(t) || (!lignes.length && /\?\s*$/.test(message.trim()))) lignes.push(`Ce qui t'attend : ${f.ce_qui_t_attend.join(' ')}`);
  if (!lignes.length) return '';
  return `Les faits utiles à son message (seulement ceux-là ; ce qui n'y est pas, tu ne le sais pas) :\n${lignes.join('\n')}`;
}

// ───────────── Le filet : une heure fausse dans la réponse ─────────────

/**
 * Pour chaque agent : ce qu'on sait de lui (les heures permises) et sa journée (la phrase à redire telle quelle) ;
 * `statuts` : où en est chaque agent au moment de la demande (src/server/kuroro.ts, statutsMission), pour la phrase
 * d'une mission écrite par le code.
 */
export type Controle = { agents: { nom: string; sait: string; journee: string[] }[]; tout: string; statuts?: Record<string, string>; /** Les agents en pause et leur phrase. */ pauses?: Record<string, string> };

/** Le contrôle gardé avec la demande (quelques centaines de caractères) : il sert à relire la réponse du modèle local. */
export function controleDe(f: FaitsRediges & { agents: { dernier_passage?: string }[] }): Controle {
  const agents = f.agents.flatMap(a => {
    const nom = a.id === 'kuroro' ? 'Kuroro (toi)' : a.nom, journee = f.aujourd_hui[nom] ?? [];
    const sait = [...journee, ...(a.ou_arrive ?? []), ...(a.faits ?? []), (a as { dernier_passage?: string }).dernier_passage ?? ''].join(' ');
    return heures(sait).length ? [{ nom, sait, journee }] : [];
  });
  return { agents, tout: JSON.stringify(f) };
}

/** Les heures d'un texte, au format 07:38 (« 07:38 », « 7h38 », « 7 h 38 », « 8 h »). */
export function heures(t: string): string[] {
  return [...t.matchAll(/\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?(?!\d)/gi)].flatMap(m => {
    const h = Number(m[1]), mn = m[2] ?? '00';
    return h < 24 && Number(mn) < 60 ? [`${String(h).padStart(2, '0')}:${mn}`] : [];
  });
}

const nomSimple = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FAIT = /\b(a|l a|ont|est|a ete|l ai|j ai) (fait|faite|passe|passee|envoye|envoyee|termine|terminee|fini|finie|recu)\b/;

/**
 * La réponse relue : une phrase qui donne une heure qu'aucun fait ne donne (07:37 au lieu de 07:38), ou qui dit
 * « fait à 18:00 » quand 18:00 n'est qu'une heure prévue, est retirée, et la journée de l'agent dont elle parlait est
 * redite mot pour mot. '' s'il ne reste rien.
 */
export function corrigerHeures(texte: string, c: Controle): string {
  const phrases = texte.match(/[^.!?…]+[.!?…]*/g) ?? [texte];
  const aRedire: Controle['agents'] = [];
  let dernier: Controle['agents'][number] | undefined;
  const gardees = phrases.filter(p => {
    const s = nomSimple(p).replace(/[’']/g, ' ');
    // L : seul et en majuscule (« l'a » n'est pas L)
    const nomme = c.agents.find(a => a.nom === 'L' ? /(^|[\s,(])L($|[\s,?!.):])/.test(p) : new RegExp(`\\b${nomSimple(a.nom.replace(/ \(toi\)$/, ''))}\\b`).test(s));
    // « elle l'a fait à 07:37 » : l'agent de la phrase d'avant
    const agent = nomme ?? (/\b(il|elle|son|sa)\b/.test(s) ? dernier : undefined);
    if (nomme) dernier = nomme;
    const hs = heures(p);
    if (!hs.length) return true;
    const sait = agent ? agent.sait : c.tout;
    // « il a fait … à 18:00 » : au moins une de ses heures doit être une heure faite, pas seulement prévue
    const faite = (h: string) => !!agent && [`fait aujourd’hui à ${h}`, `aujourd’hui ${h} :`, `hier ${h} :`].some(x => agent.sait.includes(x));
    const faux = hs.some(h => !sait.includes(h)) || (!!agent && FAIT.test(s) && !hs.some(faite));
    if (faux && agent && agent.journee.length && !aRedire.includes(agent)) aRedire.push(agent);
    return !faux;
  });
  const redites = aRedire.map(a => `${a.nom.replace(/ \(toi\)$/, '')} : ${a.journee[0]}`).filter(r => !gardees.join('').includes(r));
  return [...gardees, ...redites.map(r => ` ${r}`)].join('').replace(/\s+/g, ' ').trim();
}
