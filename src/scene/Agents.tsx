'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Engine, SimAgent } from '@/sim/engine';
import { ASSISES } from '@/data/layout';
import { agentById } from '@/sim/routing';
import { getEngine, useQG } from '@/store';
import { vue } from './vue';
import { CHAISES } from '@/data/meubles';
import { PX_PER_UNIT, SPRITE_H, SPRITE_W } from './sprites';
import { CAP, corps, ECART_JAMBES, EPAULE, HANCHE, U, versAngle, type Corps, type Cube } from './voxels';

export const SW = SPRITE_W / PX_PER_UNIT, SH = SPRITE_H / PX_PER_UNIT;

// S'asseoir : arrêté sur une place assise (poste, table, chaise de réunion, tabouret de cabine), un personnage descend
// de la hauteur d'une assise ; le sol cache ses jambes, il paraît assis sur sa chaise. Il se lève pour danser ou saluer.
/** De combien descend un personnage assis. */
export const ASSIS = 0.1;
/** Allongé dans le hamac : la hauteur du creux de la toile (paysage.ts, hamac()). */
const HAMAC_Z = 0.58;
const cle = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
const PLACES_ASSISES = new Set(ASSISES.map(([x, y]) => cle(x, y)));
export function estAssis(a: SimAgent, e: Engine) {
  if (a.path.length || !PLACES_ASSISES.has(cle(a.x, a.y))) return false;
  return !(a.named && (e.dansant(a.id) || e.salue(a.id)));
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

// ── Les personnages en 3D (v2) : cinq morceaux en cubes par personnage (voxels.ts), peints en aplats comme le décor
// (le dessus clair, les côtés plus sombres selon leur orientation), sans vraie lumière.

const MATIERE_CORPS = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute vec3 color; varying vec3 vC;
    void main() {
      vec3 n = normalize(mat3(modelMatrix) * normal);
      float ombre = n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.55 : 0.76 + 0.1 * n.z - 0.06 * n.x;
      vC = color * ombre;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }`,
});

const teinteCube = new THREE.Color();
/** Des cubes (en pixels de personnage) → une seule géométrie, chaque sommet à la couleur de son cube. */
function geometrieDe(cubes: Cube[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const c of cubes) {
    const g = new THREE.BoxGeometry((c.x1 - c.x0) * U, (c.y1 - c.y0) * U, (c.z1 - c.z0) * U).toNonIndexed();
    g.translate(((c.x0 + c.x1) / 2) * U, ((c.y0 + c.y1) / 2) * U, ((c.z0 + c.z1) / 2) * U);
    pos.push(...g.getAttribute('position').array); nor.push(...g.getAttribute('normal').array);
    const o = { r: 0, g: 0, b: 0 };
    teinteCube.set(c.c).getRGB(o, THREE.SRGBColorSpace);
    for (let i = 0; i < g.getAttribute('position').count; i++) col.push(o.r, o.g, o.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
type Morceaux = Record<keyof Corps, THREE.BufferGeometry>;
const corpsEnCache = new Map<string, Morceaux>();
function morceaux(cle: string): Morceaux {
  let m = corpsEnCache.get(cle);
  if (!m) {
    const c = corps(cle);
    m = { tronc: geometrieDe(c.tronc), brasG: geometrieDe(c.brasG), brasD: geometrieDe(c.brasD), jambeG: geometrieDe(c.jambeG), jambeD: geometrieDe(c.jambeD) };
    corpsEnCache.set(cle, m);
  }
  return m;
}
// le casque de l'agent qui écoute mon Spotify : l'arceau sombre, deux écouteurs au vert Spotify
const CASQUE_3D = geometrieDe([
  { x0: -4.6, x1: 4.6, y0: 19.6, y1: 20.6, z0: -0.6, z1: 0.6, c: '#1d1b2e' },
  { x0: -5.2, x1: -4, y0: 14.6, y1: 18.6, z0: -1.4, z1: 1.4, c: '#1DB954' }, { x0: 4, x1: 5.2, y0: 14.6, y1: 18.6, z0: -1.4, z1: 1.4, c: '#1DB954' },
]);
/** L'ombre ronde sous un personnage. */
const OMBRE_PIED = new THREE.MeshBasicMaterial({ color: '#281946', transparent: true, opacity: 0.22, depthWrite: false });
const DISQUE = new THREE.CircleGeometry(0.2, 14);
/** La boîte invisible que l'on survole et que l'on clique. */
const PRISE = new THREE.BoxGeometry(0.42, 0.86, 0.42);
const INVISIBLE = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

/** La hauteur d'une assise (meubles.ts) : assis, les hanches y sont posées, les cuisses à l'horizontale. */
const ASSISE = 0.27;
/** La chaise sur laquelle est une place assise, pour regarder du même côté qu'elle. */
function capDeLaPlace(x: number, y: number): number | null {
  let mieux: number | null = null, d = 0.3;
  for (const c of CHAISES) {
    const e = Math.hypot(c.x - x, c.y - y);
    if (e < d) { d = e; mieux = CAP[c.vers]; }
  }
  return mieux;
}

function AgentSprite({ a }: { a: SimAgent }) {
  const group = useRef<THREE.Group>(null);
  const cap = useRef<THREE.Group>(null);
  const corpsRef = useRef<THREE.Group>(null);
  const brasG = useRef<THREE.Mesh>(null), brasD = useRef<THREE.Mesh>(null), jambeG = useRef<THREE.Mesh>(null), jambeD = useRef<THREE.Mesh>(null);
  const marque = useRef<THREE.Mesh>(null);
  const ombre = useRef<THREE.Mesh>(null);
  const avant = useRef({ x: a.x, y: a.y, cap: a.facing > 0 ? Math.PI / 2 : 0, assis: 0 });
  const clickable = a.named && !!agentById(a.id);
  const m = morceaux(a.look);
  // un petit décalage propre à chacun : personne ne marche ni ne tape exactement au même rythme
  const decale = (a.home[0] * 7.3 + a.home[1] * 3.1) % 6.28;

  useFrame((_, dt) => {
    const e = getEngine();
    if (!group.current || !cap.current || !corpsRef.current || !brasG.current || !brasD.current || !jambeG.current || !jambeD.current) return;
    const p = avant.current;
    const assis = estAssis(a, e), allonge = e.allonge(a), marche = a.path.length > 0;
    group.current.visible = e.visible(a.id);
    // le cap : en marchant, la direction du pas ; assis, celle de sa chaise ; sinon, le côté où il regarde
    const dx = a.x - p.x, dy = a.y - p.y;
    let voulu = p.cap;
    if (marche && Math.hypot(dx, dy) > 1e-4) voulu = Math.atan2(dx, dy);
    else if (assis) voulu = capDeLaPlace(a.x, a.y) ?? (a.facing > 0 ? Math.PI / 2 : 0);
    else if (!marche) voulu = a.facing > 0 ? Math.PI / 2 : 0;
    p.cap = versAngle(p.cap, voulu, 1 - Math.exp(-dt * 12));
    p.x = a.x; p.y = a.y;
    // s'asseoir et se lever, en douceur
    p.assis += ((assis ? 1 : 0) - p.assis) * (1 - Math.exp(-dt * 10));
    const danse = a.named && !marche && e.dansant(a.id);
    const salue = !danse && a.named && !marche && e.salue(a.id);
    const pas = danse ? pasDeDanse(e.t) : salue ? pasDeSalut(e.t) : { rebond: 0, balance: 0, decale: 0, ecrase: 1 };
    const t = e.t + decale;
    const balancier = marche ? Math.sin(t * 10) : 0;
    group.current.position.set(a.x, 0, a.y);
    cap.current.rotation.y = allonge ? Math.PI / 2 : p.cap;
    const c = corpsRef.current;
    if (allonge) {
      // la sieste : allongé sur le dos au creux de la toile
      c.position.set(0, HAMAC_Z + 0.1, -0.38); c.rotation.set(-Math.PI / 2, 0, 0); c.scale.y = 1;
    } else {
      c.position.set(pas.decale, pas.rebond + Math.abs(balancier) * 0.012 + p.assis * (ASSISE - HANCHE * U), 0);
      c.rotation.set(0, 0, pas.balance);
      c.scale.y = pas.ecrase;
    }
    // les jambes : le balancier de la marche ; assis, les cuisses à l'horizontale
    jambeG.current.rotation.x = balancier * 0.75 * (1 - p.assis) - (Math.PI / 2) * p.assis;
    jambeD.current.rotation.x = -balancier * 0.75 * (1 - p.assis) - (Math.PI / 2) * p.assis;
    // les bras : à l'opposé des jambes ; au poste, les mains sur le clavier ; un salut de la main ; les bras en l'air en dansant
    const tape = !marche && !danse && !salue && !allonge && e.atHome(a) && !a.still;
    let bg = -balancier * 0.6, bd = balancier * 0.6, leve = 0;
    if (tape) { bg = -1.05 + Math.sin(t * 13) * 0.1; bd = -1.05 + Math.sin(t * 13 + 2.1) * 0.1; }
    else if (assis) { bg = bd = -0.35; }
    if (danse) { bg = -2.7 + Math.sin(e.t * Math.PI * 2) * 0.35; bd = -2.7 - Math.sin(e.t * Math.PI * 2) * 0.35; }
    if (salue) { bd = -2.8; leve = Math.sin(e.t * 9) * 0.4; }
    brasG.current.rotation.set(bg, 0, 0);
    brasD.current.rotation.set(bd, 0, leve);
    if (marque.current) marque.current.visible = danse;
    if (ombre.current) ombre.current.visible = !allonge;
  });

  return (
    <group ref={group}>
      <mesh ref={ombre} geometry={DISQUE} material={OMBRE_PIED} rotation={[-Math.PI / 2, 0, 0]} position={[0.04, 0.012, 0.03]} renderOrder={6} />
      <group ref={cap}>
        <group ref={corpsRef}>
          <mesh geometry={m.tronc} material={MATIERE_CORPS} />
          <mesh ref={brasG} geometry={m.brasG} material={MATIERE_CORPS} position={[EPAULE[0] * U, EPAULE[1] * U, 0]} />
          <mesh ref={brasD} geometry={m.brasD} material={MATIERE_CORPS} position={[-EPAULE[0] * U, EPAULE[1] * U, 0]} />
          <mesh ref={jambeG} geometry={m.jambeG} material={MATIERE_CORPS} position={[ECART_JAMBES * U, HANCHE * U, 0]} />
          <mesh ref={jambeD} geometry={m.jambeD} material={MATIERE_CORPS} position={[-ECART_JAMBES * U, HANCHE * U, 0]} />
          {a.named && <mesh ref={marque} visible={false} geometry={CASQUE_3D} material={MATIERE_CORPS} />}
        </group>
      </group>
      <mesh
        geometry={PRISE} material={INVISIBLE} position={[0, 0.43, 0]}
        onClick={clickable ? ev => { if (!getEngine().present(a.id)) return; ev.stopPropagation(); if (vue.glisse || ev.delta > 5) return; useQG.getState().select(a.id); } : undefined}
        onPointerOver={clickable ? ev => { if (!getEngine().present(a.id)) return; ev.stopPropagation(); document.body.style.cursor = 'pointer'; useQG.getState().setHoverAgent(a.id); } : undefined}
        onPointerOut={clickable ? () => { document.body.style.cursor = ''; if (useQG.getState().hoverAgent === a.id) useQG.getState().setHoverAgent(null); } : undefined}
      />
    </group>
  );
}

export function Agents() {
  const version = useQG(s => s.version); // nouvelle simulation (changement de moment) → nouveaux personnages
  const agents = getEngine().agents;
  return <>{agents.map(a => <AgentSprite key={`${version}-${a.id}`} a={a} />)}</>;
}
