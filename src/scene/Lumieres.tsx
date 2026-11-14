'use client';
import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID, ROOMS } from '@/data/layout';
import { vue, type CoteMur } from './vue';
import { allumage, astres, lumiereA, minutesDe } from '@/sim/lumiere';
import { getEngine, useQG } from '@/store';
import { LAMPADAIRES, MARE } from './Nature';
import { TERRAINS } from '@/sim/vie';
import { FENETRE, FENETRES_E, FENETRES_N, FENETRES_S, FENETRES_W, occupation, pieceDeFenetre, volumesPiece } from './nuit';

// La vraie nuit. La scène s'assombrit ici, dans la 3D (et non plus par un filtre CSS) : tout ce qui est dessiné avant
// est multiplié par la luminosité de l'heure (lumiereA). Ce qui est dessiné après y échappe : les pièces occupées
// (rendues à leur lumière, en plus chaud), le reflet de leurs fenêtres, les lampadaires et leur rond de lumière au sol,
// le reflet de la lune sur la mare. Le jour, rien de tout cela n'est dessiné.
//
// L'ordre de dessin (renderOrder, tous dans la file des objets transparents, après le décor) :
//   900 l'assombrissement · 910+ les pièces occupées · 950 les témoins des serveurs (World.tsx) · 960+ les lampes, la lune.

const CHAUD = new THREE.Vector3(1, 0.9, 0.72); // la lumière d'une pièce, un peu chaude
const LAMPE = new THREE.Color('#ffd27a');
const ETEINTE = new THREE.Color('#9aa0a8');
const LUNE = new THREE.Color('#c9d6ff');

/** Un écran entier (−1…1), quelle que soit la caméra. */
const ECRAN = new THREE.PlaneGeometry(2, 2);
const PLEIN_ECRAN = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DANS_LA_SCENE = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const COULEUR = 'uniform vec3 c; void main() { gl_FragColor = vec4(c, 1.0); }';

/** Multiplie ce qui est déjà dessiné par la luminosité (comme brightness() en CSS) ; le ciel (transparent) n'est pas touché. */
const ASSOMBRIR = new THREE.ShaderMaterial({
  vertexShader: PLEIN_ECRAN, fragmentShader: COULEUR, uniforms: { c: { value: new THREE.Vector3(1, 1, 1) } },
  transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
});

/**
 * Une pièce occupée retrouve sa lumière : on ne touche que ce qui est dans son volume (test au pochoir : la face avant
 * du volume marque les points derrière elle, la face arrière ne garde que ceux devant elle), multiplié par 1/k, en chaud.
 */
/**
 * Les deux terrains, le soir : pendant un match (ou les paniers), les lampadaires les éclairent ; les joueurs y retrouvent
 * leur lumière comme dans une pièce occupée (src/sim/vie.ts).
 */
const VOLUMES_TERRAINS = (['foot', 'basket'] as const).map(sport => {
  const t = TERRAINS[sport];
  return { id: `terrain-${sport}`, v: { x0: t.x - 0.25, x1: t.x + t.w + 0.25, y0: t.y - 0.25, y1: t.y + t.d + 0.25, h: 2.4 } };
});
const terrainEnJeu = () => new Set<string>([...getEngine().jeux.values()].map(j => (j.sport === 'foot' ? 'terrain-foot' : 'terrain-basket')));

const PIECES = [...ROOMS.flatMap(r => volumesPiece(r.id).map(v => ({ id: r.id, v }))), ...VOLUMES_TERRAINS].map(({ id, v }, i) => {
  const ref = i + 1;
  return {
    id, i,
    pos: [(v.x0 + v.x1) / 2, v.h / 2 - 0.02, (v.y0 + v.y1) / 2] as [number, number, number],
    geo: new THREE.BoxGeometry(v.x1 - v.x0, v.h, v.y1 - v.y0),
    marque: new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, transparent: true, side: THREE.FrontSide,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    }),
    eclaire: new THREE.ShaderMaterial({
      vertexShader: DANS_LA_SCENE, fragmentShader: COULEUR, uniforms: { c: { value: new THREE.Vector3() } },
      side: THREE.BackSide, transparent: true, depthWrite: false, depthFunc: THREE.GreaterEqualDepth,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.EqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
      // résultat = dessiné × (1 + c)
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }),
  };
});

/** Les fenêtres des quatre murs qui donnent sur une pièce : un reflet chaud quand elle est occupée (vues de l'intérieur,
 *  le reflet tourné vers la pièce). */
type Fenetre = { id: string | null; pos: [number, number, number]; rot: number; mur: CoteMur };
const FENETRES = ([
  ...FENETRES_N.map((x): Fenetre => ({ id: pieceDeFenetre('N', x), pos: [x + FENETRE / 2, 1.65, 0.06], rot: 0, mur: 'N' })),
  ...FENETRES_W.map((y): Fenetre => ({ id: pieceDeFenetre('W', y), pos: [0.06, 1.65, y + FENETRE / 2], rot: Math.PI / 2, mur: 'W' })),
  ...FENETRES_S.map((x): Fenetre => ({ id: pieceDeFenetre('S', x), pos: [x + FENETRE / 2, 1.65, GRID.h - 0.06], rot: Math.PI, mur: 'S' })),
  ...FENETRES_E.map((y): Fenetre => ({ id: pieceDeFenetre('E', y), pos: [GRID.w - 0.06, 1.65, y + FENETRE / 2], rot: -Math.PI / 2, mur: 'E' })),
]).filter(f => f.id);
const REFLET = new THREE.MeshBasicMaterial({ color: '#ffd98f', transparent: true, depthWrite: false, opacity: 0 });

