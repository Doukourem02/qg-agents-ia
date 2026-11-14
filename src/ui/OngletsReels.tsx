'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { BUREAU_PAR_AGENT, estBureau, useQG, type Onglet } from '@/store';
import { NOM_STATUT, autresEtapes, detailAgent, prochainEnMots, quandCourt, regrouper, resumeAgent, type GroupeAgent } from '@/data/journal';
import { LigneFaite } from './BureauAgent';
import { POLES, agentById, poleById } from '@/sim/routing';
import type { Creneau, EtatAgent, VuesQG } from '@/server/vues';
import { nomCourt, type ReunionVue } from '@/data/crise';
import { OMBRE_CARTE, Puce, Tete } from './Panels';
import { estEteint, regrouperRelances, resumePoints } from './calendrier';
import { BandeauPause, ListeIgnores } from './Silence';

// Les onglets Tâches, Calendrier et Cerveau (Cerveau.tsx) : seulement des données réelles, lues sur /api/qg/vues.
// Page privée seulement : rien n'est lu ni monté dans /demo (les trois onglets y sont cachés).

/** Les onglets qui lisent les vraies données. */
export const ONGLETS_REELS: Onglet[] = ['taches', 'calendrier', 'cerveau'];

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const ROUGE = '#d23b3b', GRIS = '#9b98ab';

// Heure d'Abidjan = UTC
const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const date = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const jourDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nom = (id: string) => agentById(id)?.nom ?? id;
const couleur = (id: string) => poleById(agentById(id)?.pole ?? '')?.couleur ?? '#6b6880';

/** Le numéro de la dernière lecture lancée, partagé avec les écritures du Cerveau (majCerveau). */
const lecture = { n: 0 };

/**
 * Après une écriture du Cerveau : la réponse du serveur remplace la partie changée, et une lecture partie
 * avant l'écriture (plus ancienne) ne la fait pas revenir en arrière.
 */
export function majCerveau(maj: Partial<VuesQG['cerveau']>) {
  lecture.n++;
  const v = useQG.getState().vues;
  if (v) useQG.setState({ vues: { ...v, cerveau: { ...v.cerveau, ...maj } } });
}

/**
 * Lit /api/qg/vues hors /demo : toutes les 20 s quand un des trois onglets ou un bureau d'agent est ouvert,
 * sinon toutes les 2 min (compteurs de la barre, « En ce moment » des fiches). Une réponse plus ancienne n'écrase jamais une plus fraîche.
 */
export function useVuesQG(demo: boolean) {
  const ouvert = useQG(s => ONGLETS_REELS.includes(s.onglet) || estBureau(s.volet));
  const lire = useCallback(async () => {
    const n = ++lecture.n;
    try {
      const r = await fetch('/api/qg/vues', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VuesQG;
      if (n === lecture.n) useQG.setState({ vues: v, vuesHorsLigne: false });
    } catch {
      if (n === lecture.n) useQG.setState({ vuesHorsLigne: true });
    }
  }, []);
  useEffect(() => {
    if (demo) return;
    let arret = false;
    const tour = () => { if (!arret) void lire(); };
    tour();
    const t = setInterval(tour, ouvert ? 20_000 : 120_000);
    return () => { arret = true; clearInterval(t); };
  }, [demo, ouvert, lire]);
}

function Attente({ children }: { children: ReactNode }) {
  return <p className="text-[8px] text-[#6b6880]">{children}</p>;
}

function useEtat() {
  const vues = useQG(s => s.vues);
  const horsLigne = useQG(s => s.vuesHorsLigne);
  const message = horsLigne && !vues ? 'Pas de connexion au serveur.' : !vues ? 'Lecture…' : null;
  return { vues, message, horsLigne };
}

// ───────────────────────── Tâches ─────────────────────────

const VERT = '#2f9c5a', ORANGE = '#e0a42a';
const STATUT: Record<EtatAgent['statut'], { c: string; t: string }> = {
  'au travail': { c: '#fff1d6', t: '#a8700f' },
  'au repos': { c: '#f1f0f5', t: '#6b6880' },
  bloque: { c: '#fbe1e1', t: ROUGE },
};
const FILTRES_AGENTS = [[null, 'Tous'], ['L', 'L'], ['light', 'Light'], ['clara', 'Clara'], ['mafe', 'Mafe'], ['luffy', 'Luffy'], ['isaac', 'Isaac'], ['zoro', 'Zoro'], ['lea', 'Léa'], ['paul', 'Paul'], ['ye', 'Ye'], ['feu', 'Feu']] as const;
const FILTRES_PERIODE = [['jour', 'Aujourd’hui'], ['semaine', '7 jours']] as const;

/** La couleur d'un agent : celle du pôle qu'il dirige, sinon de son pôle. */
function couleurDe(id: string) {
  const dirige = POLES.find(p => p.chef === id && p.id !== 'direction');
  return dirige?.couleur ?? couleur(id);
}

/** Apparition douce, l'une après l'autre (rien si l'animation est réduite). */
function useApparition() {
  const reduit = useReducedMotion();
  return (rang: number) => reduit ? {} : {
    initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 },
    transition: { delay: 0.03 + Math.min(rang, 12) * 0.04, duration: 0.28, ease: 'easeOut' as const },
  };
}

