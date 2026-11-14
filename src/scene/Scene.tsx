'use client';
import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { ANNEXES, partiesDe, PLAN, ROOMS, planToGrid } from '@/data/layout';
import { getEngine, useQG } from '@/store';
import { Agents, ASSIS, estAssis, SH } from './Agents';
import { Horloge, HORLOGE } from './Horloge';
import { Lumieres } from './Lumieres';
import { Nature } from './Nature';
import { Vie } from './Vie';
import { Activites } from './Activites';
import { place, taille } from './overlay';
import { boiteEcran, ecarterBulles, type Forme } from './bulles';
import type { Engine } from '@/sim/engine';
import { angleProche, axesEcran, COTES_MURS, decalageConversation, directionCamera, mursAbaisses, surGeste, surRoulette, tourner, vue, zoomBorne } from './vue';
import { World } from './World';

// La caméra reproduit exactement le cadrage de mes plans : isométrie 2:1 (vue à 30°), 30 px par case
// sur une image de 2400 × 1350, recadrée pour couvrir la fenêtre comme une image en « cover ». On peut tourner
// autour du bureau et l'incliner (vue.ts) ; « Remettre la vue » revient exactement à ce cadrage.
const DIR = new THREE.Vector3();
const [TX, TZ] = planToGrid(PLAN.w / 2, PLAN.h / 2); // la case au centre de l'image
const HOME = new THREE.Vector3(TX, 0, TZ);
const ZOOM_FOCUS = 2.2; // agrandissement quand on clique une pastille du plan

/**
 * Caméra au cadrage du plan. L'île tient toujours entière dans la fenêtre (comme une image en « contain ») ;
 * un clic sur une pièce la fait glisser vers elle ; on peut aussi déplacer la vue et zoomer à la main.
 */
