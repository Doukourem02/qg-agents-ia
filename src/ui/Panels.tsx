'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { rendezVous } from './rendezVous';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ROOMS, roomAt } from '@/data/layout';
import { PIECES } from '@/data/contenu';
import { AGENTS, POLES, agentById, poleById } from '@/sim/routing';
import { headDataUrl } from '@/scene/sprites';
import { BUREAU_PAR_AGENT, getEngine, useQG } from '@/store';
import { ROOM_ICONS, TOOLS, ToolLogo } from './icons';
import { envoyerMission } from './useReel';
import { Calendrier, ONGLETS_REELS, Taches } from './OngletsReels';
import { Cerveau } from './Cerveau';
import { AGENTS_REELS } from '@/data/reels';
import { NOM_STATUT, enCeMoment } from '@/data/journal';
import { etiquettesPieces } from '@/data/pieces';
import { enColonnes, organigramme, roleCourt, type Branche, type Membre } from './organigramme';

// Tout ce qui s'ouvre au clic : les onglets (Équipe, Tâches, Calendrier, Cerveau), la fiche d'un agent,
// le panneau d'une pièce et celui d'un outil. Équipe vient d'agents.json ; Tâches, Calendrier et Cerveau
// lisent les vraies données (OngletsReels.tsx) et n'existent pas dans /demo.

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};

export const OMBRE_CARTE = 'shadow-[0_1px_2px_rgba(40,30,90,.06),0_4px_14px_rgba(40,30,90,.07)]';

export function Tete({ id, size = 18 }: { id: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  // taille fixe et carrée même dans une rangée flex qui s'étire (sinon le visage s'allonge sur toute la hauteur)
  return <img src={headDataUrl(id)} alt="" width={size} height={size} className="flex-none self-start rounded-[4px] bg-[#f1f0f5] object-contain" style={{ width: size, height: size, imageRendering: 'pixelated' }} />;
}

export function Puce({ children, c = '#f1f0f5', t = '#6b6880' }: { children: ReactNode; c?: string; t?: string }) {
  return <span className="inline-block rounded-[4px] px-[5px] py-[1px] text-[7px] font-semibold" style={{ background: c, color: t }}>{children}</span>;
}

export function Fermer({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} aria-label="Fermer" className="text-[12px] leading-none text-[#6b6880] hover:text-[#1d1b2e]">×</button>;
}

const VIDE: never[] = [];
const estReel = (id: string) => (AGENTS_REELS as readonly string[]).includes(id);
/** Le bureau de chaque agent réel (même modèle pour les trois : BureauAgent.tsx). */
const pieceDuPole = (pole: string) => ROOMS.find(r => r.id === (pole === 'communication' ? 'communication' : pole))?.id;

/** Ouvre la fiche d'un agent et centre la vue sur sa pièce. */
function voirAgent(id: string) {
  const s = useQG.getState();
  const a = agentById(id);
  useQG.setState({ onglet: 'bureau', focus: a ? pieceDuPole(a.pole) ?? null : null });
  s.select(id);
}

function AgentLigne({ id, droite }: { id: string; droite?: ReactNode }) {
  const a = agentById(id);
  if (!a) return null;
  return (
    <button onClick={() => voirAgent(id)} className="flex w-full items-center gap-[6px] rounded-[6px] px-[4px] py-[3px] text-left hover:bg-[#f4f3f8]">
      <Tete id={id} />
      <span className="min-w-0 flex-1">
        <span className="block text-[8.5px] font-bold leading-tight">{a.nom}</span>
        <span className="block truncate text-[7px] text-[#6b6880]">{a.role}</span>
      </span>
      {droite}
    </button>
  );
}

// ───────────────────────── Les onglets ─────────────────────────

// L'organigramme : Le patron → Kuroro → les trois chefs de pôle (la Communication au centre) → leurs équipes.
// L'ordre vient de organigramme.ts ; les noms, rôles et pôles de agents.json. Les traits sont des bordures CSS.
const ORGA = organigramme(AGENTS, POLES, AGENTS_REELS);
const TRAIT = 'bg-[#d4d1e2]';

/** Apparition douce, rangée par rangée, du haut vers le bas (rien si l'animation est réduite). */
function useApparition() {
  const reduit = useReducedMotion();
  return (rang: number) => reduit ? {} : {
    initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + rang * 0.07, duration: 0.32, ease: 'easeOut' as const },
  };
}

