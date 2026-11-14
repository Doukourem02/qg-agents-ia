'use client';
import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ROOMS } from '@/data/layout';
import { AGENTS, agentById } from '@/sim/routing';
import { headDataUrl } from '@/scene/sprites';
import { remettreLaVue, vueBougee } from '@/scene/vue';
import { arreterSons, demarrerSons, ecrireChoixSons, lireChoixSons } from '@/scene/sons';
import { BUREAU_PAR_AGENT, getEngine, horlogeDeLaPage, useQG } from '@/store';
import { estJour } from '@/sim/horaire';
import { momentA, TITRES } from '@/sim/journee';
import { allumage, astres, HEURE_DEMO, heureDeLaDemo, instantAbidjan, instantDemo, lireJour, lumiereA, minutesDe } from '@/sim/lumiere';
import Overlay from './Overlay';
import { useReel } from './useReel';
import { OngletPanel, Volets } from './Panels';
import { ONGLETS_REELS, useVuesQG } from './OngletsReels';
import { BureauL } from './BureauL';
import { ReleveLight } from './ReleveLight';
import { BureauClara } from './BureauClara';
import { BureauMafe } from './BureauMafe';
import { BureauLuffy } from './BureauLuffy';
import { BureauIsaac } from './BureauIsaac';
import { BureauZoro } from './BureauZoro';
import { BureauLea } from './BureauLea';
import { BureauPaul } from './BureauPaul';
import { BureauYe } from './BureauYe';
import { BureauFeu } from './BureauFeu';
import type { Onglet } from '@/store';
import { ROOM_ICONS, TOOLS, ToolLogo } from './icons';
import { remettreLesMenus } from './deplacable';
import { Panel } from './Panel';
import { EnEcoute } from './EnEcoute';
import { ComptesRendus } from './ComptesRendus';
import { ConversationKuroro, useConversation } from './ConversationKuroro';
import { reveillerMac } from './kuroro-ia';
import { allumesVague, compteur, outilsEnService, outilsEnTache, texteCompteur } from './compteur';

const Scene = dynamic(() => import('@/scene/Scene'), { ssr: false });

// L'interface est dessinée à la taille de mes plans (1200 × 675 points), puis agrandie avec l'écran,
// comme la scène : les proportions restent celles des plans quelle que soit la fenêtre.
const UI_W = 1200, UI_H = 675;

const TABS: [Onglet, string][] = [['bureau', 'Bureau'], ['equipe', 'Équipe'], ['taches', 'Tâches'], ['calendrier', 'Calendrier'], ['cerveau', 'Cerveau']];

function Nav() {
  const onglet = useQG(s => s.onglet), setOnglet = useQG(s => s.setOnglet);
  // ce qui m'attend (accords, sujet à choisir, questions, relevé non vu) : le même nombre que « En attente de toi »
  const enAttente = useQG(s => s.vues?.taches.enAttente.length);
  const demo = useQG(s => s.demo);
  const haut = useQG(s => s.format === 'haut');
  return (
    <Panel id="nav" className={`flex h-[36px] items-center gap-[2px] pl-[10px] pr-[6px] ${haut ? 'qg-scroll left-[8px] right-[8px] top-[8px] overflow-x-auto' : 'left-[12px] top-[10px]'}`}>
      <span className="mr-[6px] flex items-center gap-[6px] font-serif text-[15px] italic">
        <span className="h-[6px] w-[6px] rounded-full bg-[#2fbf5b]" />QG
      </span>
      {TABS.filter(([id]) => !(demo && ONGLETS_REELS.includes(id))).map(([id, nom]) => (
        <button key={id} onClick={() => setOnglet(id)} className={`shrink-0 rounded-[6px] px-[7px] py-[5px] text-[10.5px] font-semibold ${onglet === id ? 'bg-[#eceaf3]' : 'hover:bg-[#f4f3f8]'}`}>
          {nom}{id === 'equipe' ? ` ${AGENTS.length}` : id === 'taches' && enAttente !== undefined ? ` ${enAttente}` : ''}
        </button>
      ))}
    </Panel>
  );
}

