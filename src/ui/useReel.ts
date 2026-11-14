'use client';
import { useEffect } from 'react';
import { getEngine, useQG } from '@/store';

// Phase 2 : la page lit l'état réel des agents toutes les 20 secondes et l'applique à la simulation.
// Rien en mode démo (données fictives pour filmer).

export type Reel = { source: 'upstash' | 'memoire' | 'hors ligne'; derniere: number | null };

export function useReel(demo: boolean) {
  useEffect(() => {
    if (demo) return;
    let arret = false;
    const lire = async () => {
      try {
        const r = await fetch('/api/etat', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (arret) return;
        getEngine().appliquerReel(d.etats ?? {});
        // la réunion de crise réelle : la simulation la reçoit (QGApp, useJourNuit), la salle la suit
        useQG.setState({ reel: { source: d.source, derniere: Date.now() }, reunion: d.reunion ?? null });
      } catch {
        if (!arret) useQG.setState({ reel: { source: 'hors ligne', derniere: null } });
      }
    };
    lire();
    const t = setInterval(lire, 20_000);
    return () => { arret = true; clearInterval(t); };
  }, [demo]);
}

/** Envoie une mission au serveur ; renvoie l'agent choisi, ou null si le serveur ne répond pas. */
export async function envoyerMission(texte: string, agent?: string): Promise<string | null> {
  if (useQG.getState().demo) return null;
  try {
    const r = await fetch('/api/missions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texte, agent }) });
    if (!r.ok) return null;
    // une action immédiate (« vérifie mes sites ») est faite par le serveur au lieu d'être déposée
    const v = await r.json();
    return v.mission?.agent ?? v.action?.mission?.agent ?? null;
  } catch {
    return null;
  }
}
