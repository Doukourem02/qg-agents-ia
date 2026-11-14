'use client';
import { useEffect, useRef, useState } from 'react';
import { getEngine, useQG } from '@/store';
import { agentById } from '@/sim/routing';
import { AUDITEURS } from '@/sim/ecoute';
import type { VueEcoute } from '@/server/spotify/ecoute';
import { Panel } from './Panel';

// « En écoute » : ce que je joue sur mon vrai Spotify, lu toutes les 15 secondes (pas en mode démo).
// Le 7e menu déplaçable. Au bureau, un des quatre agents reliés à Spotify met le casque (voir Engine.appliquerEcoute).

const VERT = '#1DB954';
export const URL_CONNEXION_SPOTIFY = 'https://mon-qg.vercel.app/api/spotify/connexion';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** La vue Spotify, relue toutes les 15 s ; une réponse plus ancienne n'écrase jamais une plus fraîche. */
function useEcoute() {
  const [lu, setLu] = useState<{ vue: VueEcoute; recu: number } | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const derniere = useRef(0);
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const n = ++derniere.current;
      try {
        const r = await fetch('/api/spotify/ecoute', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const vue = await r.json() as VueEcoute;
        if (arret || n !== derniere.current) return;
        setLu({ vue, recu: Date.now() });
        setHorsLigne(false);
      } catch {
        if (!arret && n === derniere.current) setHorsLigne(true);
      }
    };
    void lire();
    const t = setInterval(() => { void lire(); }, 15_000);
    return () => { arret = true; clearInterval(t); };
  }, []);
  // le bureau suit ce que j'écoute ; réappliqué quand la simulation est recréée (changement de moment)
  const version = useQG(s => s.version);
  useEffect(() => {
    if (lu) getEngine().appliquerEcoute(lu.vue.connecte ? lu.vue.enCours : null);
  }, [lu, version]);
  return { lu, horsLigne };
}

/** Le temps qui passe, pour faire avancer la barre entre deux lectures. */
function useMaintenant(actif: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [actif]);
  return now;
}

function Contenu() {
  const { lu, horsLigne } = useEcoute();
  const e = lu?.vue.connecte ? lu.vue.enCours : null;
  const now = useMaintenant(!!e?.joue);
  const auditeur = useQG(s => s.snap?.danse.find(id => (AUDITEURS as readonly string[]).includes(id)) ?? null);
  if (!lu) return <p className="text-[8px] text-[#6b6880]">{horsLigne ? 'Pas de connexion au serveur.' : '…'}</p>;
  if (!lu.vue.connecte) {
    return (
      <p className="text-[8px] text-[#6b6880]">
        Spotify non connecté · <a href={URL_CONNEXION_SPOTIFY} target="_blank" rel="noreferrer" className="font-semibold text-[#1d1b2e] underline">Connecter Spotify</a>
      </p>
    );
  }
  if (!e) return <p className="text-[8px] text-[#6b6880]">rien en cours</p>;
  const prog = Math.min(e.dureeMs || Infinity, e.progressionMs + (e.joue ? Math.max(0, now - lu.recu) : 0));
  const part = e.dureeMs ? Math.min(100, (prog / e.dureeMs) * 100) : 0;
  return (
    <div className="flex items-center gap-[7px]">
      {e.pochette
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={e.pochette} alt={`Pochette de « ${e.album || e.titre} »`} width={34} height={34} className="h-[34px] w-[34px] shrink-0 rounded-[4px] object-cover" />
        : <span className="h-[34px] w-[34px] shrink-0 rounded-[4px] bg-[#f1f0f5]" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[8.5px] font-bold leading-tight" title={e.titre}>{e.titre}</div>
        <div className="truncate text-[7.5px] leading-tight text-[#6b6880]" title={e.artistes}>{e.artistes}</div>
        <div className="mt-[4px] h-[3px] overflow-hidden rounded-full bg-[#ecebf2]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part)}>
          <div className="h-full rounded-full" style={{ width: `${part}%`, background: VERT }} />
        </div>
        <div className="mt-[2px] flex justify-between text-[6.5px] text-[#6b6880]">
          <span>{mmss(prog)}{e.joue ? '' : ' · en pause'}</span>
          <span>{e.dureeMs ? mmss(e.dureeMs) : ''}</span>
        </div>
        {auditeur && <div className="truncate text-[6.5px] text-[#6b6880]">🎧 {agentById(auditeur)?.nom} écoute</div>}
      </div>
    </div>
  );
}

export function EnEcoute() {
  const haut = useQG(s => s.format === 'haut');
  const occupe = useQG(s => s.format === 'haut' && (!!s.selected || !!s.volet || s.onglet !== 'bureau'));
  return (
    <Panel id="ecoute" className={`px-[9px] pb-[7px] pt-[7px] ${haut ? `right-[8px] top-[92px] w-[160px] ${occupe ? 'hidden' : ''}` : 'right-[12px] top-[54px] w-[176px]'}`}>
      <h4 className="mb-[5px] flex items-center gap-[4px] text-[6.5px] font-semibold tracking-[.06em] text-[#6b6880]">
        <span className="h-[5px] w-[5px] rounded-full" style={{ background: VERT }} />EN ÉCOUTE
      </h4>
      <Contenu />
    </Panel>
  );
}