function Marqueur({ m, vivant }: { m: Membre; vivant?: string }) {
  if (m.marque === 'reel') {
    return (
      <span className="flex items-center gap-[3px] text-[7px] font-semibold text-[#2f9c5a]">
        <span className="h-[5px] w-[5px] flex-none rounded-full bg-[#2fbf5b]" />en service{vivant && <span className={vivant === 'bloqué' ? 'text-[#d23b3b]' : 'font-normal text-[#6b6880]'}>· {vivant}</span>}
      </span>
    );
  }
  if (m.marque === 'prevu') return <span className="flex items-center gap-[3px] text-[7px] text-[#8a879c]"><span className="h-[5px] w-[5px] flex-none rounded-full bg-[#c9c6d6]" />prévu</span>;
  return <span className="flex items-center gap-[3px] text-[7px] text-[#8a879c]"><span className="h-[5px] w-[5px] flex-none rounded-full border border-dashed border-[#a9a6b8]" />bientôt</span>;
}

const OMBRE = OMBRE_CARTE;

/** Une carte d'agent : visage carré, nom, rôle court, marqueur. Au clic, sa fiche (comme avant). */
function CarteAgent({ m, taille, note }: { m: Membre; taille: 'ceo' | 'chef' | 'membre'; note?: ReactNode }) {
  const a = agentById(m.id);
  const pole = a && poleById(a.pole);
  const demo = useQG(s => s.demo);
  // le vrai état (au travail, au repos, bloqué) des agents branchés ; jamais dans /demo, rien d'inventé pour les autres
  const statut = useQG(s => (demo || m.marque !== 'reel' ? undefined : s.vues?.agents.find(x => x.agent === m.id)?.statut));
  if (!a || !pole) return null;
  // un chef de pôle est rangé dans la Direction : son pôle, c'est celui qu'il dirige
  const dirige = POLES.find(p => p.chef === m.id && p.id !== 'direction');
  const accent = taille === 'membre' ? undefined : (dirige ?? pole).couleur;
  const role = taille === 'membre' ? roleCourt(a.role) : taille === 'chef' ? `${roleCourt(a.role)} · ${dirige?.nom ?? pole.nom}` : a.role;
  const visage = taille === 'ceo' ? 40 : taille === 'chef' ? 36 : 30;
  return (
    <button onClick={() => voirAgent(m.id)}
      className={`relative flex w-full items-center gap-[8px] overflow-hidden rounded-[10px] border bg-white py-[7px] pl-[9px] pr-[8px] text-left ${OMBRE} transition-[transform,box-shadow] duration-150 hover:-translate-y-[1px] hover:shadow-[0_2px_4px_rgba(40,30,90,.08),0_8px_22px_rgba(40,30,90,.12)] ${m.marque === 'plusTard' ? 'border-dashed border-[#bdbacd] bg-[#fcfcfe]' : 'border-[#ecebf2]'} ${m.n1 ? 'ring-[1.5px] ring-[#e0753f]/60' : ''}`}>
      {accent && <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />}
      {!accent && <span className="absolute inset-y-0 left-0 w-[3px] opacity-70" style={{ background: pole.couleur }} />}
      <span className={m.marque === 'plusTard' ? 'opacity-60' : ''}><Tete id={m.id} size={visage} /></span>
      <span className="min-w-0 flex-1">
        <span className={`block font-bold leading-tight ${taille === 'membre' ? 'text-[10px]' : 'text-[11.5px]'}`}>{a.nom}</span>
        <span className="block truncate text-[7.5px] leading-snug text-[#6b6880]">{role}</span>
        <span className="mt-[2px] flex flex-wrap items-center gap-x-[5px] gap-y-[1px]">
          <Marqueur m={m} vivant={statut ? NOM_STATUT[statut] : undefined} />
          {m.n1 && <span className="rounded-[4px] bg-[#e0753f] px-[4px] py-[0.5px] text-[6.5px] font-bold text-white">n°1 du QG</span>}
        </span>
        {note}
      </span>
    </button>
  );
}