function Tools() {
  // /demo : les éclairs de la simulation ; page privée : seul l'outil d'une tâche en cours a le halo (« seul le halo
  // pour en tâche », 11 novembre 2026) — plus d'éclairs de quelques secondes à l'ouverture de la page. Chaîne stable.
  const lit = useQG(s => (s.demo ? s.snap?.lit : undefined));
  const enTache = useQG(s => (s.demo ? '' : outilsEnTache(s.vues).join(' ')));
  const ouvrir = useQG(s => s.ouvrir);
  const haut = useQG(s => s.format === 'haut');
  // page privée : toutes les icônes en couleur ; les outils des agents en service (même règle que « en service » du
  // compteur) s'allument en vague, aller-retour, dans l'ordre de la barre (src/ui/compteur.ts, allumesVague) ;
  // l'outil d'une tâche en cours reste allumé, figé et soulevé. /demo : pas de vague.
  const enService = useQG(s => (s.demo ? '' : outilsEnService(s.vues, id => agentById(id)?.outils ?? []).join(' ')));
  const vague = TOOLS.filter(t => enService.split(' ').includes(t.key)).map(t => t.key);
  const allumes = useVague(vague.length);
  const place = useEntreNavEtRecherche(!haut);
  return (
    <Panel id="outils" style={place ? { left: place.left, scale: place.k, transformOrigin: '0 50%' } : undefined} className={`flex h-[36px] items-center gap-[7px] px-[7px] ${vague.length ? 'qg-vague' : ''} ${haut ? 'qg-scroll left-[8px] right-[8px] top-[50px] overflow-x-auto' : `top-[10px] ${place ? '' : 'left-1/2 -translate-x-1/2'}`}`}>
      {TOOLS.map(t => (
        <button key={t.key} title={t.nom} aria-label={t.nom} onClick={() => ouvrir({ type: 'outil', id: t.key })} className={`qg-tool qg-tool-barre shrink-0 ${lit?.includes(t.key) || enTache.split(' ').includes(t.key) ? 'qg-tool-lit' : allumes[vague.indexOf(t.key)] ? 'qg-tool-service' : ''}`} style={{ background: t.hex }}>
          <ToolLogo t={t} size={14} />
        </button>
      ))}
    </Panel>
  );
}

/** L'écart (en points d'interface) entre la barre d'outils et les menus voisins : ils ne se touchent jamais. */
const ECART_BARRE = 8;

/**
 * Format large : la barre d'outils se pose au milieu de l'espace entre les onglets (à gauche) et la recherche (à
 * droite), le même écart des deux côtés (pas de creux d'un seul côté), jamais à moins de ECART_BARRE d'eux ; s'il n'y
 * a pas la place, elle rétrécit juste ce qu'il faut (« ça se touche », « y'a un creux », 13 novembre 2026).
 * Les places d'origine seulement : un menu déplacé à la souris reste où on l'a mis.
 */