function PlanCamera() {
  const target = useRef(HOME.clone());
  const zoomK = useRef(1);
  const goal = useRef(new THREE.Vector3());
  useFrame(({ camera, size }, dt) => {
    const cam = camera as THREE.OrthographicCamera;
    const { focus, format, conversation } = useQG.getState();
    const room = focus ? ROOMS.find(r => r.id === focus) : undefined;
    if (room) goal.current.set(room.r[0] + room.r[2] / 2, 0, room.r[1] + room.r[3] / 2);
    else goal.current.copy(HOME);
    goal.current.x += vue.panX; goal.current.z += vue.panZ;
    // pendant la conversation avec Kuroro, l'île remonte (en douceur) et laisse le ciel du bas à Kuroro et aux bulles
    if (conversation) {
      const o = decalageConversation(vue.az, vue.el, size.height, vue.camZoom);
      goal.current.x += o.x; goal.current.z += o.z;
    }
    const t = 1 - Math.exp(-dt * 8);
    target.current.lerp(goal.current, t);
    zoomK.current += ((room ? ZOOM_FOCUS : 1) - zoomK.current) * t;
    // la rotation et l'inclinaison glissent vers celles voulues ; les murs se baissent quand ils cachent l'intérieur
    vue.az += (vue.azimut - vue.az) * t;
    vue.el += (vue.elevation - vue.el) * t;
    if (Math.abs(vue.azimut - vue.az) < 1e-4) vue.az = vue.azimut;
    if (Math.abs(vue.elevation - vue.el) < 1e-4) vue.el = vue.elevation;
    const bas = mursAbaisses(vue.az), m = 1 - Math.exp(-dt * 10);
    for (const c of COTES_MURS) vue.murs[c] += ((bas[c] ? 0 : 1) - vue.murs[c]) * m;
    DIR.set(...directionCamera(vue.az, vue.el));
    // en format haut, on part zoomé sur le centre du bureau (on glisse pour se déplacer) ; en format large, l'île tient entière
    const k = format === 'haut' ? size.width / 1500 : Math.min(size.width / PLAN.w, size.height / PLAN.h);
    cam.position.copy(target.current).addScaledVector(DIR, 100);
    cam.lookAt(target.current);
    // une case le long de x avance de 30 px à l'horizontale dans le plan : zoom × cos 45° = 30 k
    cam.zoom = ((PLAN.case * k) / Math.SQRT1_2) * zoomK.current * vue.zoom;
    vue.camZoom = cam.zoom;
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Les gestes : glisser pour déplacer la vue ; molette ou pincement pour zoomer ; clic droit glissé (ou ctrl, ou option
 * + glisser) pour tourner autour du bureau et l'incliner ; à deux doigts sur un écran tactile, pincer et tourner.
 */
function useGestes() {
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const depart = useRef<{ x: number; y: number; d: number; zoom: number; angle: number; azimut: number; tourne: boolean } | null>(null);
  const distance = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const angle = () => { const [a, b] = [...pts.current.values()]; return Math.atan2(b.y - a.y, b.x - a.x); };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      vue.glisse = false;
      const deux = pts.current.size === 2;
      // tourner : clic droit, ou ctrl / option avec le clic (pavé tactile)
      const tourne = e.button === 2 || (e.pointerType === 'mouse' && (e.ctrlKey || e.altKey));
      depart.current = { x: e.clientX, y: e.clientY, d: deux ? distance() : 0, zoom: vue.zoom, angle: deux ? angle() : 0, azimut: vue.azimut, tourne };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pts.current.get(e.pointerId);
      if (!prev || !depart.current) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.current.set(e.pointerId, cur);
      if (pts.current.size === 2) {
        if (!depart.current.d) { depart.current.d = distance(); depart.current.angle = angle(); depart.current.azimut = vue.azimut; }
        vue.zoom = zoomBorne(depart.current.zoom * (distance() / depart.current.d));
        vue.azimut = depart.current.azimut - angleProche(angle(), depart.current.angle); // tourner à deux doigts
        vue.glisse = true;
        return;
      }
      if (!vue.glisse && Math.hypot(cur.x - depart.current.x, cur.y - depart.current.y) < 5) return;
      vue.glisse = true;
      if (depart.current.tourne) { tourner(cur.x - prev.x, cur.y - prev.y); return; }
      // un glisser déplace dans le sens de l'écran, quel que soit l'angle
      const { droite, haut } = axesEcran(vue.az);
      const dx = (cur.x - prev.x) / vue.camZoom, dy = (cur.y - prev.y) / vue.camZoom / Math.sin(vue.el);
      vue.panX += -droite.x * dx + haut.x * dy;
      vue.panZ += -droite.z * dx + haut.z * dy;
    },
    onPointerUp: (e: React.PointerEvent) => {
      pts.current.delete(e.pointerId);
      if (pts.current.size === 0) { depart.current = null; setTimeout(() => (vue.glisse = false), 0); }
    },
    onPointerCancel: (e: React.PointerEvent) => { pts.current.delete(e.pointerId); depart.current = null; },
    // le clic droit sert à tourner : pas de menu contextuel sur la scène
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/**
 * Le zoom de la page, jamais : la molette et le pincement du pavé tactile (une molette avec ctrl) zooment la scène,
 * par des écouteurs non passifs (preventDefault) ; les gestes de Safari (pincer, tourner) aussi. Sur toute la page :
 * même un pincement au-dessus d'un menu ne grossit pas les menus. La molette simple, elle, ne touche que la scène
 * (les panneaux gardent leur défilement).
 */
function usePasDeZoomDePage(scene: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const roulette = (e: WheelEvent) => {
      if (e.ctrlKey) surRoulette(e);
      else if (scene.current?.contains(e.target as Node)) surRoulette(e);
    };
    const geste = (e: Event) => surGeste(e.type as 'gesturestart' | 'gesturechange' | 'gestureend', e as unknown as { scale: number; rotation: number; preventDefault: () => void });
    window.addEventListener('wheel', roulette, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(t, geste, { passive: false });
    return () => {
      window.removeEventListener('wheel', roulette);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.removeEventListener(t, geste);
    };
  }, [scene]);
}

/** Des sols invisibles qui détectent le survol de chaque pièce (pour afficher son étiquette). */
function RoomHits() {
  return (
    <>
      {ROOMS.flatMap(r => partiesDe(r).map((p, i) => ({ r, p: p.r, survol: i > 0 && r.annexe?.nom ? `${r.id}-annexe` : r.id }))).map(({ r, p, survol }) => (
        <mesh
          key={`${r.id}${p.join()}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[p[0] + p[2] / 2, 0.02, p[1] + p[3] / 2]}
          // une annexe nommée (la Salle à manger) montre sa propre étiquette ; le clic ouvre la fiche de la pièce
          onPointerMove={() => useQG.getState().setHoverRoom(survol)}
          onPointerOut={() => { if (useQG.getState().hoverRoom === survol) useQG.getState().setHoverRoom(null); }}
          onClick={ev => { ev.stopPropagation(); if (vue.glisse || ev.delta > 5) return; const st = useQG.getState(); st.setFocus(r.id); st.ouvrir(useQG.getState().focus ? { type: 'piece', id: r.id } : null); }}
        >
          <planeGeometry args={[p[2], p[3]]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** L'ordre de priorité des bulles à l'écran : l'échange en cours, puis les plus anciennes (elles ne bougent plus). */
function prioriteBulle(e: Engine, agentId: string) {
  if (e.echange && (e.echange.a === agentId || e.echange.b === agentId)) return -1;
  return e.bubbles.find(b => b.agentId === agentId)?.id ?? 1e9;
}

/** Fait avancer la simulation, publie un instantané 5 fois par seconde et place les étiquettes HTML. */
function SimDriver() {
  const acc = useRef(0);
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }, dt) => {
    const e = getEngine();
    e.tick(Math.min(dt, 0.05));
    acc.current += dt;
    if (acc.current > 0.2) { acc.current = 0; useQG.getState().setSnap(e.snapshot()); }
    const { etiquettes, hoverAgent, hoverRoom, selected, focus, demo } = useQG.getState();
    const toujours = etiquettes === 'toujours';
    const parle = new Set(e.bubbles.map(b => b.agentId));
    const proj = (x: number, y: number, z: number): [number, number] => {
      v.current.set(x, y, z).project(camera);
      return [((v.current.x + 1) / 2) * size.width, ((1 - v.current.y) / 2) * size.height];
    };
    const now = Date.now();
    // les étiquettes à montrer cette image ; les autres sont cachées tout de suite
    const montrees: { cle: string; forme: Forme; x: number; y: number; rang: number; prio: number }[] = [];
    for (const r of [...ROOMS.map(r => ({ cle: r.id, etiquette: r.etiquette, focus: focus === r.id })), ...ANNEXES.map(a => ({ cle: a.cle, etiquette: a.etiquette, focus: false }))]) {
      const [gx, gy] = planToGrid(...r.etiquette);
      const [px, py] = proj(gx, 0, gy);
      const montre = toujours || hoverRoom === r.cle || r.focus;
      // le petit pictogramme reste toujours là : on sait où on est sans encombrer l'écran
      place(`rico:${r.cle}`, px, py, !montre);
      if (montre) montrees.push({ cle: `room:${r.cle}`, forme: 'piece', x: px, y: py, rang: 0, prio: hoverRoom === r.cle || r.focus ? -1e9 : -py });
      else place(`room:${r.cle}`, px, py, false);
    }
    for (const a of e.agents) {
      const [hx, hy] = proj(a.x, SH + 0.08 - (estAssis(a, e) ? ASSIS : 0), a.y); // assis, son nom descend avec lui
      // la nuit, ni nom ni bulle au-dessus d'une place vide
      const ici = e.visible(a.id, now); // (pas au-dessus d'une cabine des toilettes fermée)
      const montre = ici && (toujours || hoverAgent === a.id || selected === a.id);
      // le nom du sélectionné ou du survolé d'abord, puis du plus proche (bas de l'écran) au plus lointain
      if (montre) montrees.push({ cle: `tag:${a.id}`, forme: 'nom', x: hx, y: hy, rang: 1, prio: hoverAgent === a.id || selected === a.id ? -1e9 : -hy });
      else place(`tag:${a.id}`, hx, hy, false);
      // en mode démo, les bulles (3 au plus) racontent ce qui se passe, sans les noms
      const bulle = ici && (montre || demo) && parle.has(a.id);
      if (bulle) montrees.push({ cle: `bub:${a.id}`, forme: 'bulle', x: hx, y: hy, rang: 2, prio: prioriteBulle(e, a.id) });
      else place(`bub:${a.id}`, hx, hy, false);
      place(`dot:${a.id}`, hx, hy, ici && !montre && !demo && parle.has(a.id));
    }
    // deux étiquettes affichées ne se recouvrent jamais : les pièces (le plan) d'abord, puis les noms, puis les bulles
    // (l'échange en cours, puis les plus anciennes) ; une étiquette qui tomberait sur une autre monte juste au-dessus
    // (bulles.ts). Les tailles sont toutes lues avant de déplacer quoi que ce soit.
    const sc = parseFloat(document.documentElement.style.getPropertyValue('--sc')) || 1;
    montrees.sort((x, y) => x.rang - y.rang || x.prio - y.prio);
    const boites = montrees.flatMap(x => {
      const { w, h } = taille(x.cle);
      return w ? [boiteEcran(x.cle, x.forme, x.x, x.y, w, h, sc)] : []; // pas encore dessinée (instantané suivant)
    });
    const monte = ecarterBulles(boites);
    for (const x of montrees) place(x.cle, x.x, x.y - (monte.get(x.cle) ?? 0), true);
    const [hx, hy] = proj(HORLOGE[0], HORLOGE[1] + 0.6, HORLOGE[2]);
    place('horloge', hx, hy, useQG.getState().hoverHorloge);
  });
  return null;
}

export default function Scene() {
  const gestes = useGestes();
  const ref = useRef<HTMLDivElement>(null);
  usePasDeZoomDePage(ref);
  return (
    <div ref={ref} className="h-full w-full touch-none" {...gestes}>
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: false, stencil: true }} // le pochoir : les pièces occupées s'éclairent la nuit (Lumieres.tsx)
      flat
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }} // les ombres au sol s'arrêtent au bord de l'île
      onPointerMissed={() => { if (vue.glisse) return; useQG.getState().select(null); useQG.getState().setHoverRoom(null); }}
    >
      <OrthographicCamera makeDefault near={1} far={400} />
      <PlanCamera />
      <SimDriver />
      <World />
      <Horloge />
      <Nature />
      <Vie />
      <Activites />
      <RoomHits />
      <Agents />
      <Lumieres />
    </Canvas>
    </div>
  );
}
