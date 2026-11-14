'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Engine, SimAgent } from '@/sim/engine';
import { ASSISES } from '@/data/layout';
import { agentById } from '@/sim/routing';
import { getEngine, useQG } from '@/store';
import { directionCamera, vue } from './vue';
import { PX_PER_UNIT, SPRITE_H, SPRITE_W, spriteTexture, type Frame } from './sprites';

export const SW = SPRITE_W / PX_PER_UNIT, SH = SPRITE_H / PX_PER_UNIT;

// S'asseoir : arrêté sur une place assise (poste, table, chaise de réunion, tabouret de cabine), un personnage descend
// de la hauteur d'une assise ; le sol cache ses jambes, il paraît assis sur sa chaise. Il se lève pour danser ou saluer.
/** De combien descend un personnage assis. */
export const ASSIS = 0.1;
/** Allongé dans le hamac : la hauteur du creux de la toile (paysage.ts, hamac()). */
const HAMAC_Z = 0.58;
/** … et de combien il avance vers la caméra (en x et en y). */
const AVANCE = 0.13;
const cle = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
const PLACES_ASSISES = new Set(ASSISES.map(([x, y]) => cle(x, y)));
export function estAssis(a: SimAgent, e: Engine) {
  if (a.path.length || !PLACES_ASSISES.has(cle(a.x, a.y))) return false;
  return !(a.named && (e.dansant(a.id) || e.salue(a.id)));
}

// Le casque de l'agent qui écoute mon Spotify : 12 × 7 pixels, dessinés une fois, en pixels nets comme les sprites.
const CASQUE_W = 12, CASQUE_H = 7;
let casque: THREE.CanvasTexture | null = null;
function casqueTexture() {
  if (casque) return casque;
  const c = document.createElement('canvas');
  c.width = CASQUE_W; c.height = CASQUE_H;
  const r = c.getContext('2d')!;
  r.fillStyle = '#1d1b2e';
  r.fillRect(3, 0, 6, 1); r.fillRect(2, 1, 1, 1); r.fillRect(9, 1, 1, 1); r.fillRect(1, 2, 1, 2); r.fillRect(10, 2, 1, 2); // l'arceau
  r.fillStyle = '#1DB954';
  r.fillRect(0, 3, 3, 4); r.fillRect(9, 3, 3, 4); // les écouteurs, au vert Spotify
  casque = new THREE.CanvasTexture(c);
  casque.magFilter = THREE.NearestFilter; casque.minFilter = THREE.NearestFilter;
  casque.colorSpace = THREE.SRGBColorSpace;
  return casque;
}

/**
 * La danse, bien marquée : deux temps par seconde. À chaque temps il saute (jusqu'à 7 px), se penche franchement
 * d'un côté puis de l'autre, et fait un petit pas de côté (3 px) ; à la retombée, il s'écrase un peu (effet ressort).
 */
export function pasDeDanse(t: number) {
  const phase = t * Math.PI * 2; // 1 cycle = 1 s = 2 temps
  const saut = Math.abs(Math.sin(phase));
  const rebond = Math.round(saut * 7) / PX_PER_UNIT;
  const cote = Math.sin(phase / 2) >= 0 ? 1 : -1; // change de côté à chaque temps
  const balance = cote * 0.26;
  const decale = (cote * 3) / PX_PER_UNIT;
  const ecrase = 1 - (1 - saut) * 0.12; // 0,88 au sol, 1 en l'air
  return { rebond, balance, decale, ecrase };
}

/** Le salut : un petit saut doux, répété (environ 1,5 fois par seconde), sur place, sans se pencher. */
export function pasDeSalut(t: number) {
  const rebond = Math.round(Math.abs(Math.sin(t * Math.PI * 1.5)) * 3) / PX_PER_UNIT;
  return { rebond, balance: 0, decale: 0, ecrase: 1 };
}

