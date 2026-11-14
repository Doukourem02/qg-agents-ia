'use client';
import { UtensilsCrossed } from 'lucide-react';
import { ANNEXES, ROOMS } from '@/data/layout';
import { anchor } from '@/scene/overlay';
import { ROOM_ICONS } from './icons';
import { agentById } from '@/sim/routing';
import { getEngine, useQG } from '@/store';
import { etiquettesPieces } from '@/data/pieces';
import { texteHorloge } from '@/sim/lumiere';
import { rendezVous } from './rendezVous';

// Le calque des étiquettes, au-dessus de la scène 3D. La scène déplace chaque élément à chaque image.

function Bubble({ id }: { id: string }) {
  const bubble = useQG(s => s.snap?.bubbles.find(b => b.agentId === id));
  return (
    <div ref={anchor(`bub:${id}`)} className="qg-anchor" style={{ zIndex: 3 }}>
      {bubble && (
        <div className="qg-bubble">
          <small>● {bubble.label}</small>
          <i>{bubble.text}</i>
        </div>
      )}
    </div>
  );
}

function Rooms() {
  const sim = useQG(s => s.snap?.rooms);
  const demo = useQG(s => s.demo);
  const enAttente = useQG(s => s.vues?.taches.enAttente.length);
  const salle = useQG(s => s.snap?.salle ?? null);
  const rooms = sim && etiquettesPieces(sim, demo, enAttente, salle);
  const hoverRoom = useQG(s => s.hoverRoom), focus = useQG(s => s.focus);
  return (
    <>
      {ROOMS.map(r => {
        const Icon = ROOM_ICONS[r.id];
        return (
          <div key={`i-${r.id}`} ref={anchor(`rico:${r.id}`)} className="qg-anchor" style={{ zIndex: 1 }}>
            <div className="qg-rico" style={{ background: r.couleur }} title={r.nom}><Icon size={9} strokeWidth={2.6} color="#fff" /></div>
          </div>
        );
      })}
      {/* la Salle à manger (annexe de la Cuisine) : ses couverts et son nom, comme une pièce */}
      {ANNEXES.map(a => (
        <div key={`i-${a.cle}`} ref={anchor(`rico:${a.cle}`)} className="qg-anchor" style={{ zIndex: 1 }}>
          <div className="qg-rico" style={{ background: a.couleur }} title={a.nom}><UtensilsCrossed size={9} strokeWidth={2.6} color="#fff" /></div>
        </div>
      ))}
      {ANNEXES.map(a => (
        <div key={a.cle} ref={anchor(`room:${a.cle}`)} className="qg-anchor" style={{ zIndex: 1 }}>
          <div className="qg-room" style={{ background: a.couleur }}>
            <b>{a.nom}</b>
            <span />
          </div>
        </div>
      ))}
      {ROOMS.map(r => (
        <div key={r.id} ref={anchor(`room:${r.id}`)} className="qg-anchor" style={{ zIndex: 1 }}>
          <div className={`qg-room ${hoverRoom === r.id || focus === r.id ? 'qg-room-ouverte' : ''}`} style={{ background: r.couleur }}>
            <b>{r.nom}</b>
            <span>{rooms?.[r.id] ?? ''}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/** Sous le nom d'un vrai agent, au survol (ou sélectionné) : son prochain rendez-vous réel. Jamais dans /demo. */
function RendezVous({ id }: { id: string }) {
  const ligne = useQG(s => (s.demo ? null : rendezVous(s.vues?.agents.find(x => x.agent === id), s.vues?.maintenant)));
  const montre = useQG(s => s.hoverAgent === id || s.selected === id);
  return ligne && montre ? <small>{ligne}</small> : null;
}

/** L'étiquette de l'horloge du mur, au survol : « 17:20 · mercredi 11 novembre » (heure d'Abidjan). */
function EtiquetteHorloge() {
  const texte = useQG(s => texteHorloge(s.horloge));
  return (
    <div ref={anchor('horloge')} className="qg-anchor" style={{ zIndex: 2 }}>
      <div className="qg-tag">{texte}</div>
    </div>
  );
}

export default function Overlay() {
  const version = useQG(s => s.version);
  const selected = useQG(s => s.selected);
  const agents = getEngine().agents;
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden [isolation:isolate]" key={version}>
      <Rooms />
      <EtiquetteHorloge />
      {agents.filter(a => a.named).map(a => (
        <div key={`t-${a.id}`} ref={anchor(`tag:${a.id}`)} className="qg-anchor" style={{ zIndex: 2 }}>
          <div className={`qg-tag ${selected === a.id ? 'qg-tag-on' : ''}`}>{agentById(a.id)?.nom}<RendezVous id={a.id} /></div>
        </div>
      ))}
      {agents.map(a => <Bubble key={`b-${a.id}`} id={a.id} />)}
      {agents.map(a => (
        <div key={`d-${a.id}`} ref={anchor(`dot:${a.id}`)} className="qg-anchor" style={{ zIndex: 2 }}>
          <div className="qg-dot">···</div>
        </div>
      ))}
    </div>
  );
}