function useEntreNavEtRecherche(actif: boolean): { left: number; k: number } | null {
  const [place, setPlace] = useState<{ left: number; k: number } | null>(null);
  useLayoutEffect(() => {
    if (!actif) return;
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-panel="${id}"]`);
    const nav = q('nav'), outils = q('outils'), rech = q('recherche');
    const ui = outils?.offsetParent as HTMLElement | null | undefined;
    if (!nav || !outils || !ui) return;
    const calcul = () => {
      const g = nav.offsetLeft + nav.offsetWidth + ECART_BARRE;
      const d = (rech ? rech.offsetLeft : ui.clientWidth - 12) - ECART_BARRE;
      const w = outils.offsetWidth; // sans le rétrécissement (scale ne change pas offsetWidth)
      if (!w) return;
      const k = Math.min(1, (d - g) / w);
      const left = g + (d - g - w * k) / 2;
      setPlace(p => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.k - k) < 0.001 ? p : { left, k }));
    };
    calcul();
    const ro = new ResizeObserver(calcul);
    for (const el of [nav, outils, rech, ui]) if (el) ro.observe(el);
    return () => { ro.disconnect(); setPlace(null); };
  }, [actif]);
  return actif ? place : null;
}

/** Une étape de la vague toutes les 1,5 s ; « réduire les animations » : tous allumés, sans mouvement. */
const PAS_VAGUE_MS = 1500; // « effet escargot » (11 novembre 2026) : un aller-retour complet ≈ 27 s pour 8 outils
function useVague(n: number): boolean[] {
  const [etape, setEtape] = useState(0);
  const [calme] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (calme || n === 0) return;
    const t = setInterval(() => setEtape(e => e + 1), PAS_VAGUE_MS);
    return () => clearInterval(t);
  }, [n, calme]);
  return calme ? Array(n).fill(true) : allumesVague(n, etape);
}

function Search() {
  const demo = useQG(s => s.demo);
  // /demo : le compteur de la simulation ; page privée : les vrais agents au travail (/api/qg/vues)
  const count = useQG(s => s.snap?.count ?? 0);
  // en service · en tâche (src/ui/compteur.ts) ; un objet neuf à chaque lecture : on garde le texte, une chaîne stable
  const reels = useQG(s => (s.vues ? texteCompteur(compteur(s.vues)) : null));
  const enTache = useQG(s => (compteur(s.vues)?.tache ?? 0) > 0);
  const select = useQG(s => s.select);
  const [q, setQ] = useState('');
  const haut = useQG(s => s.format === 'haut');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const n = q.trim().toLowerCase();
    const a = getEngine().agents.find(x => x.named && agentById(x.id)!.nom.toLowerCase().includes(n));
    if (n && a) select(a.id);
  };
  if (haut) return null; // sur téléphone, on cherche dans l'onglet Équipe
  return (
    <Panel id="recherche" className="right-[12px] top-[10px] flex h-[36px] items-center gap-[7px] px-[7px]">
      <form onSubmit={go}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher…" aria-label="Chercher un agent" className="h-[22px] w-[78px] rounded-[6px] bg-[#f1f0f5] px-[8px] text-[9.5px] outline-none" />
      </form>
      <span className="flex items-center gap-[5px] pr-[4px] text-[10.5px] font-semibold"><span className={`h-[6px] w-[6px] rounded-full ${demo || enTache ? 'bg-[#2fbf5b]' : 'bg-[#c9c6d6]'}`} />{demo ? `${count} en cours` : (reels ?? '…')}</span>
    </Panel>
  );
}

function MissionBar() {
  const [v, setV] = useState('');
  const conv = useConversation();
  const { ouvert, ouvrir, fermer } = conv;
  const racine = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const dedans = useRef(false); // un clic dans la barre ou la conversation ne la ferme pas
  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = v.trim();
    if (!t) return;
    setV('');
    // Kuroro répond (règles de src/sim/kuroro.ts) ; une mission part par le même dépôt qu'avant (envoyerMission)
    void conv.envoyer(t);
  };
  // un clic ailleurs ou Échap : la conversation se ferme
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: PointerEvent) => { if (!racine.current?.contains(e.target as Node)) fermer(); };
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') { fermer(); champ.current?.blur(); } };
    document.addEventListener('pointerdown', clic);
    document.addEventListener('keydown', touche);
    return () => { document.removeEventListener('pointerdown', clic); document.removeEventListener('keydown', touche); };
  }, [ouvert, fermer]);
  const haut = useQG(s => s.format === 'haut');
  return (
    <Panel id="mission" className={`px-[8px] pb-[5px] pt-[6px] ${ouvert ? 'z-30' : ''} ${haut ? 'bottom-[8px] left-[8px] right-[8px]' : 'bottom-[10px] left-1/2 w-[440px] -translate-x-1/2'}`}>
      <div
        ref={racine}
        onPointerDownCapture={() => { dedans.current = true; setTimeout(() => { dedans.current = false; }, 0); }}
        onPointerUp={() => { if (ouvert && document.activeElement?.tagName !== 'INPUT') champ.current?.focus(); }}
      >
        <ConversationKuroro conv={conv} />
        <form onSubmit={send} className="flex items-center gap-[7px]">
          <span className="flex items-center gap-[5px] whitespace-nowrap rounded-[6px] bg-[#f1f0f5] py-[3px] pl-[4px] pr-[9px] text-[10.5px] font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headDataUrl('kuroro')} alt="" width={14} height={14} style={{ imageRendering: 'pixelated' }} />
            {haut ? 'Kuroro' : 'Kuroro Lucifer'}
          </span>
          <input
            ref={champ} value={v} onChange={e => setV(e.target.value)} onFocus={ouvrir}
            onBlur={e => { if (!dedans.current && !e.target.value.trim()) fermer(); }}
            placeholder="Donne une mission à Kuroro, ton CEO…" className="min-w-0 flex-1 px-[2px] py-[4px] text-[10px] outline-none"
          />
          <button className="h-[20px] w-[20px] rounded-[6px] bg-[#1d1b2e] text-[11px] font-bold text-white">↑</button>
        </form>
        <p className="mx-[1px] mt-[3px] text-[7.5px] text-[#6b6880]">Kuroro connaît tout le monde et répartit le travail entre les pôles</p>
      </div>
    </Panel>
  );
}

/**
 * Mes réglages (absents des plans) : le moment de la journée, les noms, les menus.
 * Le bureau suit l'heure d'Abidjan (useJourNuit) ; le titre suit le moment de la journée (journee.ts : les arrivées,
 * la matinée, le déjeuner, le coup de mou, la reprise, les départs, la nuit) et une petite ligne dit ce qu'on voit.
 * De jour, je choisis l'ambiance (calme ou pleine journée), rendue le 11 novembre 2026 (« moi j'aimais bien »).
 * La nuit, pas de choix : bureau fermé. /demo : ?moment=. Les inspirations sont au pied de /demo.
 */
function Reglages() {
  const nuit = useQG(s => s.nuit);
  const moment = useQG(s => (s.nuit ? 'nuit' : momentA(minutesDe(s.horloge))));
  const mode = useQG(s => s.mode), setMode = useQG(s => s.setMode);
  const etiquettes = useQG(s => s.etiquettes), toggleEtiquettes = useQG(s => s.toggleEtiquettes);
  const haut = useQG(s => s.format === 'haut');
  const occupe = useQG(s => (s.format === 'haut' && (!!s.selected || !!s.volet || s.onglet !== 'bureau' || s.conversation)) || s.onglet === 'equipe'); // l'organigramme prend toute la place
  const [ouvert, setOuvert] = useState(false);
  if (occupe) return null; // sur téléphone, on laisse la place au panneau ouvert
  if (haut && !ouvert) {
    return <button onClick={() => setOuvert(true)} className="qg-panel absolute bottom-[66px] left-[8px] px-[9px] py-[6px] text-[9px] font-semibold">Réglages</button>;
  }
  return (
    <Panel id="reglages" className={`w-[218px] px-[7px] pb-[6px] pt-[7px] ${haut ? 'bottom-[66px] left-[8px]' : 'bottom-[10px] left-[12px]'}`}>
      {haut && <button onClick={() => setOuvert(false)} className="mb-[4px] w-full text-right text-[9px] text-[#6b6880]">Fermer ×</button>}
      <p className="flex items-center gap-[5px] whitespace-nowrap px-[4px] pt-[2px] text-[7.5px] text-[#6b6880]" title="Le bureau suit l'heure d'Abidjan : ouvert de 07:00 à 20:00">
        <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${nuit ? 'bg-[#5a5f8f]' : 'bg-[#f2b134]'}`} />
        <b className="text-[#1d1b2e]">{TITRES[moment].titre}</b>
      </p>
      <p data-testid="moment-detail" className="whitespace-nowrap px-[4px] pb-[2px] pl-[14px] text-[6.5px] text-[#9a97ad]">
        {!nuit && mode === 'pleine' ? 'tout le monde à son poste' : TITRES[moment].detail}
      </p>
      {/* de jour, je choisis l'ambiance ; la nuit, le bureau est fermé (le choix revient à 07:00) */}
      {!nuit && (
        <div className="qg-seg mt-[2px]">
          <button className={mode === 'calme' ? 'on' : ''} onClick={() => setMode('calme')}>Moment calme</button>
          <button className={mode === 'pleine' ? 'on' : ''} onClick={() => setMode('pleine')}>Pleine journée</button>
        </div>
      )}
      <button onClick={toggleEtiquettes} className="mt-[3px] w-full whitespace-nowrap rounded-[5px] px-[4px] py-[2px] text-left text-[7.5px] text-[#6b6880] hover:bg-[#f4f3f8]" title="Touche E">
        Noms et bulles : <b className="text-[#1d1b2e]">{etiquettes === 'survol' ? 'au survol' : 'toujours'}</b> · touche E
      </button>
      <BoutonSons className="w-full rounded-[5px] px-[4px] py-[2px] text-left text-[7.5px] text-[#6b6880] hover:bg-[#f4f3f8]" />
      {!haut && (
        <button onClick={remettreLesMenus} className="w-full whitespace-nowrap rounded-[5px] px-[4px] py-[2px] text-left text-[7.5px] text-[#6b6880] hover:bg-[#f4f3f8]" title="Les menus se déplacent à la souris">
          Menus : <b className="text-[#1d1b2e]">déplaçables à la souris</b> · remettre en place
        </button>
      )}
    </Panel>
  );
}