const Vertical = ({ h }: { h: number }) => <div className={`mx-auto w-[1.5px] flex-none ${TRAIT}`} style={{ height: h }} />;

/**
 * Une liste reliée par un trait à gauche (une équipe, ou tout l'arbre en format haut) :
 * chaque ligne prolonge le trait, la dernière s'arrête au milieu de sa carte.
 */
function Liste({ items }: { items: { cle: string; carte: ReactNode; sous?: ReactNode; rang: number }[] }) {
  const apparait = useApparition();
  return (
    <ul className="relative pl-[16px]">
      {items.map((it, i) => {
        const dernier = i === items.length - 1;
        return (
          <motion.li key={it.cle} className="relative pt-[7px]" {...apparait(it.rang)}>
            {!dernier && <span className={`absolute bottom-0 left-[-10px] top-0 w-[1.5px] ${TRAIT}`} />}
            <div className="relative">
              {dernier && <span className={`absolute bottom-1/2 left-[-10px] top-[-7px] w-[1.5px] ${TRAIT}`} />}
              <span className={`absolute left-[-10px] top-1/2 h-[1.5px] w-[10px] ${TRAIT}`} />
              {it.carte}
            </div>
            {it.sous}
          </motion.li>
        );
      })}
    </ul>
  );
}

const membres = (b: Branche, depart: number) => b.equipe.map((m, i) => ({ cle: m.id, rang: depart + i * 0.5, carte: <CarteAgent m={m} taille="membre" /> }));

function Legende() {
  return (
    <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px]">
      <Marqueur m={{ id: '', marque: 'reel', n1: false }} />
      <Marqueur m={{ id: '', marque: 'prevu', n1: false }} />
      <Marqueur m={{ id: '', marque: 'plusTard', n1: false }} />
    </div>
  );
}

