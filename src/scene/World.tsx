'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Blocs } from './Blocs';
import { motifTexture } from './motifs';
import { FENETRE, FENETRES_E, FENETRES_N, FENETRES_S, FENETRES_W, occupation, occupee, posteCle } from './nuit';
import { EPAISSEUR_MUR, FURNITURE, GRID, ILE, ILOTS, MUR_FOND, partiesDe, PORTE, ROOMS, type Box } from '@/data/layout';
import { getEngine, useQG } from '@/store';
import { onAirAllume } from './onair';
import { vue, type CoteMur } from './vue';

// Le décor : l'île, le sol, les murs, les meubles. Couleurs à plat, trois teintes par bloc (dessus, gauche, droite),
// comme dans mes plans. Tous les blocs opaques sont dessinés d'un seul coup (Blocs.tsx) ; seuls restent à part les
// vitres (transparentes), les images posées sur une face (motifs) et les écrans.

/** Le bord de l'île, sous la pelouse : la terre rouge (latérite) en trois couches, de plus en plus sombre. */
export const COUCHES = [{ z0: -0.55, z1: -0.12, c: '#c4683f' }, { z0: -1.05, z1: -0.55, c: '#a9502f' }, { z0: -1.6, z1: -1.05, c: '#7c3b25' }];

const glassMat = new THREE.MeshBasicMaterial({ color: '#cfe6fb', transparent: true, opacity: 0.4, depthWrite: false });

/** Une vitre (transparente, dessinée à part) ; son cadre, opaque, va avec les blocs. */
function Vitre({ b }: { b: Box }) {
  return <mesh position={[b.x + b.w / 2, (b.z ?? 0) + b.h / 2, b.y + b.d / 2]} material={glassMat}><boxGeometry args={[b.w, b.h, b.d]} /></mesh>;
}
const cadreDe = (b: Box & { cadre?: string }): Box => ({ x: b.x - 0.01, y: b.y - 0.01, z: (b.z ?? 0) + b.h, w: b.w + 0.02, d: b.d + 0.02, h: 0.08, c: b.cadre ?? '#3a3f55' });

