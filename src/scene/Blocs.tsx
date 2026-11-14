'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Les blocs du décor dessinés d'un seul coup : tous les pavés en un seul objet, tous les cylindres en un autre, quel
// que soit leur nombre (un objet = un appel de dessin ; avant, chaque pavé en coûtait six, un par face).
// Chaque bloc garde ses trois teintes, comme dans mes plans : le dessus, la face de gauche (+z), la face de droite (+x).
// Sans teinte donnée, les côtés sont la couleur assombrie (gauche 0,85, droite 0,7), comme boxMaterials (World.tsx).
// Sur un cylindre, les côtés passent en douceur de la teinte de gauche à celle de droite : il paraît rond.

export type Bloc = {
  x: number; y: number; z?: number; w: number; d: number; h: number;
  c: string; top?: string; left?: string; right?: string;
  /** Un cylindre (debout, de 10 faces) inscrit dans le pavé : tasses, pots, abat-jour, tables rondes, tabourets. */
  forme?: 'cylindre';
};

// Le relief (v2) : chaque bloc paraît taillé et posé, sans vraie lumière (tout reste peint, comme dans mes plans).
//   · au pied de chaque face, une ombre de contact qui s'efface en montant (le bloc « touche » ce qui le porte) ;
//   · sur le dessus, un liseré clair le long des arêtes ; en haut des côtés, un filet clair ; aux arêtes verticales,
//     un filet sombre : les volumes se détachent les uns des autres.
// Les liserés font toujours au moins un pixel d'écran (fwidth) : pas de scintillement quand on dézoome.
const SOMMET = /* glsl */ `
  attribute vec3 cHaut; attribute vec3 cGauche; attribute vec3 cDroite;
  varying vec3 vC; varying vec3 vP; varying vec3 vT; varying float vDessus; varying float vAxeX;
  void main() {
    vDessus = step(0.5, abs(normal.y));
    vAxeX = step(0.5, abs(normal.x));
    if (vDessus > 0.5) vC = cHaut;
    else vC = mix(cGauche, cDroite, abs(normal.x) / (abs(normal.x) + abs(normal.z) + 1e-5));
    vP = position;
    vT = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
// les teintes sont déjà en sRGB (celles de l'écran) : rien à convertir, comme le résultat d'un MeshBasicMaterial
const pixel = (aretes: boolean) => /* glsl */ `
  varying vec3 vC; varying vec3 vP; varying vec3 vT; varying float vDessus; varying float vAxeX;
  float filet(float d, float large) { float w = max(large, fwidth(d) * 1.2); return 1.0 - smoothstep(w * 0.6, w, d); }
  void main() {
    vec3 c = vC;
    float gros = smoothstep(0.1, 0.22, min(vT.x, vT.z)); // les tout petits cubes (feuillages, herbe) gardent leur aplat
    if (vDessus > 0.5) {
      ${aretes ? 'float d = min((0.5 - abs(vP.x)) * vT.x, (0.5 - abs(vP.z)) * vT.z); c += 0.055 * filet(d, 0.03) * gros;' : ''}
    } else {
      float h = (vP.y + 0.5) * vT.y;                     // la hauteur au-dessus du pied du bloc
      c *= 1.0 - 0.2 * exp(-h * 9.0) * smoothstep(0.05, 0.3, vT.y);
      float haut = (0.5 - vP.y) * vT.y;
      c += 0.04 * filet(haut, 0.025) * gros;
      ${aretes ? 'float bord = vAxeX > 0.5 ? (0.5 - abs(vP.z)) * vT.z : (0.5 - abs(vP.x)) * vT.x; c *= 1.0 - 0.1 * filet(bord, 0.02) * gros;' : ''}
    }
    gl_FragColor = vec4(c, 1.0);
  }`;
const MATIERE = new THREE.ShaderMaterial({ vertexShader: SOMMET, fragmentShader: pixel(true) });
const MATIERE_RONDE = new THREE.ShaderMaterial({ vertexShader: SOMMET, fragmentShader: pixel(false) });

const PAVE = new THREE.BoxGeometry(1, 1, 1);
const CYLINDRE = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

/** Une teinte en sRGB (0–1), éventuellement assombrie (dans l'espace linéaire, comme boxMaterials). */
const tmp = new THREE.Color();
function teinte(hex: string, k = 1): [number, number, number] {
  tmp.set(hex).multiplyScalar(k);
  const o = { r: 0, g: 0, b: 0 };
  tmp.getRGB(o, THREE.SRGBColorSpace);
  return [o.r, o.g, o.b];
}

function Lot({ blocs, geo, matiere = MATIERE }: { blocs: Bloc[]; geo: THREE.BufferGeometry; matiere?: THREE.ShaderMaterial }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometrie = useMemo(() => {
    const g = geo.clone();
    const n = blocs.length, haut = new Float32Array(n * 3), gauche = new Float32Array(n * 3), droite = new Float32Array(n * 3);
    blocs.forEach((b, i) => {
      haut.set(teinte(b.top ?? b.c), i * 3);
      gauche.set(b.left ? teinte(b.left) : teinte(b.c, 0.85), i * 3);
      droite.set(b.right ? teinte(b.right) : teinte(b.c, 0.7), i * 3);
    });
    g.setAttribute('cHaut', new THREE.InstancedBufferAttribute(haut, 3));
    g.setAttribute('cGauche', new THREE.InstancedBufferAttribute(gauche, 3));
    g.setAttribute('cDroite', new THREE.InstancedBufferAttribute(droite, 3));
    return g;
  }, [blocs, geo]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    blocs.forEach((b, i) => {
      const z = b.z ?? 0;
      o.position.set(b.x + b.w / 2, z + b.h / 2, b.y + b.d / 2);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [blocs]);
  useLayoutEffect(() => () => geometrie.dispose(), [geometrie]);
  if (!blocs.length) return null;
  return <instancedMesh ref={ref} args={[geometrie, matiere, blocs.length]} frustumCulled={false} />;
}

/** Tous les blocs donnés, en deux objets (les pavés, les cylindres). */
export function Blocs({ blocs }: { blocs: Bloc[] }) {
  const [paves, cylindres] = useMemo(() => [blocs.filter(b => b.forme !== 'cylindre'), blocs.filter(b => b.forme === 'cylindre')], [blocs]);
  return (
    <>
      <Lot blocs={paves} geo={PAVE} />
      <Lot blocs={cylindres} geo={CYLINDRE} matiere={MATIERE_RONDE} />
    </>
  );
}