function Calque() {
  const calque = useQG(s => s.calque), nextCalque = useQG(s => s.nextCalque);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // le calque de comparaison avec mes plans : outil de construction, seulement avec ?calque dans l'adresse
      if ((e.key === 'c' || e.key === 'C') && new URLSearchParams(window.location.search).has('calque')) nextCalque();
      if (e.key === 'e' || e.key === 'E') useQG.getState().toggleEtiquettes();
      if (e.key === 'Escape') useQG.getState().revenir();
      if ((e.key === 'f' || e.key === 'F') && useQG.getState().demo) document.documentElement.requestFullscreen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextCalque]);
  if (calque === 'aucun') return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="qg-calque" alt="" src={calque === 'calme' ? '/reference/plan-open-space.png' : '/reference/plan-open-space-rempli.png'} />;
}

function Plan() {
  const focus = useQG(s => s.focus), setFocus = useQG(s => s.setFocus), setHoverRoom = useQG(s => s.setHoverRoom);
  const order = ['direction', 'communication', 'code', 'mac', 'cafe', 'pause', 'toilettes', 'atelier', 'reunion', 'cabines', 'studio', 'accords'];
  const haut = useQG(s => s.format === 'haut');
  const occupe = useQG(s => (s.format === 'haut' && (!!s.selected || !!s.volet || s.onglet !== 'bureau' || s.conversation)) || s.onglet === 'equipe'); // l'organigramme prend toute la place
  if (occupe) return null;
  return (
    <Panel id="plan" className={`w-[133px] px-[10px] pb-[10px] pt-[9px] ${haut ? 'bottom-[66px] right-[8px]' : 'bottom-[10px] right-[12px]'}`}>
      <h4 className="mb-[7px] text-[6.5px] font-semibold tracking-[.06em] text-[#6b6880]">PLAN DU BUREAU</h4>
      <div className="grid grid-cols-4 gap-[6px]">
        {order.map(id => {
          const r = ROOMS.find(x => x.id === id)!;
          const Icon = ROOM_ICONS[id];
          return (
            <button
              key={id} title={r.nom} aria-label={r.nom}
              className={`qg-pastille ${focus === id ? 'qg-pastille-on' : ''}`} style={{ background: r.couleur }}
              onClick={() => { setFocus(id); useQG.getState().ouvrir(useQG.getState().focus ? { type: 'piece', id } : null); }} onMouseEnter={() => setHoverRoom(id)} onMouseLeave={() => setHoverRoom(null)}
            >
              <Icon size={11} strokeWidth={2.4} color="#fff" />
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function Toast() {
  const toast = useQG(s => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="absolute bottom-[66px] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-[#1d1b2e] px-[10px] py-[6px] text-[9px] text-white">
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Largeur de base de l'interface en format haut (téléphone) : 340 points, agrandis à la largeur de l'écran. */
const UI_HAUT_W = 340;

/**
 * Le format (large ou haut) et les échelles : --ui pour l'interface, --sc pour les étiquettes de la scène.
 * Format large : interface à la taille de mes plans (1200 × 675), centrée, qui tient dans la fenêtre.
 * Format haut : interface de 340 points de large, en haut à gauche, à la largeur de l'écran.
 */
function useScales() {
  useEffect(() => {
    const set = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const haut = w < 700 || w / h < 0.95;
      const root = document.documentElement.style;
      if (haut) {
        // au plus 1,4 fois la taille de base : sur une tablette, l'interface s'élargit au lieu de grossir
        const largeur = Math.max(UI_HAUT_W, w / 1.4);
        const s = w / largeur;
        root.setProperty('--ui', String(s));
        root.setProperty('--uiw', `${largeur}px`);
        root.setProperty('--uih', `${h / s}px`);
        root.setProperty('--sc', String(s * 0.95));
      } else {
        const s = Math.min(w / UI_W, h / UI_H);
        root.setProperty('--ui', String(s));
        root.setProperty('--sc', String(s));
        // l'interface couvre tout l'écran : sur un écran plus large que 16:9, les panneaux restent collés aux bords
        root.setProperty('--uiw', `${w / s}px`);
        root.setProperty('--uih', `${h / s}px`);
      }
      useQG.getState().setFormat(haut ? 'haut' : 'large');
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, []);
}

/** La visite automatique du mode démo : la caméra passe d'une pièce à l'autre, puis revient à la vue d'ensemble. */
const VISITE = ['communication', 'studio', null, 'code', 'direction', null, 'reunion', 'cafe', null];

/** `?bureau=mafe` : ouvre le bureau de l'agent au chargement (une seule fois ; ignoré en /demo, valeurs inconnues sans effet). */
function useBureauDansLUrl(demo: boolean) {
  useEffect(() => {
    if (demo) return;
    const agent = new URLSearchParams(window.location.search).get('bureau');
    const type = agent && Object.hasOwn(BUREAU_PAR_AGENT, agent) ? BUREAU_PAR_AGENT[agent] : null;
    if (type) useQG.getState().ouvrir({ type });
  }, [demo]);
}

/**
 * J'arrive sur la page : le Mac se réveille et fait lire le prompt de Kuroro au modèle (10 à 20 s) pendant que je
 * regarde le bureau ; quand j'écris à Kuroro, il répond en ≈ 2 s. Ouvrir la conversation le réveille encore. Ignoré en /demo.
 */
function useReveilALArrivee(demo: boolean) {
  useEffect(() => { if (!demo) reveillerMac(); }, [demo]);
}

/** `?arrivee=1` (le relais du Mac) : ouvre le menu des comptes rendus, puis retire le paramètre de l'adresse. Ignoré en /demo. */
function useArriveeDansLUrl(demo: boolean) {
  useEffect(() => {
    if (demo) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('arrivee')) return;
    const ouvre = url.searchParams.get('arrivee') === '1';
    url.searchParams.delete('arrivee');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (ouvre) useQG.getState().setArrivee(true);
  }, [demo]);
}

/**
 * Page privée : le bureau suit l'heure d'Abidjan (UTC), vérifiée chaque minute. La nuit (20:00 – 07:00), lumières
 * baissées et bureau vide, sauf Luffy s'il veille, un vrai agent pendant son travail et Stalker pendant Claude Code.
 */
/**
 * Les sons du jardin (src/scene/sons.ts) : coupés par défaut ; le choix est retenu dans ce navigateur. Si on les avait
 * laissés allumés, ils reprennent au premier geste (le navigateur n'accepte pas le son avant).
 */
function useSons() {
  const sons = useQG(s => s.sons);
  useEffect(() => {
    let oui = false;
    try { oui = lireChoixSons(window.localStorage); } catch { oui = false; }
    if (oui) useQG.setState({ sons: true });
  }, []);
  useEffect(() => {
    const nuit = () => allumage(lumiereA(minutesDe(useQG.getState().horloge))) > 0.5;
    if (!sons) { arreterSons(); return; }
    if (navigator.userActivation?.hasBeenActive) { demarrerSons(nuit); return; }
    const auPremierGeste = () => demarrerSons(nuit);
    window.addEventListener('pointerdown', auPremierGeste, { once: true });
    return () => window.removeEventListener('pointerdown', auPremierGeste);
  }, [sons]);
}

/** « Sons : oui / non » : dans les Réglages, et à côté de « Plein écran » dans /demo. */
function BoutonSons({ className }: { className: string }) {
  const sons = useQG(s => s.sons);
  const basculer = () => {
    const oui = !sons;
    try { ecrireChoixSons(window.localStorage, oui); } catch { /* stockage refusé */ }
    useQG.setState({ sons: oui });
    if (oui) demarrerSons(() => allumage(lumiereA(minutesDe(useQG.getState().horloge))) > 0.5); else arreterSons();
  };
  return (
    <button onClick={basculer} className={className} title="Des oiseaux le jour, un grillon la nuit, tout bas">
      Sons : <b className="text-[#1d1b2e]">{sons ? 'oui' : 'non'}</b>
    </button>
  );
}

function useJourNuit(demo: boolean) {
  const luffyVeille = useQG(s => !!s.vues?.luffyVeille);
  const astreinte = useQG(s => s.vues?.astreinte ?? null);
  const reunion = useQG(s => s.reunion);
  // changer de moment recrée la simulation (version) : on lui redonne aussitôt la nuit, la veille de Luffy, l'astreinte
  // et la réunion de crise en cours
  const version = useQG(s => s.version);
  useEffect(() => {
    if (demo) return;
    const verifier = () => {
      const nuit = !estJour(Date.now());
      getEngine().setNuit(nuit);
      if (useQG.getState().nuit !== nuit) useQG.setState({ nuit });
    };
    verifier();
    const t = setInterval(verifier, 60_000);
    return () => clearInterval(t);
  }, [demo, version]);
  useEffect(() => {
    if (!demo) { getEngine().setLuffyVeille(luffyVeille); getEngine().setAstreinte(astreinte); getEngine().setReunion(reunion); }
  }, [demo, luffyVeille, astreinte, reunion, version]);
}

/**
 * La journée qui vit (journee.ts) : la simulation reçoit l'heure d'Abidjan à chaque changement de minute (page privée :
 * l'heure réelle ; /demo : celle de ?heure=, la même que la lumière). Une nouvelle simulation (version) la reçoit aussitôt.
 */
function useJournee(demo: boolean) {
  const horloge = useQG(s => s.horloge);
  const version = useQG(s => s.version);
  useEffect(() => {
    // l'heure relue au moment de l'effet (pas celle du premier rendu, encore l'heure réelle dans /demo) : pas de faux
    // passage par le soir qui ferait sortir tout le monde avant de revenir à l'heure de ?heure=
    getEngine().setHeure(horlogeDeLaPage(demo));
  }, [horloge, version, demo]);
}

/**
 * L'heure d'Abidjan (UTC) pour le ciel, la lumière, les ombres et l'horloge du mur : relue à chaque changement de
 * minute (jamais à chaque image). Page privée : toujours l'heure réelle. /demo : part de 10:30 (ou de `?heure=`)
 * puis avance en temps réel. Posée avant la première image (useLayoutEffect) : pas de glissement au chargement.
 */
function useHorloge(demo: boolean) {
  const forcee = useQG(s => (demo ? s.heureDemo ?? HEURE_DEMO : null));
  const debut = useQG(s => (demo ? s.debutDemo : null));
  const jour = useQG(s => (demo ? s.jourDemo : null));
  useLayoutEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const maj = () => {
      const now = Date.now();
      const horloge = forcee === null ? instantAbidjan(now, null) : instantDemo(now, forcee, debut ?? now, jour);
      if (useQG.getState().horloge !== horloge) useQG.setState({ horloge });
      // juste après la minute suivante (celle de la démo compte depuis son ouverture)
      const repere = forcee === null ? 0 : debut ?? now;
      t = setTimeout(maj, 60_000 - ((now - repere) % 60_000) + 50);
    };
    maj();
    return () => clearTimeout(t);
  }, [forcee, debut, jour]);
}

/** Le mode démo : options lues dans l'adresse, visite automatique, curseur caché quand on ne bouge plus. */
function useDemo(demo: boolean) {
  const [curseur, setCurseur] = useState(true);
  // l'heure de départ (?heure=17:20) : la lumière, les ombres, l'horloge et la journée partent de cette heure, puis
  // avancent en temps réel ; sans ?heure=, 10:30 (plein jour, pleine énergie). Lu avant la première image.
  useLayoutEffect(() => {
    if (!demo) return;
    const q = new URLSearchParams(window.location.search);
    // ?jour=samedi : le week-end (moins de monde, les matchs du samedi), pour le voir sans attendre
    useQG.setState({ heureDemo: heureDeLaDemo(q.get('heure')), debutDemo: Date.now(), jourDemo: lireJour(q.get('jour')) });
  }, [demo]);
  useEffect(() => {
    if (!demo) return;
    const q = new URLSearchParams(window.location.search);
    useQG.getState().setDemo(q.get('moment') === 'pleine' ? 'pleine' : 'calme');
    // petit point d'accès pour vérifier le mode démo automatiquement (scripts/verif-demo.mjs)
    (window as unknown as { __qgDemo?: object }).__qgDemo = {
      circulent: () => getEngine().agents.filter(a => a.path.length > 0).length,
      bulles: () => getEngine().bubbles.length,
      echange: () => getEngine().echange,
      outilsSansHistorique: () => TOOLS.filter(t => !getEngine().usages.some(u => u.tool === t.key)).map(t => t.nom),
    };
    let visite: ReturnType<typeof setInterval> | undefined;
    if (q.get('visite')) {
      let i = 0;
      visite = setInterval(() => {
        const id = VISITE[i++ % VISITE.length];
        useQG.setState({ focus: id, volet: null, selected: null });
      }, 7000);
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const bouge = () => { setCurseur(true); clearTimeout(t); t = setTimeout(() => setCurseur(false), 2500); };
    window.addEventListener('pointermove', bouge);
    bouge();
    return () => { clearInterval(visite); clearTimeout(t); window.removeEventListener('pointermove', bouge); };
  }, [demo]);
  return curseur;
}

/**
 * « Remettre la vue » : après avoir tourné, incliné, zoomé ou déplacé la vue, un bouton revient exactement au cadrage
 * de mes plans (vue.ts). Il n'apparaît que si la vue a bougé.
 */
function RemettreLaVue() {
  const [bougee, setBougee] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setBougee(vueBougee()), 250);
    return () => clearInterval(t);
  }, []);
  const haut = useQG(s => s.format === 'haut');
  if (!bougee) return null;
  return (
    <button
      onClick={() => { remettreLaVue(); useQG.setState({ focus: null }); setBougee(false); }}
      className={`qg-panel absolute px-[9px] py-[6px] text-[9px] font-semibold ${haut ? 'bottom-[66px] right-[150px]' : 'bottom-[10px] right-[155px]'}`}
      title="Revenir à l'angle, au zoom et au cadrage de départ"
    >
      Remettre la vue
    </button>
  );
}

function PleinEcran() {
  const [plein, setPlein] = useState(false);
  useEffect(() => {
    const f = () => setPlein(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const haut = useQG(s => s.format === 'haut');
  if (plein || haut) return null;
  return (
    <button
      onClick={() => document.documentElement.requestFullscreen?.()}
      className="qg-panel absolute bottom-[10px] left-[12px] px-[9px] py-[6px] text-[9px] font-semibold"
    >
      Plein écran · F
    </button>
  );
}

export default function QGApp({ demo = false }: { demo?: boolean }) {
  useScales();
  const curseur = useDemo(demo);
  useReel(demo);
  useBureauDansLUrl(demo);
  useArriveeDansLUrl(demo);
  useReveilALArrivee(demo);
  useVuesQG(demo);
  useJourNuit(demo);
  useHorloge(demo);
  useSons();
  useJournee(demo);
  const format = useQG(s => s.format);
  // le ciel et la lumière de la scène suivent l'heure, en continu (src/sim/lumiere.ts) ; l'ouverture du bureau
  // (07:00 – 20:00, useJourNuit) ne change pas
  const l = lumiereA(minutesDe(useQG(s => s.horloge)));
  const ciel = { '--ciel-haut': l.cielHaut, '--ciel-milieu': l.cielMilieu, '--ciel-bas': l.cielBas } as CSSProperties;
  // la luminosité est rendue dans la scène 3D (Lumieres.tsx : les lampes et les pièces occupées y échappent) ;
  // ici, seulement la couleur (saturation, sépia)
  const filtre = l.saturation === 1 && l.sepia === 0 ? 'none' : `saturate(${l.saturation}) sepia(${l.sepia})`;
  const nuitCiel = astres(l);
  return (
    <main style={ciel} className={`qg-sky relative h-dvh w-full overflow-hidden text-[#1d1b2e] ${demo && !curseur ? 'cursor-none' : ''}`}>
      {/* la nuit, la lune et les étoiles, dans le ciel derrière l'île */}
      <div className="qg-astres" style={{ opacity: nuitCiel }} aria-hidden><div className="qg-lune" /></div>
      <div className="qg-scene absolute inset-0" style={{ filter: filtre }}><Scene /></div>
      <Overlay />
      <div className={`qg-ui ${format === 'haut' ? 'qg-ui-haut' : ''}`}>
        <Nav />
        <Tools />
        <Search />
        <Volets />
        <OngletPanel />
        {!demo && <BureauL />}
        {!demo && <ReleveLight />}
        {!demo && <BureauClara />}
        {!demo && <BureauMafe />}
        {!demo && <BureauLuffy />}
        {!demo && <BureauIsaac />}
        {!demo && <BureauZoro />}
        {!demo && <BureauLea />}
        {!demo && <BureauPaul />}
        {!demo && <BureauYe />}
        {!demo && <BureauFeu />}
        {!demo && <EnEcoute />}
        {!demo && <ComptesRendus />}
        <MissionBar />
        <Toast />
        <Plan />
        <RemettreLaVue />
        {demo ? <PleinEcran /> : <Reglages />}
        {demo && format !== 'haut' && <BoutonSons className="qg-panel absolute bottom-[10px] left-[100px] px-[9px] py-[6px] text-[9px] font-semibold text-[#6b6880]" />}
        {demo && (
          <p className="pointer-events-none absolute bottom-[3px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[5.5px] text-white/80">
            Inspirations : Anthony Quinchon (la méthode) · Zeyneb Madi (l&apos;archipel) · AJ Sahni (Agents Office)
          </p>
        )}
      </div>
      <Calque />
    </main>
  );
}