/** Une image posée sur une face d'un bloc : la face de gauche (+z, par défaut) ou celle de droite (+x). */
function Motif({ b }: { b: Box }) {
  const z = b.z ?? 0;
  const map = useMemo(() => motifTexture(b.motif!), [b.motif]);
  if (b.motifFace === 'x') {
    return (
      <mesh position={[b.x + b.w + 0.003, z + b.h / 2, b.y + b.d / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[b.d - 0.06, b.h - 0.06]} />
        <meshBasicMaterial map={map} />
      </mesh>
    );
  }
  return (
    <mesh position={[b.x + b.w / 2, z + b.h / 2, b.y + b.d + 0.003]}>
      <planeGeometry args={[b.w - 0.06, b.h - 0.06]} />
      <meshBasicMaterial map={map} />
    </mesh>
  );
}

/** L'enseigne ON AIR allumée : posée juste devant l'enseigne éteinte, dessinée après l'assombrissement (elle brille la
 *  nuit aussi) ; visible seulement pendant un vrai tournage (onair.ts). */
function OnAir({ b }: { b: Box }) {
  const ref = useRef<THREE.Mesh>(null);
  const map = useMemo(() => motifTexture('onair-allume'), []);
  useFrame(() => {
    const s = useQG.getState();
    if (ref.current) ref.current.visible = onAirAllume(s.demo, s.snap?.studioOn);
  });
  return (
    <mesh ref={ref} visible={false} renderOrder={951} position={[b.x + b.w / 2, (b.z ?? 0) + b.h / 2, b.y + b.d + 0.006]}>
      <planeGeometry args={[b.w - 0.06, b.h - 0.06]} />
      <meshBasicMaterial map={map} transparent />
    </mesh>
  );
}

/** Une affiche du mur de gauche (layout.ts) : elle part avec le mur quand il se baisse. */
const estAffiche = (b: Box) => !!b.motif?.startsWith('affiche-');
/** La hauteur d'un mur baissé : celle d'un muret de pièce (0,38). */
const MURET = 0.38 / MUR_FOND;

/**
 * Un mur du bâtiment qui se baisse en muret quand il se trouve entre la caméra et l'intérieur (comme dans les Sims) :
 * il ne cache jamais l'intérieur. Ce qui y est accroché (fenêtres, affiches) disparaît tant qu'il est baissé ; l'horloge
 * aussi (Horloge.tsx). `auDessus` : le haut du mur au-dessus d'une porte, qui suit le mur mais disparaît quand il est
 * baissé (sinon il ferait une barre en travers de la porte).
 */
function Mur({ cote, mur, auDessus, dessus }: { cote: CoteMur; mur: Box[]; auDessus?: Box[]; dessus: React.ReactNode }) {
  const corps = useRef<THREE.Group>(null), haut = useRef<THREE.Group>(null), accroche = useRef<THREE.Group>(null);
  useFrame(() => {
    const k = vue.murs[cote];
    if (corps.current) corps.current.scale.y = MURET + (1 - MURET) * k;
    if (haut.current) haut.current.visible = k > 0.92;
    if (accroche.current) accroche.current.visible = k > 0.92;
  });
  return (
    <>
      <group ref={corps}>
        <Blocs blocs={mur} />
        {auDessus && <group ref={haut}><Blocs blocs={auDessus} /></group>}
      </group>
      <group ref={accroche}>{dessus}</group>
    </>
  );
}

const PLAQUE = new THREE.PlaneGeometry(1, 1);
/** Des petites plaques (écrans, témoins), toutes d'un seul coup, chacune à sa couleur. */
function Plaques({ plaques, renderOrder, transparent, couleurs }: {
  plaques: { x: number; y: number; z: number; w: number; h: number }[];
  renderOrder?: number; transparent?: boolean;
  /** relu à chaque image : la couleur de chaque plaque (les écrans s'allument et s'éteignent) */
  couleurs: () => string[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent }), [transparent]);
  const avant = useRef<string>('');
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    plaques.forEach((p, i) => { o.position.set(p.x, p.z, p.y); o.scale.set(p.w, p.h, 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [plaques]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const cs = couleurs(), cle = cs.join();
    if (cle === avant.current) return;
    avant.current = cle;
    const c = new THREE.Color();
    cs.forEach((x, i) => m.setColorAt(i, c.set(x)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  if (!plaques.length) return null;
  return <instancedMesh ref={ref} args={[PLAQUE, mat, plaques.length]} renderOrder={renderOrder} frustumCulled={false} />;
}

/** Un écran éteint : l'écran d'un poste dont l'occupant n'est pas là. */
const ECRAN_ETEINT = '#2b3040';
const TEMOINS = ['#77ccff', '#3dff8a'];
const OCCUPE = '#ff4d4d', LIBRE = '#3dff8a';

/** Le sol en une seule texture : carrelage des couloirs, sols des pièces, carrelage de la Cuisine et parquet de sa salle à manger, îlots de l'atelier. */
function useFloorTexture() {
  return useMemo(() => {
    const P = 8;
    const c = document.createElement('canvas');
    c.width = GRID.w * P; c.height = GRID.h * P;
    const g = c.getContext('2d')!;
    for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
      g.fillStyle = (x + y) % 2 ? '#efe3c6' : '#ebddbd';
      g.fillRect(x * P, y * P, P, P);
    }
    for (const r of ROOMS) {
      const [x, y, w, d] = r.r;
      if (r.id === 'cafe') {
        // la Cuisine : un carrelage clair en petits carreaux ; sa salle à manger : un parquet à lames
        for (let j = 0; j < d * 2; j++) for (let i = 0; i < w * 2; i++) {
          g.fillStyle = (i + j) % 2 ? '#dcd6cb' : '#f1ede6';
          g.fillRect(x * P + (i * P) / 2, y * P + (j * P) / 2, P / 2, P / 2);
        }
        const [ax, ay, aw, ad] = r.annexe!.r;
        for (let j = 0; j < ad * 4; j++) {
          g.fillStyle = ['#c9a27a', '#bf9670', '#d1ab84'][j % 3];
          g.fillRect(ax * P, ay * P + j * 2, aw * P, 2);
          g.fillStyle = 'rgba(80,50,30,.25)';
          g.fillRect(ax * P + (((j * 5) % 4) + 1) * (P * 1.5), ay * P + j * 2, 1, 2); // les joints des lames
        }
      } else if (r.sol) {
        g.fillStyle = r.sol;
        g.fillRect(x * P, y * P, w * P, d * P);
        g.fillStyle = 'rgba(0,0,0,.035)';
        for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if ((i + j) % 2) g.fillRect((x + i) * P, (y + j) * P, P, P);
      }
    }
    for (const il of ILOTS) {
      const [x, y, w, d] = il.r;
      g.fillStyle = il.sol;
      g.fillRect(Math.round(x * P), Math.round(y * P), Math.round(w * P), Math.round(d * P));
    }
    g.fillStyle = '#f07c58'; // scène du studio
    g.fillRect(34 * P, 17.6 * P, 4.4 * P, 3 * P);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

/**
 * Les murets et les vitres des pièces : un seul bloc par pan de mur entre deux portes (une vitre d'un seul tenant, sans
 * bande à chaque case). Les pans du haut et du bas (N, S) couvrent les coins ; ceux des côtés (W, E) s'arrêtent avant,
 * pour qu'aucun coin ne soit couvert deux fois (une vitre doublée y paraîtrait plus foncée). Contre un mur du bâtiment,
 * un pan s'arrête à sa face intérieure : il n'entre jamais dedans (un muret dans un mur baissé à la même hauteur y
 * scintillerait).
 */
export function roomWalls(): (Box & { cadre?: string })[] {
  const out: (Box & { cadre?: string })[] = [];
  const T = 0.26;
  /** Les suites de cases sans porte, de `n` cases : [début, fin[. */
  const pans = (n: number, porte: (k: number) => boolean) => {
    const res: [number, number][] = [];
    let debut = -1;
    for (let k = 0; k <= n; k++) {
      const plein = k < n && !porte(k);
      if (plein && debut < 0) debut = k;
      if (!plein && debut >= 0) { res.push([debut, k]); debut = -1; }
    }
    return res;
  };
  for (const r of ROOMS) for (const partie of partiesDe(r)) {
    if (!r.mur && !r.vitre) continue;
    const [x0, y0, w, d] = partie.r;
    const h = r.hauteur ?? 0.38;
    const porte = (cote: string, a: number) => partie.portes.some(p => p.cote === cote && p.a === a);
    const base = { h, c: r.mur ?? '#ffffff', vitre: !!r.vitre, z: 0, cadre: r.cadre };
    for (const [cote, y] of [['N', y0], ['S', y0 + d]] as const) {
      for (const [a, b] of pans(w, i => porte(cote, x0 + i))) {
        const xa = x0 + a - (a === 0 ? T / 2 : 0), xb = x0 + b + (b === w ? T / 2 : 0);
        out.push({ ...base, x: xa, y: y - T / 2, w: xb - xa, d: T });
      }
    }
    for (const [cote, x] of [['W', x0], ['E', x0 + w]] as const) {
      // le coin est déjà couvert par le pan du haut (ou du bas), sauf s'il y a une porte à cet endroit
      const coinHaut = !porte('N', cote === 'W' ? x0 : x0 + w - 1), coinBas = !porte('S', cote === 'W' ? x0 : x0 + w - 1);
      for (const [a, b] of pans(d, j => porte(cote, y0 + j))) {
        const ya = y0 + a + (a === 0 && coinHaut ? T / 2 : 0), yb = y0 + b - (b === d && coinBas ? T / 2 : 0);
        out.push({ ...base, x: x - T / 2, y: ya, w: T, d: yb - ya });
      }
    }
  }
  // rogné à l'intérieur du bâtiment, entre les faces intérieures de ses murs
  return out.flatMap(b => {
    const x0 = Math.max(0, b.x), x1 = Math.min(GRID.w, b.x + b.w), y0 = Math.max(0, b.y), y1 = Math.min(GRID.h, b.y + b.d);
    return x1 > x0 && y1 > y0 ? [{ ...b, x: x0, y: y0, w: x1 - x0, d: y1 - y0 }] : [];
  });
}

export function World() {
  const floor = useFloorTexture();
  const { murN, murW, murS, murE, surPorte, surN, surW, surS, surE, affiches, blocs, vitres, motifs, ecrans, temoins, voyants } = useMemo(() => {
    const walls = roomWalls();
    const fond: Box[] = [
      // l'île : la pelouse dessus (Nature.tsx), puis la terre rouge en couches ; ses bosses, ses cailloux, ses racines
      // et son dessous en gradins sont dans Nature.tsx
      { x: ILE.x, y: ILE.y, z: -0.12, w: ILE.w, d: ILE.d, h: 0.12, c: '#5aa040', top: '#7cc35a' },
      ...COUCHES.map(k => ({ x: ILE.x, y: ILE.y, z: k.z0, w: ILE.w, d: ILE.d, h: k.z1 - k.z0, c: k.c })),
    ];
    // les quatre murs du bâtiment (dessinés à part : chacun se baisse quand il se trouve entre la caméra et l'intérieur) ;
    // ce qui est accroché dessus (fenêtres, affiches) disparaît alors avec lui. Les murs de devant (S) et de droite (E)
    // sont à l'extérieur du sol, comme ceux du fond ; celui de devant couvre les deux coins, celui de droite le coin du fond.
    const EP = EPAISSEUR_MUR;
    const clair = { c: '#f2e6cd', top: '#fbf4e4', left: '#f2e6cd' }, ombre = { c: '#e2d1ad', top: '#fbf4e4', right: '#e2d1ad' };
    const murN: Box[] = [{ x: -EP, y: -EP, w: GRID.w + EP, d: EP, h: MUR_FOND, ...clair }];
    const murW: Box[] = [{ x: -EP, y: 0, w: EP, d: GRID.h, h: MUR_FOND, ...ombre }];
    const murE: Box[] = [{ x: GRID.w, y: -EP, w: EP, d: GRID.h + EP, h: MUR_FOND, ...ombre }];
    // devant, la porte d'entrée perce le mur (PORTE, layout.ts) : un pan de chaque côté, et le haut du mur au-dessus
    const murS: Box[] = [
      { x: -EP, y: GRID.h, w: PORTE.x + EP, d: EP, h: MUR_FOND, ...clair, right: ombre.right },
      { x: PORTE.x + PORTE.w, y: GRID.h, w: GRID.w + EP - PORTE.x - PORTE.w, d: EP, h: MUR_FOND, ...clair, right: ombre.right },
    ];
    const surPorte: Box[] = [{ x: PORTE.x, y: GRID.h, z: PORTE.h, w: PORTE.w, d: EP, h: MUR_FOND - PORTE.h, ...clair, right: ombre.right }];
    // les fenêtres, sur la face intérieure de chaque mur : le cadre blanc, la vitre bleutée
    const surN: Box[] = FENETRES_N.flatMap(x => [
      { x, y: 0, z: 1.0, w: FENETRE, d: 0.03, h: 1.3, c: '#ffffff' },
      { x: x + 0.12, y: 0.03, z: 1.1, w: 1.56, d: 0.02, h: 1.1, c: '#8fbdea' },
    ]);
    const surS: Box[] = FENETRES_S.flatMap(x => [
      { x, y: GRID.h - 0.03, z: 1.0, w: FENETRE, d: 0.03, h: 1.3, c: '#ffffff' },
      { x: x + 0.12, y: GRID.h - 0.05, z: 1.1, w: 1.56, d: 0.02, h: 1.1, c: '#8fbdea' },
    ]);
    const affiches = FURNITURE.filter(estAffiche);
    const surW: Box[] = [...FENETRES_W.flatMap(y => [
      { x: 0, y, z: 1.0, w: 0.03, d: FENETRE, h: 1.3, c: '#ffffff', right: '#ffffff' },
      { x: 0.03, y: y + 0.12, z: 1.1, w: 0.02, d: 1.56, h: 1.1, c: '#7fb0e0', right: '#7fb0e0' },
    ]), ...affiches];
    const surE: Box[] = FENETRES_E.flatMap(y => [
      { x: GRID.w - 0.03, y, z: 1.0, w: 0.03, d: FENETRE, h: 1.3, c: '#ffffff', right: '#ffffff' },
      { x: GRID.w - 0.05, y: y + 0.12, z: 1.1, w: 0.02, d: 1.56, h: 1.1, c: '#7fb0e0', right: '#7fb0e0' },
    ]);
    const opaques = [...fond, ...walls.filter(b => !b.vitre), ...walls.filter(b => b.vitre).map(cadreDe), ...FURNITURE.filter(b => !b.vitre && !b.voyant && !estAffiche(b)), ...FURNITURE.filter(b => b.vitre).map(b => cadreDe(b))];
    const face = (b: Box, marge: number) => ({ x: b.x + b.w / 2, y: b.y + b.d + 0.002, z: (b.z ?? 0) + b.h / 2, w: b.w - marge, h: b.h - marge });
    return {
      murN, murW, murS, murE, surPorte, surN, surW, surS, surE, affiches,
      blocs: opaques,
      vitres: [...walls.filter(b => b.vitre), ...FURNITURE.filter(b => b.vitre)],
      motifs: FURNITURE.filter(b => b.motif && !estAffiche(b)),
      // un écran fin garde un bord fin : la marge suit sa taille
      ecrans: FURNITURE.filter(b => b.ecran).map(b => ({ b, p: face(b, Math.min(0.12, Math.min(b.w, b.h) * 0.22)) })),
      voyants: FURNITURE.filter(b => b.voyant).map(b => ({ b, p: face(b, 0) })),
      temoins: FURNITURE.filter(b => b.lumieres).flatMap(b => [0, 1, 2, 3, 4].map(i => ({ x: b.x + 0.25, y: b.y + b.d + 0.002, z: (b.z ?? 0) + 0.3 + i * 0.25, w: 0.18, h: 0.05 }))),
    };
  }, []);
  const plaquesEcrans = useMemo(() => ecrans.map(e => e.p), [ecrans]);
  const plaquesVoyants = useMemo(() => voyants.map(v => v.p), [voyants]);
  return (
    <group>
      {/* le sol du bâtiment */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[GRID.w / 2, 0.002, GRID.h / 2]}>
        <planeGeometry args={[GRID.w, GRID.h]} />
        <meshBasicMaterial map={floor} />
      </mesh>
      <Blocs blocs={blocs} />
      <Mur cote="N" mur={murN} dessus={<Blocs blocs={surN} />} />
      <Mur cote="W" mur={murW} dessus={<><Blocs blocs={surW} />{affiches.map((b, i) => <Motif key={i} b={b} />)}</>} />
      <Mur cote="S" mur={murS} auDessus={surPorte} dessus={<Blocs blocs={surS} />} />
      <Mur cote="E" mur={murE} dessus={<Blocs blocs={surE} />} />
      {vitres.map((b, i) => <Vitre key={i} b={b} />)}
      {motifs.map((b, i) => <Motif key={i} b={b} />)}
      {motifs.filter(b => b.motif === 'onair').map((b, i) => <OnAir key={i} b={b} />)}
      {/* les écrans : ceux des postes ne sont allumés que si leur occupant est là (jour comme nuit), les autres toujours */}
      <Plaques plaques={plaquesEcrans} couleurs={() => {
        const { postes } = occupation(getEngine());
        return ecrans.map(({ b }) => (!b.poste || postes.has(posteCle(b.poste)) ? b.ecran! : ECRAN_ETEINT));
      }} />
      {/* les témoins des serveurs restent allumés, même la nuit : dessinés après l'assombrissement (Lumieres.tsx) */}
      <Plaques plaques={temoins} renderOrder={950} transparent couleurs={() => temoins.map((_, i) => TEMOINS[i % 2])} />
      {/* le voyant d'une cabine : rouge seulement si quelqu'un y est vraiment (présent, sur sa place), sinon vert */}
      <Plaques plaques={plaquesVoyants} renderOrder={950} transparent couleurs={() => {
        const e = getEngine();
        return voyants.map(({ b }) => (occupee(b.voyant!, e.agents, id => e.present(id)) ? OCCUPE : LIBRE));
      }} />
    </group>
  );
}