function Equipe() {
  const haut = useQG(s => s.format === 'haut');
  const demo = useQG(s => s.demo);
  // /demo : la tâche de la simulation sous Kuroro, comme avant ; page privée : rien d'inventé
  const tacheSim = useQG(s => (s.demo ? s.snap?.tasks.kuroro : undefined));
  const apparait = useApparition();
  const { ceo, aupres, branches } = ORGA;
  const noteCeo = demo && tacheSim ? <span className="mt-[2px] block truncate font-serif text-[8px] italic text-[#6b6880]">{tacheSim}</span> : undefined;
  const carteCeo = ceo && <CarteAgent m={ceo} taille="ceo" note={noteCeo} />;
  const intro = <p className="text-[8px] text-[#6b6880]">Kuroro, le CEO, est le boss : il répartit le travail ; chaque pôle a son chef.</p>;

  if (haut) {
    // téléphone : l'arbre à la verticale, en retrait, avec ses traits
    return (
      <div>
        <div className="mb-[8px] flex flex-col gap-[4px]">{intro}<Legende /></div>
        <Liste items={ceo ? [{
          cle: ceo.id, rang: 1, carte: carteCeo,
          sous: <Liste items={[...aupres.map((m, i) => ({ cle: m.id, rang: 1.5 + i * 0.5, carte: <CarteAgent m={m} taille="membre" /> })), ...branches.map((b, i) => ({
            cle: b.pole, rang: 2 + i,
            carte: <CarteAgent m={b.chef} taille="chef" />,
            sous: <Liste items={membres(b, 2.5 + i)} />,
          }))]} />,
        }] : []} />
      </div>
    );
  }

  const n = branches.length;
  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-[4px] flex items-center justify-between gap-[12px]">{intro}<Legende /></div>
      <div className="flex flex-col items-center">
        <motion.div className="relative w-[270px]" {...apparait(0)}>
          {carteCeo}
          {/* rattachés au CEO lui-même (Feu) : à côté de lui, reliés par un trait */}
          {aupres.length > 0 && (
            <div className="absolute left-[calc(100%+28px)] top-1/2 flex w-[190px] -translate-y-1/2 flex-col gap-[6px]">
              <span className={`absolute left-[-28px] top-1/2 h-[1.5px] w-[28px] ${TRAIT}`} />
              {aupres.map(m => <CarteAgent key={m.id} m={m} taille="membre" />)}
            </div>
          )}
        </motion.div>
        <Vertical h={16} />
        <div className="relative w-full">
          {/* le trait qui relie les trois chefs de pôle (d'un centre de colonne à l'autre) */}
          <motion.div className={`absolute top-0 h-[1.5px] ${TRAIT}`} style={{ left: `${50 / n}%`, right: `${50 / n}%` }} {...apparait(1.5)} />
          <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {branches.map(b => {
              const cols = enColonnes(membres(b, 3), 4);
              return (
                <motion.div key={b.pole} className="flex flex-col items-center px-[14px]" {...apparait(2)}>
                  <Vertical h={16} />
                  <div className="w-full max-w-[290px]">
                    <CarteAgent m={b.chef} taille="chef" />
                  </div>
                  {b.equipe.length > 0 && <Vertical h={12} />}
                  {b.equipe.length > 0 && (
                    <div className="relative w-full">
                      {/* du chef au trait de chaque colonne de son équipe */}
                      <div className={`absolute top-0 h-[1.5px] ${TRAIT}`} style={{ left: 6, width: cols.length > 1 ? 'calc(50% + 5px)' : 'calc(50% - 6px)' }} />
                      <div className="grid gap-x-[10px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
                        {cols.map((c, j) => <Liste key={j} items={c} />)}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// l'organigramme prend toute la place, au-dessus des petits menus du bas ; la barre de mission reste visible
const PLEIN_LARGE = 'bottom-[58px] left-[12px] right-[12px] top-[56px] z-[20]';

const TITRES = { equipe: 'Équipe', taches: 'Tâches', calendrier: 'Calendrier', cerveau: 'Cerveau' } as const;

export function OngletPanel() {
  const onglet = useQG(s => s.onglet);
  const setOnglet = useQG(s => s.setOnglet);
  const haut = useQG(s => s.format === 'haut');
  const demo = useQG(s => s.demo);
  // dans /demo, seuls Bureau et Équipe existent : les trois autres onglets montrent de vraies données
  const titre = onglet !== 'bureau' && !(demo && ONGLETS_REELS.includes(onglet)) ? TITRES[onglet] : null;
  return (
    <AnimatePresence>
      {titre && (
        <motion.div key={onglet} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className={`qg-panel absolute flex flex-col p-[12px] ${haut ? 'bottom-[66px] left-[8px] right-[8px] top-[50px]' : onglet === 'equipe' ? PLEIN_LARGE : 'left-[calc(50%-395px)] top-[56px] h-[552px] w-[790px]'}`}>
          <div className="mb-[8px] flex items-center justify-between">
            <h2 className="font-serif text-[16px] italic">{titre}</h2>
            <Fermer onClick={() => setOnglet('bureau')} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-[4px]">
            {onglet === 'equipe' && <Equipe />}
            {onglet === 'taches' && <Taches />}
            {onglet === 'calendrier' && <Calendrier />}
            {onglet === 'cerveau' && <Cerveau />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── Fiche, pièce, outil ─────────────────────────

function Volet({ children, onClose, cle }: { children: ReactNode; onClose: () => void; cle: string }) {
  const haut = useQG(s => s.format === 'haut');
  return (
    <motion.div key={cle} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
      className={`qg-panel absolute overflow-y-auto p-[10px] ${haut ? 'bottom-[66px] left-[8px] right-[8px] max-h-[58%]' : 'left-[12px] top-[54px] max-h-[490px] w-[205px]'}`}>
      <div className="absolute right-[8px] top-[8px]"><Fermer onClick={onClose} /></div>
      {children}
    </motion.div>
  );
}

export const Titre = ({ children }: { children: ReactNode }) => <h4 className="mb-[3px] mt-[8px] text-[6.5px] font-semibold tracking-[.06em] text-[#6b6880]">{children}</h4>;

function Fiche({ id }: { id: string }) {
  const a = agentById(id)!;
  const task = useQG(s => s.snap?.tasks[id]);
  const reel = useQG(s => !!s.snap?.reels.includes(id));
  const toutes = useQG(s => s.snap?.taches) ?? VIDE;
  const faites = useQG(s => s.vues?.taches.faites);
  const horsLigne = useQG(s => s.vuesHorsLigne);
  const select = useQG(s => s.select), ouvrir = useQG(s => s.ouvrir), showToast = useQG(s => s.showToast);
  const demo = useQG(s => s.demo);
  const etatReel = useQG(s => s.vues?.agents.find(x => x.agent === id));
  const maintenant = useQG(s => s.vues?.maintenant);
  const astreinte = useQG(s => s.vues?.astreinte);
  const bureau = BUREAU_PAR_AGENT[id];
  const [v, setV] = useState('');
  const pole = poleById(a.pole)!;
  const equipe = AGENTS.filter(x => x.pole === a.pole && x.id !== id);
  const confier = (e: FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    const t = v.trim();
    getEngine().missionDirecte(id, t);
    setV('');
    envoyerMission(t, id).then(ok => showToast(ok ? `Mission confiée à ${a.nom} · envoyée` : `Mission confiée à ${a.nom}`));
  };
  return (
    <Volet cle={`a-${id}`} onClose={() => select(null)}>
      <div className="flex items-center gap-[7px] pr-[12px]">
        <Tete id={id} size={30} />
        <div className="min-w-0">
          <div className="text-[11px] font-bold leading-tight">{a.nom}</div>
          <div className="text-[7.5px] leading-tight text-[#6b6880]">{a.role}</div>
        </div>
      </div>
      <div className="mt-[6px] flex flex-wrap gap-[4px]">
        <Puce c={pole.couleur} t="#fff">{pole.nom}</Puce>
        {reel ? <Puce c="#2fbf5b" t="#fff">en ligne</Puce> : a.plusTard ? <Puce>bientôt</Puce> : null}
      </div>
      {bureau && !demo && (
        <button onClick={() => ouvrir({ type: bureau })} className="mt-[6px] w-full rounded-[6px] bg-[#1d1b2e] px-[6px] py-[4px] text-left text-[8px] font-semibold text-white hover:bg-[#35324a]">
          Le bureau de {a.nom} <span className="float-right">→</span>
        </button>
      )}
      <Titre>EN CE MOMENT</Titre>
      {/* /demo : la simulation ; page privée : le vrai état des agents branchés, rien d'inventé pour les autres */}
      <div className={`font-serif text-[9px] italic ${etatReel?.statut === 'bloque' ? 'font-semibold text-[#d23b3b]' : ''}`}>
        {demo ? task : !estReel(id) ? 'Pas encore branché.' : etatReel && maintenant ? enCeMoment(etatReel, maintenant) : horsLigne ? 'Hors ligne' : 'Lecture…'}
      </div>
      {/* le nom de son prochain passage (l'heure est déjà dans « En ce moment ») : la même ligne qu'au survol */}
      {!demo && etatReel?.prochainPassage && <div className="mt-[2px] text-[7.5px] text-[#6b6880]">{rendezVous(etatReel, maintenant)}</div>}
      {!demo && astreinte === id && <div className="mt-[2px] text-[7.5px] text-[#6b6880]">d&apos;astreinte cette nuit</div>}
      <Titre>COMPÉTENCES</Titre>
      <div className="flex flex-wrap gap-[3px]">{a.competences.map(c => <Puce key={c}>{c}</Puce>)}</div>
      <Titre>OUTILS</Titre>
      <div className="flex gap-[4px]">
        {a.outils.map(k => {
          const t = TOOLS.find(x => x.key === k)!;
          return <button key={k} title={t.nom} onClick={() => ouvrir({ type: 'outil', id: k })} className="qg-tool" style={{ background: t.hex }}><ToolLogo t={t} size={11} /></button>;
        })}
      </div>
      <Titre>ÉQUIPE</Titre>
      {equipe.map(x => <AgentLigne key={x.id} id={x.id} />)}
      <Titre>DERNIÈRES TÂCHES</Titre>
      {demo
        // /demo se filme avec la simulation : là seulement, les tâches de la simulation
        ? toutes.filter(t => t.agentId === id).slice(0, 3).map(t => <div key={t.id} className="text-[7.5px] leading-snug"><span className={t.statut === 'faite' ? 'text-[#2f9c5a]' : 'text-[#e0a42a]'}>●</span> {t.texte} <span className="text-[#6b6880]">· {ago(t.quand)}</span></div>)
        : !estReel(id) ? <p className="text-[7.5px] text-[#6b6880]">Pas encore branché — aucune tâche réelle.</p>
          : !faites ? <p className="text-[7.5px] text-[#6b6880]">{horsLigne ? 'Hors ligne' : 'Lecture…'}</p>
            : (() => {
              const siennes = faites.filter(t => t.agent === id).slice(0, 5);
              return siennes.length
                ? siennes.map((t, i) => <div key={`${t.quand}-${i}`} className="text-[7.5px] leading-snug"><span className="text-[#2f9c5a]">●</span> {t.texte}{t.resultat && <span className="text-[#2f9c5a]"> · {t.resultat}</span>} <span className="text-[#6b6880]">· {ago(t.quand)}</span></div>)
                : <p className="text-[7.5px] text-[#6b6880]">Rien dans le journal ces 7 derniers jours.</p>;
            })()}
      <form onSubmit={confier} className="mt-[8px] flex items-center gap-[4px] rounded-[6px] bg-[#f1f0f5] p-[3px]">
        <input value={v} onChange={e => setV(e.target.value)} placeholder={`Confier une mission à ${a.nom}…`} className="min-w-0 flex-1 bg-transparent px-[4px] text-[7.5px] outline-none" />
        <button className="h-[15px] w-[15px] rounded-[4px] bg-[#1d1b2e] text-[8px] text-white">↑</button>
      </form>
    </Volet>
  );
}

function Piece({ id }: { id: string }) {
  const r = ROOMS.find(x => x.id === id)!;
  const sim = useQG(s => s.snap?.rooms);
  const tasks = useQG(s => s.snap?.tasks);
  useQG(s => s.snap); // se rafraîchit avec la simulation
  const demo = useQG(s => s.demo);
  const enAttente = useQG(s => s.vues?.taches.enAttente.length);
  const salle = useQG(s => s.snap?.salle ?? null);
  const etat = sim ? etiquettesPieces(sim, demo, enAttente, salle)[id] : '';
  const agentsReels = useQG(s => s.vues?.agents);
  const ouvrir = useQG(s => s.ouvrir);
  const info = PIECES[id];
  const Icon = ROOM_ICONS[id];
  const membres = info?.pole ? AGENTS.filter(a => a.pole === info.pole) : [];
  const presents = getEngine().agents.filter(a => a.named && roomAt(a.x, a.y)?.id === id && !membres.some(m => m.id === a.id));
  return (
    <Volet cle={`p-${id}`} onClose={() => { ouvrir(null); useQG.setState({ focus: null }); }}>
      <div className="flex items-center gap-[7px] pr-[12px]">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-[6px]" style={{ background: r.couleur }}><Icon size={13} color="#fff" strokeWidth={2.4} /></span>
        <div>
          <div className="text-[11px] font-bold leading-tight">{r.nom}</div>
          <div className="text-[7.5px] text-[#6b6880]">{etat}</div>
        </div>
      </div>
      <p className="mt-[6px] text-[8px] leading-snug">{info?.texte}</p>
      {membres.length > 0 && (<>
        <Titre>L’ÉQUIPE DU PÔLE</Titre>
        {membres.map(a => <AgentLigne key={a.id} id={a.id} droite={<span className="max-w-[70px] truncate text-[6.5px] italic text-[#6b6880]">{demo ? tasks?.[a.id] : estReel(a.id) ? NOM_STATUT[agentsReels?.find(x => x.agent === a.id)?.statut ?? 'au repos'] : 'pas encore branché'}</span>} />)}
      </>)}
      {presents.length > 0 && (<>
        <Titre>EN CE MOMENT DANS LA PIÈCE</Titre>
        {presents.map(a => <AgentLigne key={a.id} id={a.id} />)}
      </>)}
    </Volet>
  );
}

function Outil({ id }: { id: string }) {
  const t = TOOLS.find(x => x.key === id)!;
  const tous = useQG(s => s.snap?.usages) ?? VIDE;
  const usages = tous.filter(u => u.tool === id).slice(0, 8);
  const ouvrir = useQG(s => s.ouvrir);
  const utilisateurs = AGENTS.filter(a => a.outils.includes(id) || tous.some(u => u.tool === id && u.agentId === a.id));
  return (
    <Volet cle={`o-${id}`} onClose={() => ouvrir(null)}>
      <div className="flex items-center gap-[7px] pr-[12px]">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-[6px]" style={{ background: t.hex }}><ToolLogo t={t} size={14} /></span>
        <div className="text-[11px] font-bold">{t.nom}</div>
      </div>
      <Titre>UTILISÉ PAR</Titre>
      {utilisateurs.length ? utilisateurs.map(a => <AgentLigne key={a.id} id={a.id} />) : <p className="text-[7.5px] text-[#6b6880]">Personne pour l’instant : il servira aux agents des phases suivantes.</p>}
      <Titre>DERNIÈRES UTILISATIONS</Titre>
      {!usages.length && <p className="text-[7.5px] text-[#6b6880]">Aucune utilisation réelle pour l’instant.</p>}
      {usages.map((u, i) => (
        <div key={i} className="flex items-center gap-[5px] py-[2px] text-[7.5px]">
          <Tete id={u.agentId} size={14} />
          <span className="flex-1">{agentById(u.agentId)?.nom}</span>
          <span className="text-[#6b6880]">{ago(u.quand)}</span>
        </div>
      ))}
    </Volet>
  );
}

export function Volets() {
  const selected = useQG(s => s.selected);
  const volet = useQG(s => s.volet);
  return (
    <AnimatePresence mode="wait">
      {selected && agentById(selected) ? <Fiche key={`a-${selected}`} id={selected} />
        : volet?.type === 'piece' ? <Piece key={`p-${volet.id}`} id={volet.id} />
          : volet?.type === 'outil' ? <Outil key={`o-${volet.id}`} id={volet.id} />
            : null}
    </AnimatePresence>
  );
}

export const NB_AGENTS = AGENTS.length;
export const NB_POLES = POLES.length;
