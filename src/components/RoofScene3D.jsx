import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { solarAltAz } from '../lib/shading3d.js';

const _DOY = [17,47,75,105,135,162,198,228,258,288,318,344];

// Directional light that tracks the sun position for a given month + hour
function SunLight({ month, hour, lat }) {
  const lightRef  = useRef();
  const targetRef = useRef();

  useFrame(() => {
    if (!lightRef.current) return;
    const { altDeg, azDeg } = solarAltAz(_DOY[month] || 17, hour + 0.5, lat || 30.06);
    if (altDeg <= 0) {
      lightRef.current.intensity = 0;
      return;
    }
    lightRef.current.intensity = 1.2;
    const altR = altDeg * Math.PI / 180;
    const azR  = azDeg  * Math.PI / 180;
    // Three.js: Y-up, X-east, Z-south
    const x = -Math.cos(altR) * Math.sin(azR) * 50;
    const y =  Math.sin(altR) * 50;
    const z = -Math.cos(altR) * Math.cos(azR) * 50;
    lightRef.current.position.set(x, y, z);
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-near={0.5}
      shadow-camera-far={200}
      shadow-camera-left={-30}
      shadow-camera-right={30}
      shadow-camera-top={30}
      shadow-camera-bottom={-30}
      shadow-bias={-0.001}
    />
  );
}

// Flat roof surface
function Roof({ widthM, depthM }) {
  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[widthM, depthM]} />
      <meshStandardMaterial color="#9ca3af" roughness={0.9} metalness={0.0} />
    </mesh>
  );
}

// Roof parapet (edge wall that can cast shadow)
function Parapet({ widthM, depthM, height }) {
  const h = height || 0.4;
  const walls = [
    { pos: [0,           h/2,  depthM/2], size: [widthM, h, 0.12] },
    { pos: [0,           h/2, -depthM/2], size: [widthM, h, 0.12] },
    { pos: [ widthM/2,   h/2,  0],        size: [0.12,   h, depthM] },
    { pos: [-widthM/2,   h/2,  0],        size: [0.12,   h, depthM] },
  ];
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} castShadow receiveShadow position={w.pos}>
          <boxGeometry args={w.size} />
          <meshStandardMaterial color="#6b7280" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

// Single solar panel mesh
function Panel({ position, rotation, shadeFrac }) {
  const color = useMemo(() => {
    const r = Math.round(shadeFrac * 220);
    const g = Math.round(shadeFrac * 80);
    const b = Math.round(255 * (1 - shadeFrac * 0.6));
    return new THREE.Color(`rgb(${r},${g},${b})`);
  }, [shadeFrac]);

  return (
    <mesh castShadow receiveShadow position={position} rotation={rotation}>
      <boxGeometry args={[1.05, 0.04, 2.1]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
    </mesh>
  );
}

// Full panel array laid out in rows
function PanelArray({ tiltDeg, azDeg, rowSpacingM, panelsPerRow, nRows, shadingMatrix, month, hour }) {
  const tiltR = tiltDeg * Math.PI / 180;
  const azR   = (azDeg || 0) * Math.PI / 180;
  const panelW = 1.05;   // panel width (m)
  const panelL = 2.10;   // panel length (along slope, m)
  const gap    = 0.02;   // inter-panel gap

  const panels = useMemo(() => {
    const list = [];
    const nCols = panelsPerRow || 4;
    const nR    = nRows || 3;
    for (let r = 0; r < nR; r++) {
      for (let c = 0; c < nCols; c++) {
        // Panel centre: tilted, rotated by surface azimuth
        const rowZ   = (r - (nR-1)/2) * (rowSpacingM || 3.0);
        const colX   = (c - (nCols-1)/2) * (panelW + gap);
        // Tilt lifts the back edge: panel rotates around its bottom edge
        const panelMidRise = panelL * Math.sin(tiltR) / 2;
        const panelMidZ    = panelL * Math.cos(tiltR) / 2;
        list.push({
          x: colX * Math.cos(azR) + rowZ * Math.sin(azR),
          y: panelMidRise + 0.02,   // 2cm gap above roof
          z: -colX * Math.sin(azR) + rowZ * Math.cos(azR) - panelMidZ,
          row: r, col: c,
        });
      }
    }
    return list;
  }, [tiltDeg, azDeg, rowSpacingM, panelsPerRow, nRows]);

  const shadeFrac = (shadingMatrix && shadingMatrix[month] && shadingMatrix[month][hour]) || 0;

  return (
    <>
      {panels.map((p, i) => (
        <Panel
          key={i}
          position={[p.x, p.y, p.z]}
          rotation={[-tiltR, azR, 0]}
          shadeFrac={shadeFrac}
        />
      ))}
    </>
  );
}

// Roof obstacles (AC units, water tanks, parapets) — renders from inp.obstacles[]
// obstacle schema: { h, d, az, w } — h=height(m), d=distance(m), az=bearing(0=N,180=S), w=width(m)
function Obstacles({ obstacles }) {
  if (!obstacles || obstacles.length === 0) return null;
  return (
    <>
      {obstacles.map((ob, i) => {
        const az_rad = ((ob.az ?? 180) * Math.PI) / 180;
        // Scene: +x=east, -z=south, +z=north (confirmed from SunLight azimuth mapping)
        const ox = (ob.d || 3) * Math.sin(az_rad);
        const oz = (ob.d || 3) * Math.cos(az_rad);
        const h  = ob.h || 1.0;
        const w  = ob.w || 1.5;
        return (
          <mesh key={i} castShadow receiveShadow position={[ox, h / 2, oz]}>
            <boxGeometry args={[w, h, w * 0.8]} />
            <meshStandardMaterial color="#78716c" roughness={0.85} metalness={0.1} />
          </mesh>
        );
      })}
    </>
  );
}

export default function RoofScene3D({ inp, month, hour, shadingMatrix, rowSpacingM, panelsPerRow, nRows }) {
  const roofW  = Math.sqrt(inp?.roofAreaM2 || 100);
  const roofD  = roofW;
  const lat    = inp?.lat     || 30.06;
  const tiltD  = inp?.tiltDeg || 22;
  const azD    = inp?.azimuth || 0;

  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 20], fov: 45 }}
      style={{ background: '#0f172a', borderRadius: 8 }}
    >
      <ambientLight intensity={0.25} />
      <SunLight month={month} hour={hour} lat={lat} />
      <Roof widthM={roofW} depthM={roofD} />
      <Parapet widthM={roofW} depthM={roofD} height={0.4} />
      <Obstacles obstacles={inp?.obstacles} />
      <PanelArray
        tiltDeg={tiltD}
        azDeg={azD}
        rowSpacingM={rowSpacingM || 3.0}
        panelsPerRow={panelsPerRow || 4}
        nRows={nRows || 3}
        shadingMatrix={shadingMatrix}
        month={month}
        hour={hour}
      />
      <OrbitControls enablePan enableZoom enableRotate />
      <gridHelper args={[roofW * 1.5, 10, '#334155', '#1e293b']} />
    </Canvas>
  );
}