function AgentSprite({ a }: { a: SimAgent }) {
  const group = useRef<THREE.Group>(null);
  const flip = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const corps = useRef<THREE.Group>(null);
  const marque = useRef<THREE.Mesh>(null);
  const clickable = a.named && !!agentById(a.id);

  useFrame(() => {
    const e = getEngine();
    if (!group.current || !mat.current || !flip.current || !corps.current) return;
    // assis : un peu plus bas et un peu vers l'avant (vers la caméra), pour que le dossier de sa chaise, derrière lui,
    // ne cache pas son visage (le personnage est une image penchée vers la caméra : son haut part en arrière)
    const assis = estAssis(a, e);
    // (vers la caméra, quel que soit l'angle de la vue)
    const [cx, , cz] = directionCamera(vue.az, vue.el), n = Math.hypot(cx, cz) || 1, av = assis ? AVANCE * Math.SQRT2 : 0;
    group.current.position.set(a.x + (cx / n) * av, assis ? -ASSIS : 0, a.y + (cz / n) * av);
    // la nuit, ceux qui sont rentrés chez eux ne sont pas dessinés ; ni celui qui est dans une cabine des toilettes
    group.current.visible = e.visible(a.id);
    // la sieste : allongé dans le hamac, au creux de la toile
    const allonge = e.allonge(a);
    // (posé sur la toile, un peu vers la caméra : la toile ne le cache pas)
    if (allonge) group.current.position.set(a.x + (cx / n) * 0.25, HAMAC_Z, a.y + (cz / n) * 0.25);
    // l'agent qui écoute mon vrai Spotify danse sur place (pas pendant qu'il marche)
    const danse = a.named && !a.path.length && e.dansant(a.id);
    // l'agent dont le compte rendu est ouvert salue à sa place (jamais en marchant, ni par-dessus la danse)
    const salue = !danse && a.named && !a.path.length && e.salue(a.id);
    const pas = danse ? pasDeDanse(e.t) : salue ? pasDeSalut(e.t) : { rebond: 0, balance: 0, decale: 0, ecrase: 1 };
    corps.current.position.y = allonge ? 0 : pas.rebond;
    corps.current.position.x = allonge ? SH / 2 : pas.decale;
    corps.current.rotation.z = allonge ? Math.PI / 2 : pas.balance;
    corps.current.scale.y = pas.ecrase;
    if (marque.current) marque.current.visible = danse;
    let frame: Frame = 'idle';
    if (a.path.length) frame = Math.floor(e.t * 7) % 2 ? 'walk1' : 'walk0';
    else if (danse) frame = Math.floor(e.t * 2) % 2 ? 'walk1' : 'walk0';
    else if (salue) frame = Math.floor(e.t * 3) % 2 ? 'wave1' : 'wave0';
    else if (e.atHome(a) && !a.still) frame = Math.floor(e.t * 3 + a.home[0]) % 2 ? 'type1' : 'type0';
    const tex = spriteTexture(a.look, frame);
    if (mat.current.map !== tex) mat.current.map = tex;
    flip.current.scale.x = a.facing;
  });

  return (
    <group ref={group}>
      <Billboard>
        <group ref={flip}>
          <group ref={corps}>
          <mesh
            position={[0, SH / 2, 0]}
            onClick={clickable ? ev => { if (!getEngine().present(a.id)) return; ev.stopPropagation(); if (vue.glisse || ev.delta > 5) return; useQG.getState().select(a.id); } : undefined}
            onPointerOver={clickable ? ev => { if (!getEngine().present(a.id)) return; ev.stopPropagation(); document.body.style.cursor = 'pointer'; useQG.getState().setHoverAgent(a.id); } : undefined}
            onPointerOut={clickable ? () => { document.body.style.cursor = ''; if (useQG.getState().hoverAgent === a.id) useQG.getState().setHoverAgent(null); } : undefined}
          >
            <planeGeometry args={[SW, SH]} />
            <meshBasicMaterial ref={mat} transparent alphaTest={0.5} map={spriteTexture(a.look, 'idle')} />
          </mesh>
          {a.named && (
            <mesh ref={marque} visible={false} position={[0, SH - 3 / PX_PER_UNIT, 0.001]}>
              <planeGeometry args={[CASQUE_W / PX_PER_UNIT, CASQUE_H / PX_PER_UNIT]} />
              <meshBasicMaterial transparent alphaTest={0.5} map={casqueTexture()} />
            </mesh>
          )}
          </group>
        </group>
      </Billboard>
    </group>
  );
}

export function Agents() {
  const version = useQG(s => s.version); // nouvelle simulation (changement de moment) → nouveaux personnages
  const agents = getEngine().agents;
  return <>{agents.map(a => <AgentSprite key={`${version}-${a.id}`} a={a} />)}</>;
}