/** Un choix parmi quelques-uns, en pastilles collées. */
function Segments<T extends string | null>({ options, valeur, choisir, nom }: {
  options: readonly (readonly [T, string])[]; valeur: T; choisir: (v: T) => void; nom: string;
}) {
  return (
    <div role="group" aria-label={nom} className="inline-flex flex-wrap rounded-[8px] bg-[#f1f0f5] p-[2px]">
      {options.map(([id, n]) => (
        <button key={n} onClick={() => choisir(id)} aria-pressed={valeur === id}
          className={`rounded-[6px] px-[8px] py-[2.5px] text-[8px] font-semibold transition-[background-color,color,box-shadow] ${valeur === id ? 'bg-white text-[#1d1b2e] shadow-[0_1px_2px_rgba(40,30,90,.14)]' : 'text-[#6b6880] hover:text-[#1d1b2e]'}`}>
          {n}
        </button>
      ))}
    </div>
  );
}

function Titre({ children, n }: { children: ReactNode; n?: number }) {
  return <h3 className="mb-[7px] text-[10.5px] font-bold tracking-[-0.01em]">{children}{n !== undefined && <span className="font-normal text-[#8a879c]"> {n}</span>}</h3>;
}

/** Une case du bandeau du haut : un chiffre réel, une ligne d'explication. */
function Stat({ titre, valeur, sous, fort, rang }: { titre: string; valeur: ReactNode; sous?: ReactNode; fort?: boolean; rang: number }) {
  const apparait = useApparition();
  return (
    <motion.div {...apparait(rang)}
      className={`min-w-0 rounded-[11px] border px-[11px] py-[8px] ${fort ? 'border-[#f3d7a0] bg-[#fff8ea]' : 'border-[#ecebf2] bg-white'} ${OMBRE_CARTE}`}>
      <div className={`text-[7.5px] font-semibold uppercase tracking-[0.06em] ${fort ? 'text-[#a8700f]' : 'text-[#8a879c]'}`}>{titre}</div>
      <div className="mt-[2px] truncate text-[15px] font-bold leading-tight tracking-[-0.02em]">{valeur}</div>
      {sous && <div className="mt-[1px] truncate text-[7.5px] text-[#6b6880]">{sous}</div>}
    </motion.div>
  );
}

