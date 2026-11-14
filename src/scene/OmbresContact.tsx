'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Bloc } from './Blocs';

// Les ombres de contact (v2) : sous chaque meuble, une tache sombre et douce posée sur le sol, un peu décalée vers
// l'avant. Elles ancrent les meubles au sol (sans elles, tout semble flotter sur un aplat). Peintes, comme le reste :
// pas de vraie lumière, toutes dessinées d'un seul coup, juste au-dessus du sol, avant l'assombrissement de la nuit.

/** Jusqu'où l'ombre déborde du meuble, et de combien elle glisse vers l'avant (+x, +z : les faces que l'on voit). */
const MARGE = 0.3, GLISSE: [number, number] = [0.2, 0.16];
/** La hauteur du sol où elles sont posées (au-dessus du sol du bâtiment, sous tout le reste). */
const SOL = 0.006;

/** Les blocs qui font de l'ombre : près du sol, ni minuscules ni immenses (pas les sols, pas les murs entiers). */
export function fontOmbre(b: Bloc): boolean {
  const z = b.z ?? 0;
  return z >= -0.01 && z < 0.75 && b.h >= 0.05 && b.w * b.d >= 0.02 && b.w <= 9 && b.d <= 9;
}

const MATIERE = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: /* glsl */ `
    attribute vec2 demi; attribute float force;
    varying vec2 vP; varying vec2 vDemi; varying float vForce;
    void main() {
      vP = position.xy * (demi + ${MARGE.toFixed(2)}) * 2.0; vDemi = demi; vForce = force;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vP; varying vec2 vDemi; varying float vForce;
    void main() {
      vec2 q = abs(vP) - vDemi;                       // la distance au bord du meuble (0 dessous)
      float d = length(max(q, 0.0));
      float a = 1.0 - smoothstep(0.0, ${MARGE.toFixed(2)}, d);
      gl_FragColor = vec4(0.13, 0.08, 0.24, a * vForce * 1.5);
    }`,
});
const PLAN = new THREE.PlaneGeometry(1, 1);

export function OmbresContact({ blocs }: { blocs: Bloc[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const liste = useMemo(() => blocs.filter(fontOmbre), [blocs]);
  const geometrie = useMemo(() => {
    const g = PLAN.clone();
    const demi = new Float32Array(liste.length * 2), force = new Float32Array(liste.length);
    liste.forEach((b, i) => {
      demi.set([b.w / 2, b.d / 2], i * 2);
      // plus le bloc est haut au-dessus du sol, plus son ombre est légère ; un bloc bas et large (un tapis) en fait peu
      force[i] = 0.3 * (1 - (b.z ?? 0) / 0.9) * Math.min(1, 0.45 + b.h * 1.4);
    });
    g.setAttribute('demi', new THREE.InstancedBufferAttribute(demi, 2));
    g.setAttribute('force', new THREE.InstancedBufferAttribute(force, 1));
    return g;
  }, [liste]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    o.rotation.x = -Math.PI / 2;
    liste.forEach((b, i) => {
      o.position.set(b.x + b.w / 2 + GLISSE[0], SOL, b.y + b.d / 2 + GLISSE[1]);
      o.scale.set(b.w + MARGE * 2, b.d + MARGE * 2, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [liste]);
  useLayoutEffect(() => () => geometrie.dispose(), [geometrie]);
  if (!liste.length) return null;
  return <instancedMesh ref={ref} args={[geometrie, MATIERE, liste.length]} frustumCulled={false} renderOrder={5} />;
}
