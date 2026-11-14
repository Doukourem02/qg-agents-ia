'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { vue } from './vue';
import { aiguilles, minutesDe } from '@/sim/lumiere';
import { useQG } from '@/store';

// L'horloge du mur du fond, à l'heure réelle d'Abidjan (UTC) : un cadran rond, 12 repères, deux aiguilles,
// pas de trotteuse (calme). Elle avance à chaque minute (store `horloge`), jamais à chaque image.
// Placée entre deux fenêtres du long mur du fond, au-dessus du coin de la Direction et du vestiaire, face à la caméra (+z).

/** Le centre du cadran (x, hauteur, profondeur) : entre les fenêtres 17,2–19,0 et 20,4–22,2 du mur du fond (Mac & Outils
 *  occupe maintenant le mur plus à droite). */
export const HORLOGE: [number, number, number] = [19.7, 1.65, 0];
const R = 0.64; // rayon du cadre

const mat = (c: string) => new THREE.MeshBasicMaterial({ color: c });
const CADRE = mat('#3a3f55'), CADRE_COTE = mat('#2a2e40'), CADRAN = mat('#fffaf0'), REPERE = mat('#1d1b2e'), AIGUILLE = mat('#1d1b2e'), MINUTE = mat('#d23b3b');

/** Une aiguille qui tourne autour du centre : une fine baguette qui part du centre vers « midi », tournée de `angle`. */
function Aiguille({ angle, longueur, largeur, z, m }: { angle: number; longueur: number; largeur: number; z: number; m: THREE.Material }) {
  return (
    <group rotation={[0, 0, -angle]} position={[0, 0, z]}>
      <mesh position={[0, longueur / 2 - 0.05, 0]} material={m}><boxGeometry args={[largeur, longueur, 0.02]} /></mesh>
    </group>
  );
}

export function Horloge() {
  const minutes = minutesDe(useQG(s => s.horloge));
  const a = aiguilles(minutes);
  const survol = (dedans: boolean) => {
    document.body.style.cursor = dedans ? 'pointer' : '';
    if (useQG.getState().hoverHorloge !== dedans) useQG.setState({ hoverHorloge: dedans });
  };
  // le long mur du fond se baisse quand la caméra passe derrière lui : l'horloge part avec lui
  const groupe = useRef<THREE.Group>(null);
  useFrame(() => { if (groupe.current) groupe.current.visible = vue.murs.N > 0.92; });
  return (
    <group
      ref={groupe}
      position={HORLOGE}
      onPointerOver={e => { e.stopPropagation(); survol(true); }}
      onPointerOut={() => survol(false)}
      onClick={e => { e.stopPropagation(); survol(!useQG.getState().hoverHorloge); }}
    >
      {/* le cadre, puis le cadran clair un peu devant : deux disques à facettes, dans l'esprit des voxels */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.04]} material={[CADRE_COTE, CADRE, CADRE]}><cylinderGeometry args={[R, R, 0.08, 20]} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.085]} material={CADRAN}><cylinderGeometry args={[R - 0.08, R - 0.08, 0.01, 20]} /></mesh>
      {/* 12 repères, plus marqués à 12, 3, 6 et 9 */}
      {Array.from({ length: 12 }, (_, i) => {
        const t = (i / 12) * Math.PI * 2, fort = i % 3 === 0, r = R - 0.17;
        return (
          <mesh key={i} position={[Math.sin(t) * r, Math.cos(t) * r, 0.095]} rotation={[0, 0, -t]} material={REPERE}>
            <boxGeometry args={[fort ? 0.07 : 0.04, fort ? 0.13 : 0.07, 0.01]} />
          </mesh>
        );
      })}
      <Aiguille angle={a.heures} longueur={0.32} largeur={0.075} z={0.105} m={AIGUILLE} />
      <Aiguille angle={a.minutes} longueur={0.48} largeur={0.05} z={0.12} m={MINUTE} />
      <mesh position={[0, 0, 0.135]} material={AIGUILLE}><boxGeometry args={[0.09, 0.09, 0.02]} /></mesh>
    </group>
  );
}