/** Ce qui m'attend : une carte qui ouvre le bureau de l'agent. */
function CarteAttente({ x, rang }: { x: VuesQG['taches']['enAttente'][number]; rang: number }) {
  const ouvrir = useQG(s => s.ouvrir);
  const apparait = useApparition();
  return (
    <motion.button {...apparait(rang)} onClick={() => ouvrir({ type: x.ouvre })}
      className={`relative flex w-full items-center gap-[8px] overflow-hidden rounded-[10px] border border-[#f3d7a0] bg-[#fff8ea] py-[7px] pl-[11px] pr-[10px] text-left ${OMBRE_CARTE} transition-[transform,box-shadow] duration-150 hover:-translate-y-[1px] hover:shadow-[0_2px_4px_rgba(40,30,90,.08),0_8px_22px_rgba(40,30,90,.12)]`}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: ORANGE }} />
      <Tete id={x.agent} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-semibold leading-snug">{x.texte}</span>
        <span className="block text-[7.5px] text-[#8a6a2a]">{nom(x.agent)} · ouvrir son bureau →</span>
      </span>
      {x.nombre ? <Puce c="#1d1b2e" t="#fff">{x.nombre}</Puce> : null}
    </motion.button>
  );
}

/** Un agent réel : visage, état, dernier et prochain passage. Au clic, son bureau. */
function CarteEtat({ a, now, rang }: { a: EtatAgent; now: number; rang: number }) {
  const ouvrir = useQG(s => s.ouvrir);
  const apparait = useApparition();
  const p = BUREAU_PAR_AGENT[a.agent];
  const s = STATUT[a.statut];
  const prochain = prochainEnMots(a, now);
  return (
    <motion.button {...apparait(rang)} onClick={() => { if (p) ouvrir({ type: p }); }}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-[#ecebf2] bg-white px-[9px] pb-[7px] pt-[9px] text-left ${OMBRE_CARTE} transition-[transform,box-shadow] duration-150 hover:-translate-y-[1px] hover:shadow-[0_2px_4px_rgba(40,30,90,.08),0_8px_22px_rgba(40,30,90,.12)]`}>
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: couleurDe(a.agent) }} />
      <span className="flex w-full items-center gap-[7px]">
        <Tete id={a.agent} size={24} />
        <b className="min-w-0 flex-1 truncate text-[10px] leading-tight">{a.nom}</b>
        <Puce c={s.c} t={s.t}>{NOM_STATUT[a.statut]}</Puce>
      </span>
      <span className="mt-[5px] block space-y-[1px] text-[7.5px] leading-snug text-[#6b6880]">
        {a.statut === 'au travail' && a.tache && <span className="block truncate font-semibold text-[#1d1b2e]">{a.tache}</span>}
        <span className="block truncate">dernier passage {a.dernierPassage ? quandCourt(a.dernierPassage.quand, now) : 'aucun pour l’instant'}</span>
        {a.pause ? <span className="block truncate font-semibold" style={{ color: GRIS }}>{a.pause}</span>
          : a.note ? <span className="block truncate font-semibold" style={{ color: ROUGE }}>{a.note}</span>
          : a.statut === 'bloque' ? <span className="block truncate font-semibold" style={{ color: ROUGE }}>passage prévu manqué aujourd’hui</span>
          : <span className="block truncate">{a.rythme ? 'passe ' : 'prochain '}{prochain ?? 'aucun prévu'}</span>}
      </span>
    </motion.button>
  );
}