/** Une tache ronde, au bord très doux (le rond de lumière d'un lampadaire, le halo, le reflet de la lune). */
let tache: THREE.Texture | null = null;
function tacheDeLumiere() {
  if (tache) return tache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  d.addColorStop(0, 'rgba(255,255,255,1)'); d.addColorStop(0.35, 'rgba(255,255,255,.65)'); d.addColorStop(0.7, 'rgba(255,255,255,.2)'); d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d; g.fillRect(0, 0, 64, 64);
  return (tache = new THREE.CanvasTexture(c));
}
const additif = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#000000' });
const TETE = new THREE.MeshBasicMaterial({ transparent: true }), HALO = additif(), ROND = additif(), REFLET_LUNE = additif();

const ZERO = new THREE.Vector3();

export function Lumieres() {
  const assombrir = useRef<THREE.Mesh>(null);
  const pieces = useRef<(THREE.Group | null)[]>([]);
  const fenetres = useRef<(THREE.Mesh | null)[]>([]);
  const lampes = useRef<THREE.Group>(null);
  const lune = useRef<THREE.Mesh>(null);
  const halos = useRef<(THREE.Mesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = tacheDeLumiere();
    for (const x of [HALO, ROND, REFLET_LUNE]) { x.map = m; x.needsUpdate = true; }
  }, []);
  useFrame(({ camera }) => {
    const l = lumiereA(minutesDe(useQG.getState().horloge));
    const k = l.luminosite, t = allumage(l), a = astres(l);
    (ASSOMBRIR.uniforms.c.value as THREE.Vector3).setScalar(k);
    if (assombrir.current) assombrir.current.visible = k < 0.999;
    const occupees = occupation(getEngine()).pieces;
    const enJeu = terrainEnJeu();
    for (const p of PIECES) {
      const g = pieces.current[p.i], on = t > 0.01 && (occupees.has(p.id) || enJeu.has(p.id));
      if (g) g.visible = on;
      // facteur voulu par canal : de 1 (rien) à « chaud / k » (la pièce rendue à sa lumière), selon l'allumage
      if (on) (p.eclaire.uniforms.c.value as THREE.Vector3).copy(CHAUD).multiplyScalar(1 / k).subScalar(1).multiplyScalar(t).max(ZERO);
    }
    REFLET.opacity = 0.42 * t;
    // (un mur baissé emporte ses fenêtres, et leur reflet)
    FENETRES.forEach((f, i) => { const m = fenetres.current[i]; if (m) m.visible = t > 0.01 && occupees.has(f.id!) && vue.murs[f.mur] > 0.92; });
    // les halos font face à la caméra, quel que soit l'angle
    for (const h of halos.current) if (h) h.quaternion.copy(camera.quaternion);
    if (lampes.current) lampes.current.visible = t > 0.02;
    TETE.color.copy(ETEINTE).multiplyScalar(k).lerp(LAMPE, t);
    HALO.color.copy(LAMPE).multiplyScalar(0.55 * t);
    ROND.color.copy(LAMPE).multiplyScalar(0.5 * t);
    REFLET_LUNE.color.copy(LUNE).multiplyScalar(0.3 * a);
    if (lune.current) lune.current.visible = a > 0.02;
  });
  return (
    <group>
      <mesh ref={assombrir} geometry={ECRAN} material={ASSOMBRIR} renderOrder={900} frustumCulled={false} visible={false} />
      {PIECES.map(p => (
        <group key={p.i} ref={el => { pieces.current[p.i] = el; }} visible={false}>
          <mesh position={p.pos} geometry={p.geo} material={p.marque} renderOrder={910 + 2 * p.i} frustumCulled={false} />
          <mesh position={p.pos} geometry={p.geo} material={p.eclaire} renderOrder={911 + 2 * p.i} frustumCulled={false} />
        </group>
      ))}
      {FENETRES.map((f, i) => (
        <mesh key={i} ref={el => { fenetres.current[i] = el; }} position={f.pos} rotation={[0, f.rot, 0]} material={REFLET} renderOrder={960} visible={false}>
          <planeGeometry args={[FENETRE - 0.24, 1.1]} />
        </mesh>
      ))}
      <group ref={lampes} visible={false}>
        {LAMPADAIRES.map(([x, y], i) => (
          <group key={i}>
            <mesh position={[x, 1.52, y]} material={TETE} renderOrder={960}><boxGeometry args={[0.33, 0.25, 0.33]} /></mesh>
            <mesh ref={el => { halos.current[i] = el; }} position={[x, 1.52, y]} material={HALO} renderOrder={961}><planeGeometry args={[1.3, 1.3]} /></mesh>
            <mesh position={[x, 0.045, y]} rotation={[-Math.PI / 2, 0, 0]} material={ROND} renderOrder={961}><planeGeometry args={[3.4, 3.4]} /></mesh>
          </group>
        ))}
      </group>
      <mesh ref={lune} visible={false} position={[MARE.x + MARE.w * 0.4, 0.04, MARE.y + MARE.d * 0.5]} rotation={[-Math.PI / 2, 0, 0]} material={REFLET_LUNE} renderOrder={962}>
        <planeGeometry args={[1.1, 0.5]} />
      </mesh>
    </group>
  );
}