/** Un agent dans une journée : une ligne de résumé (résultats, erreurs, actions, le reste compté) ; le détail au clic. */
function GroupeFait({ g, ouvert, basculer, rang }: { g: GroupeAgent; ouvert: boolean; basculer: () => void; rang: number }) {
  const apparait = useApparition();
  const reduit = useReducedMotion();
  const r = resumeAgent(g.lignes);
  const detail = detailAgent(g.lignes);
  const depliable = detail.length > 1;
  const morceaux: ReactNode[] = [
    ...r.resultats.map(t => <span key={`r${t}`} className="font-semibold" style={{ color: VERT }}>{t}</span>),
    ...r.erreurs.map(t => <span key={`e${t}`} className="font-semibold" style={{ color: ROUGE }}>{t}</span>),
    ...r.actions.map(t => <span key={`a${t}`}>{t}</span>),
    ...(r.autres ? [<span key="autres" className="text-[#8a879c]">{autresEtapes(r.autres)}</span>] : []),
  ];
  const entete = (
    <>
      <Tete id={g.agent} size={20} />
      <span className="min-w-0 flex-1 text-[8.5px] leading-[1.45]">
        <b>{nom(g.agent)}</b>
        {morceaux.map((m, i) => <span key={i}><span className="text-[#c9c6d6]"> · </span>{m}</span>)}
      </span>
      <span className="flex-none text-[7px] tabular-nums text-[#8a879c]">{heure(detail[0].quand)}</span>
      {depliable && <ChevronRight size={10} strokeWidth={2.4} aria-hidden className={`flex-none text-[#9b98ab] transition-transform duration-150 ${ouvert ? 'rotate-90' : ''}`} />}
    </>
  );
  const ligne = 'flex w-full items-start gap-[7px] py-[6px] pl-[11px] pr-[9px] text-left';
  return (
    <motion.div {...apparait(rang)} className={`relative overflow-hidden rounded-[10px] border bg-white ${ouvert ? 'border-[#dcdae6]' : 'border-[#ecebf2]'} ${OMBRE_CARTE}`}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: couleurDe(g.agent) }} />
      {depliable
        ? <button onClick={basculer} aria-expanded={ouvert} className={`${ligne} hover:bg-[#faf9fc]`}>{entete}</button>
        : <div className={ligne}>{entete}</div>}
      <AnimatePresence initial={false}>
        {ouvert && depliable && (
          <motion.div key="detail" initial={reduit ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={reduit ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
            <div className="mb-[6px] ml-[11px] mr-[9px] border-t border-[#f1f0f5] pl-[27px] pt-[3px]">
              {detail.map((l, i) => <LigneFaite key={`${l.quand}-${i}`} l={l} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const Vide = ({ children }: { children: ReactNode }) => (
  <p className="rounded-[10px] bg-[#faf9fc] px-[10px] py-[8px] text-[8.5px] leading-snug text-[#8a879c]">{children}</p>
);

export function Taches() {
  const { vues, message, horsLigne } = useEtat();
  const haut = useQG(s => s.format === 'haut');
  const apparait = useApparition();
  const [agent, setAgent] = useState<string | null>(null);
  const [periode, setPeriode] = useState<'jour' | 'semaine'>('semaine');
  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set());
  if (!vues) return <Attente>{message}</Attente>;
  const t = vues.taches;
  const now = vues.maintenant;
  const garde = (a: string) => !agent || a === agent;
  const aujourdHui = vues.calendrier.jours[vues.calendrier.aujourdhui]; // le jour lu par le serveur (UTC)
  // le bandeau du haut : tout le QG, sans filtre
  const duJour = t.faites.filter(x => jourDe(x.quand) === aujourdHui);
  const erreursDuJour = duJour.filter(x => x.erreur).length;
  const prochain = vues.agents.flatMap(a => (a.prochainPassage ? [{ agent: a.agent, ...a.prochainPassage }] : [])).sort((a, b) => a.quand - b.quand)[0];
  const enAttente = t.enAttente.filter(x => garde(x.agent));
  const ignores = (vues.silence?.ignores ?? []).filter(x => garde(x.agent));
  const agents = vues.agents.filter(a => garde(a.agent));
  const faites = t.faites.filter(x => garde(x.agent) && (periode === 'semaine' || jourDe(x.quand) === aujourdHui));
  const jours = regrouper(faites, aujourdHui);
  const basculer = (k: string) => setOuverts(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const colonne = haut ? 'space-y-[16px]' : 'min-h-0 space-y-[16px] overflow-y-auto pb-[8px] pr-[6px]';
  let rang = 0;
  return (
    <div className={haut ? 'space-y-[12px]' : 'flex h-full flex-col gap-[12px]'}>
      {t.alerte && (
        <div className="flex-none rounded-[9px] border border-[#f3c4c4] bg-[#fdf0f0] px-[10px] py-[6px] text-[8.5px] font-semibold" style={{ color: ROUGE, boxShadow: `inset 3px 0 0 ${ROUGE}` }}>
          {t.alerte.texte} <span className="font-normal">· {t.alerte.passages.join(', ')}</span>
        </div>
      )}
      {horsLigne && <p className="flex-none text-[7.5px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur : dernière lecture affichée.</p>}
      <div className="flex-none empty:hidden"><BandeauPause silence={vues.silence} now={now} /></div>
      <div className={`grid flex-none gap-[8px] ${haut ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <Stat rang={0} titre="En cours" valeur={t.enCours.length}
          sous={t.enCours.length ? t.enCours.map(x => nom(x.agent)).join(', ') : 'personne ne travaille'} />
        <Stat rang={1} titre="En attente de toi" valeur={t.enAttente.length} fort={t.enAttente.length > 0}
          sous={t.enAttente.length ? 'à toi de jouer' : 'rien ne t’attend'} />
        <Stat rang={2} titre="Faites aujourd’hui" valeur={duJour.length}
          sous={erreursDuJour ? <span className="font-semibold" style={{ color: ROUGE }}>dont {erreursDuJour} {erreursDuJour > 1 ? 'erreurs' : 'erreur'}</span> : duJour.length ? 'sans erreur' : 'rien encore'} />
        <Stat rang={3} titre="Prochain passage" valeur={prochain ? nom(prochain.agent) : '—'}
          sous={prochain ? `${quandCourt(prochain.quand, now)} · ${prochain.titre}` : 'aucun prévu'} />
      </div>
      <div className="flex flex-none flex-wrap items-center gap-[6px]">
        <Segments nom="Agent" options={FILTRES_AGENTS} valeur={agent} choisir={setAgent} />
        <Segments nom="Période" options={FILTRES_PERIODE} valeur={periode} choisir={setPeriode} />
      </div>
      <div className={haut ? 'space-y-[16px]' : 'grid min-h-0 flex-1 grid-cols-[1fr_1.2fr] gap-[18px]'}>
        <div className={colonne}>
          <section>
            <Titre n={enAttente.length}>En attente de toi</Titre>
            <div className="space-y-[6px]">
              {enAttente.length
                ? enAttente.map(x => <CarteAttente key={`${x.agent}-${x.texte}`} x={x} rang={rang++} />)
                : <Vide>Rien ne t’attend. Tout est en ordre.</Vide>}
            </div>
            {ignores.length > 0 && (
              <div className="mt-[8px]">
                <div className="mb-[4px] text-[7.5px] font-semibold uppercase tracking-[0.06em] text-[#8a879c]">Ignorés par toi</div>
                <ListeIgnores ignores={ignores} now={now} />
              </div>
            )}
          </section>
          <section>
            <Titre>Les agents</Titre>
            <div className="grid grid-cols-2 gap-[7px]">
              {agents.map(a => <CarteEtat key={a.agent} a={a} now={now} rang={rang++} />)}
            </div>
          </section>
        </div>
        <section className={colonne}>
          <motion.div {...apparait(1)}><Titre n={faites.length}>Faites</Titre></motion.div>
          {jours.length ? (
            <div className="space-y-[12px]">
              {jours.map(j => (
                <div key={j.jour}>
                  <div className="mb-[5px] flex items-center gap-[6px] text-[7.5px] font-semibold uppercase tracking-[0.06em] text-[#8a879c]">
                    {j.titre}<span className="h-px flex-1 bg-[#ecebf2]" />
                  </div>
                  <div className="space-y-[5px]">
                    {j.agents.map(g => {
                      const k = `${j.jour}-${g.agent}`;
                      return <GroupeFait key={k} g={g} ouvert={ouverts.has(k)} basculer={() => basculer(k)} rang={rang++} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : <Vide>{periode === 'jour' ? 'Rien de fait aujourd’hui pour l’instant.' : 'Rien de fait ces 7 derniers jours.'}</Vide>}
        </section>
      </div>
    </div>
  );
}

// ───────────────────────── Calendrier ─────────────────────────

const ETATS: Record<Creneau['etat'], { nom: string; c: string; t: string }> = {
  fait: { nom: 'fait', c: '#dff3e6', t: '#2f9c5a' },
  rate: { nom: 'raté', c: '#fbe1e1', t: ROUGE },
  'a-venir': { nom: 'à venir', c: '#f1f0f5', t: '#6b6880' },
  'sans-objet': { nom: 'pas nécessaire', c: '#f1f0f5', t: GRIS },
  'rien-a-faire': { nom: 'rien à rédiger', c: '#f1f0f5', t: GRIS },
  inactif: { nom: 'pas encore actif', c: '#f1f0f5', t: GRIS },
  pause: { nom: 'en pause (par toi)', c: '#f1f0f5', t: GRIS },
  prevu: { nom: 'prévu', c: '#f1f0f5', t: GRIS },
};

function Detail({ c, fermer }: { c: Creneau; fermer: () => void }) {
  const e = ETATS[c.etat];
  return (
    <div className="mb-[8px] flex items-start gap-[6px] rounded-[6px] border border-[#ecebf2] bg-white p-[6px]">
      <Tete id={c.agent} />
      <div className="min-w-0 flex-1 text-[8px] leading-snug">
        <div><b>{c.nom}</b> · {c.titre} {c.accord && <span className="font-semibold" style={{ color: ROUGE }}>● accord</span>}</div>
        <div className="text-[#6b6880]">Prévu le {date(c.quand)} à {c.heure} · <span style={{ color: e.t }} className="font-semibold">{e.nom}</span></div>
        {c.entree ? (
          <div className="mt-[2px]">Journal ({heure(c.entree.quand)}) : {c.entree.texte}{c.entree.resultat && <span className="text-[#2f9c5a]"> · {c.entree.resultat}</span>}</div>
        ) : c.etat === 'rate' ? <div className="mt-[2px]" style={{ color: ROUGE }}>Aucune trace dans le journal.</div> : null}
      </div>
      <button onClick={fermer} aria-label="Fermer" className="text-[11px] leading-none text-[#6b6880]">×</button>
    </div>
  );
}

/** Le nom d'une réunion selon son niveau. */
const NIVEAU: Record<ReunionVue['niveau'], string> = { incident: 'Incident', crise: 'Réunion de crise' };

/** Les heures d'une réunion : « 14:05–14:40 », ou « 14:05 · en cours ». */
const heuresReunion = (r: ReunionVue) => (r.fin !== undefined ? `${heure(r.debut)}–${heure(r.fin)}` : `${heure(r.debut)} · en cours`);

/** Ses points de situation, résumés : « 52 points · dernier 19:30 · prochain 20:00 » (calendrier.ts). */
const lignePoints = (r: ReunionVue) => resumePoints(r.points, r.prochain, heure);

/** Une vraie réunion de crise dans sa journée du Calendrier (rouge : on ne la confond pas avec une routine). */
function CarteReunion({ r }: { r: ReunionVue }) {
  return (
    <div data-testid="reunion-crise" className="mb-[4px] rounded-[5px] bg-[#fdf0f0] p-[4px] shadow-[0_1px_2px_rgba(0,0,0,.06)]" style={{ borderLeft: `2.5px solid ${ROUGE}` }}>
      <div className="flex items-center justify-between gap-[2px] text-[6.5px]" style={{ color: ROUGE }}>
        <span className="font-semibold">{heuresReunion(r)}</span>
        <span className="rounded-[3px] bg-white/70 px-[3px] font-semibold">{NIVEAU[r.niveau].toLowerCase()}</span>
      </div>
      <div className="line-clamp-3 text-[7.5px] leading-tight" title={r.titre}>{r.titre}</div>
      <div className="mt-[1px] text-[6.5px] leading-tight text-[#6b6880]">{lignePoints(r)}</div>
      {r.bilan && <div className="mt-[1px] text-[6.5px] font-semibold leading-tight" style={{ color: VERT }}>{r.bilan}</div>}
    </div>
  );
}

/** L'historique des réunions de crise (60 jours), sous la semaine : chacune avec son début, ses points et sa fin. */
function HistoriqueReunions({ reunions }: { reunions: ReunionVue[] }) {
  return (
    <section className="mt-[10px]">
      <Titre n={reunions.length}>Réunions de crise</Titre>
      {reunions.length ? (
        <ul className="space-y-[4px]">
          {reunions.map(r => (
            <li key={r.id} data-testid="historique-reunion" className="flex items-start gap-[6px] rounded-[8px] border border-[#f3c4c4] bg-white px-[8px] py-[5px] text-[8px] leading-snug" style={{ boxShadow: `inset 3px 0 0 ${ROUGE}` }}>
              <span className="min-w-0 flex-1">
                <b style={{ color: ROUGE }}>{NIVEAU[r.niveau]}</b> · {date(r.debut)} · {heuresReunion(r)} · {r.titre}
                <span className="block text-[7.5px] text-[#6b6880]">{lignePoints(r)} · {r.participants.map(nomCourt).join(', ')}{r.bilan && <span className="font-semibold" style={{ color: VERT }}> · {r.bilan}</span>}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <Vide>Aucune réunion de crise : aucune vraie alerte n’en a demandé.</Vide>}
    </section>
  );
}

export function Calendrier() {
  const { vues, message } = useEtat();
  const haut = useQG(s => s.format === 'haut');
  const [choisi, setChoisi] = useState<string | null>(null);
  if (!vues) return <Attente>{message}</Attente>;
  const cal = vues.calendrier;
  const cle = (c: Creneau) => `${c.routine}-${c.jour}-${c.heure}`;
  const detail = cal.creneaux.find(c => cle(c) === choisi);
  return (
    <div>
      {/* une ligne, et ce qui tourne en continu replié (« trop chargé », 13 novembre 2026) */}
      <details className="mb-[6px] text-[8px] text-[#6b6880]">
        <summary className="cursor-pointer select-none">
          Heure d’Abidjan · <span className="font-semibold" style={{ color: ROUGE }}>● accord</span> = rien ne part sans mon OK · en continu ({cal.lignes.length})
        </summary>
        <ul className="mt-[3px] flex flex-wrap gap-x-[10px] gap-y-[2px]">
          {cal.lignes.map(l => (
            <li key={l.texte} className="text-[7.5px]" style={{ color: l.prevu ? GRIS : '#1d1b2e' }}>
              {l.texte}{l.prevu && <> <Puce>prévu</Puce></>}
            </li>
          ))}
        </ul>
      </details>
      {detail && <Detail c={detail} fermer={() => setChoisi(null)} />}
      <div className={haut ? 'space-y-[5px]' : 'grid grid-cols-7 gap-[5px]'}>
        {JOURS.map((j, i) => {
          const { seuls: du, repetees } = regrouperRelances(cal.creneaux.filter(c => c.jour === i));
          const reunions = (vues.crise?.reunions ?? []).filter(r => jourDe(r.debut) === cal.jours[i]).sort((a, b) => a.debut - b.debut);
          return (
            <div key={j} className={`${haut ? '' : 'min-h-[300px]'} rounded-[8px] p-[4px] ${i === cal.aujourdhui ? 'bg-[#eef2ff] ring-1 ring-[#c9d4fb]' : 'bg-[#faf9fc]'}`}>
              <div className="mb-[4px] text-center text-[8px] font-bold">{j} <span className="font-normal text-[#6b6880]">{Number(cal.jours[i].slice(8))}</span>{i === cal.aujourdhui && <span className="ml-[3px] font-normal text-[#4a6bd9]">aujourd’hui</span>}</div>
              {reunions.map(r => <CarteReunion key={r.id} r={r} />)}
              {du.map(c => {
                const e = ETATS[c.etat];
                if (c.prevu) {
                  return (
                    <div key={cle(c)} className="mb-[4px] rounded-[5px] border border-dashed border-[#dcdae6] p-[4px]" style={{ color: GRIS }}>
                      <div className="text-[6.5px]">{c.heure} · {c.nom} · prévu</div>
                      <div className="text-[7.5px] leading-tight">{c.titre}</div>
                    </div>
                  );
                }
                const petit = c.conditionnel;
                // seuls « fait », « raté » et « en pause » ont une pastille ; ce qui n'a pas tourné s'efface à moitié
                const pastille = c.etat === 'fait' || c.etat === 'rate' || c.etat === 'pause';
                return (
                  <button key={cle(c)} onClick={() => setChoisi(cle(c) === choisi ? null : cle(c))}
                    className={`mb-[4px] w-full rounded-[5px] bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,.06)] hover:opacity-100 hover:shadow-[0_1px_4px_rgba(0,0,0,.15)] ${petit ? 'px-[4px] py-[2px]' : 'p-[4px]'} ${estEteint(c) ? 'opacity-45' : ''} ${cle(c) === choisi ? 'ring-1 ring-[#1d1b2e]' : ''}`}
                    style={{ borderLeft: `2.5px solid ${couleur(c.agent)}` }}>
                    <div className="flex items-center justify-between gap-[2px] whitespace-nowrap text-[6.5px] text-[#6b6880]">
                      <span className="truncate">{c.heure} · {c.nom}</span>
                      {pastille && <span className="rounded-[3px] px-[3px] font-semibold" style={{ background: e.c, color: e.t }}>{e.nom}</span>}
                    </div>
                    <div className={`${petit ? 'text-[6.5px] text-[#6b6880]' : 'text-[7.5px]'} leading-tight`}>{c.titre}</div>
                    {c.accord && <div className="mt-[1px] text-[6px] font-semibold" style={{ color: ROUGE }}>● accord</div>}
                  </button>
                );
              })}
              {repetees.map(r => (
                <div key={r.routine} data-testid="relance-repetee" className={`mb-[4px] rounded-[5px] px-[4px] py-[2px] text-[6.5px] leading-tight text-[#6b6880] ${r.eteinte ? 'opacity-45' : ''}`} style={{ borderLeft: `2.5px solid ${couleur(r.agent)}` }}>
                  <div className="whitespace-nowrap">{r.de} → {r.a} · {r.nom}</div>
                  <div>{r.titre} · {r.n} fois
                    {r.faits > 0 && <span className="font-semibold" style={{ color: VERT }}> · {r.faits} fait{r.faits > 1 ? 's' : ''}</span>}
                    {r.rates > 0 && <span className="font-semibold" style={{ color: ROUGE }}> · {r.rates} raté{r.rates > 1 ? 's' : ''}</span>}
                  </div>
                </div>
              ))}
              {cal.nuits[i] && (
                <div data-testid="astreinte-nuit" className="mt-[2px] rounded-[5px] bg-[#1b2440] p-[4px] text-[#e8ecff] shadow-[0_1px_2px_rgba(0,0,0,.06)]">
                  <div className="text-[6.5px] text-[#aab4d8]">🌙 20:00 → 07:00</div>
                  <div className="mt-[2px] flex items-center gap-[4px]">
                    <Tete id={cal.nuits[i].agent} size={14} />
                    <div className="min-w-0 text-[7.5px] leading-tight">
                      <span className="font-semibold">{cal.nuits[i].nom}</span> · d’astreinte{i === cal.aujourdhui && <span className="text-[#aab4d8]"> · cette nuit</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <HistoriqueReunions reunions={vues.crise?.reunions ?? []} />
    </div>
  );
}
