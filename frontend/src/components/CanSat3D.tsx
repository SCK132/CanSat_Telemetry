import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import * as THREE from 'three';
import { TelemetryData } from '@cansat/shared';

interface CanSat3DProps { dataRef: React.MutableRefObject<TelemetryData | null>; state: number; attitudeValid: boolean; rcMode?: boolean; linkHealthy?: boolean; rcFollowAttitude?: boolean; }

function useTelemetryAttitude(dataRef: CanSat3DProps['dataRef'], attitudeValid: boolean) {
  const ref = useRef<THREE.Group>(null); const target = useRef(new THREE.Quaternion());
  useFrame((_, delta) => { if (!ref.current) return; const d = dataRef.current;
    const pitch = THREE.MathUtils.degToRad(attitudeValid ? d?.orientationX ?? 0 : -15);
    const roll = THREE.MathUtils.degToRad(attitudeValid ? d?.orientationY ?? 0 : 0);
    const yaw = THREE.MathUtils.degToRad(attitudeValid ? d?.orientationZ ?? d?.heading ?? 0 : 30);
    target.current.setFromEuler(new THREE.Euler(roll, yaw, -pitch, 'YXZ'));
    ref.current.quaternion.slerp(target.current, 1 - Math.exp(-5 * delta));
  }); return ref;
}

function RocketModel({ dataRef, attitudeValid }: Pick<CanSat3DProps, 'dataRef' | 'attitudeValid'>) {
  const source = useLoader(OBJLoader, '/models/Regulus.obj'); const groupRef = useTelemetryAttitude(dataRef, attitudeValid);
  const rocket = useMemo(() => { const clone = source.clone(true); const material = new THREE.MeshStandardMaterial({ color: '#d8dee5', metalness: .38, roughness: .48 });
    clone.traverse((child) => { if (child instanceof THREE.Mesh) { child.material = material; child.castShadow = true; child.receiveShadow = true; } });
    const oriented = new THREE.Group(); clone.rotation.x = -Math.PI / 2; oriented.add(clone); oriented.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(oriented), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()), scale = 3.6 / Math.max(size.x, size.y, size.z);
    oriented.scale.setScalar(scale); oriented.position.set(-center.x * scale, -1.04 - bounds.min.y * scale, -center.z * scale); return oriented;
  }, [source]);
  useEffect(() => () => rocket.traverse((child) => { if (child instanceof THREE.Mesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose()); }), [rocket]);
  return <group ref={groupRef}><primitive object={rocket} /></group>;
}

function Tire({ side }: { side: number }) {
  return <group rotation={[0, 0, Math.PI / 2]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[.86, .86, .42, 48]} /><meshStandardMaterial color="#df6425" roughness={.86} /></mesh>
    <mesh position={[0, .225, 0]} castShadow><cylinderGeometry args={[.56, .56, .035, 40]} /><meshStandardMaterial color="#151a1f" metalness={.18} roughness={.63} /></mesh>
    <mesh position={[0, -.225, 0]} castShadow><cylinderGeometry args={[.52, .52, .035, 40]} /><meshStandardMaterial color="#20252a" metalness={.12} roughness={.68} /></mesh>
    {Array.from({ length: 18 }, (_, index) => { const angle = index / 18 * Math.PI * 2; return <group key={index} rotation={[0, angle, 0]}>
      <mesh position={[0, .225, .79]} rotation={[0, 0, (index % 2 ? 1 : -1) * .43 * side]} castShadow><boxGeometry args={[.32, .075, .16]} /><meshStandardMaterial color="#8f3a18" roughness={1} /></mesh>
      <mesh position={[0, -.225, .79]} rotation={[0, 0, (index % 2 ? -1 : 1) * .43 * side]} castShadow><boxGeometry args={[.32, .075, .16]} /><meshStandardMaterial color="#f07b35" roughness={.92} /></mesh>
    </group>; })}
    {[0, 1, 2, 3, 4, 5].map((index) => <mesh key={index} position={[.39 * Math.cos(index * Math.PI / 3), .248, .39 * Math.sin(index * Math.PI / 3)]} rotation={[Math.PI / 2, 0, 0]}><boxGeometry args={[.13, .3, .08]} /><meshStandardMaterial color="#282d32" /></mesh>)}
    <mesh position={[0, .28, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.13, .13, .16, 24]} /><meshStandardMaterial color="#0d1115" metalness={.35} /></mesh>
  </group>;
}

function Ratchet({ side, deployed }: { side: number; deployed: boolean }) {
  const armRef = useRef<THREE.Group>(null); const wheelRef = useRef<THREE.Group>(null); const progress = useRef(deployed ? 1 : 0);
  useFrame((_, delta) => { progress.current = THREE.MathUtils.damp(progress.current, deployed ? 1 : 0, 5, delta); const p = progress.current;
    if (wheelRef.current) { wheelRef.current.position.set(side * (1.38 + .43 * p), -.04 - .25 * p, 0); wheelRef.current.rotation.x = side * .12 * p; }
    if (armRef.current) { armRef.current.scale.x = .35 + .48 * p; armRef.current.rotation.z = side * (-.13 - .36 * p); }
  });
  return <>
    <group position={[side * 1.27, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow><cylinderGeometry args={[.49, .49, .13, 20]} /><meshStandardMaterial color="#181d21" metalness={.2} roughness={.7} /></mesh>
      {Array.from({ length: 14 }, (_, i) => <mesh key={i} position={[.43 * Math.sin(i * Math.PI / 7), .085, .43 * Math.cos(i * Math.PI / 7)]} rotation={[0, i * Math.PI / 7, 0]}><boxGeometry args={[.12, .12, .16]} /><meshStandardMaterial color="#0e1317" /></mesh>)}
    </group>
    <group ref={armRef} position={[side * 1.27, -.05, 0]}>
      <mesh position={[side * .5, 0, 0]} castShadow><boxGeometry args={[1, .16, .22]} /><meshStandardMaterial color="#252b2f" metalness={.32} roughness={.55} /></mesh>
    </group>
    <group ref={wheelRef}><Tire side={side} /></group>
  </>;
}

function CircuitBoard() {
  return <group position={[0, .2, 0]}>
    <mesh castShadow><boxGeometry args={[2.15, .11, .88]} /><meshStandardMaterial color="#274f3d" roughness={.76} /></mesh>
    {[-.82, -.45, -.08, .35, .76].map((x, i) => <mesh key={x} position={[x, .1, i % 2 ? -.2 : .18]} castShadow><boxGeometry args={[i === 2 ? .38 : .25, .13, i === 2 ? .35 : .22]} /><meshStandardMaterial color={i === 2 ? '#d4d7d5' : '#151c1d'} metalness={.14} roughness={.6} /></mesh>)}
    {[-.7, -.35, 0, .35, .7].map((x) => <mesh key={x} position={[x, .075, -.39]}><boxGeometry args={[.03, .02, .62]} /><meshStandardMaterial color="#ba9f55" metalness={.45} /></mesh>)}
  </group>;
}

function RoverModel({ dataRef, attitudeValid, deployed }: Pick<CanSat3DProps, 'dataRef' | 'attitudeValid'> & { deployed: boolean }) {
  const ref = useTelemetryAttitude(dataRef, attitudeValid);
  return <group ref={ref} position={[0, -.02, 0]}>
    <Ratchet side={-1} deployed={deployed} /><Ratchet side={1} deployed={deployed} />
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow><cylinderGeometry args={[.7, .7, 2.65, 56, 1, true]} /><meshPhysicalMaterial color="#a9bbc2" transparent opacity={.2} roughness={.18} metalness={.04} transmission={.38} thickness={.06} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, -.58, 0]}><boxGeometry args={[2.35, .12, .83]} /><meshStandardMaterial color="#20282a" roughness={.75} /></mesh>
    <CircuitBoard />
    {[-1.27, 1.27].map((x) => <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[.69, .69, .09, 48]} /><meshStandardMaterial color="#20252a" metalness={.18} roughness={.66} /></mesh>)}
  </group>;
}

function RcWheel({ x, wheelRef }: { x: number; wheelRef: React.RefObject<THREE.Group> }) {
  return <group position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
    <group ref={wheelRef}>
      <mesh castShadow><cylinderGeometry args={[.79, .79, .48, 48]} /><meshStandardMaterial color="#ff8514" roughness={.76} /></mesh>
      <mesh position={[0, -Math.sign(x) * .243, 0]}><cylinderGeometry args={[.68, .68, .02, 48]} /><meshStandardMaterial color="#e86422" roughness={.74} /></mesh>
      <mesh position={[0, -Math.sign(x) * .26, 0]}><cylinderGeometry args={[.065, .065, .035, 16]} /><meshStandardMaterial color="#313235" metalness={.55} /></mesh>
      {Array.from({ length: 24 }, (_, i) => <group key={i} rotation={[0, i * Math.PI / 12, 0]}>
        <mesh position={[0, 0, .78]} rotation={[0, 0, i % 2 ? .22 : -.22]}><boxGeometry args={[.04, .44, .028]} /><meshStandardMaterial color={i % 3 ? '#ed7612' : '#ff9e26'} roughness={.85} /></mesh>
      </group>)}
    </group>
  </group>;
}

function RcCadBody() {
  const materials = useLoader(MTLLoader, '/models/regulus-rc-body.mtl');
  const source = useLoader(OBJLoader, '/models/regulus-rc-body.obj', (loader) => {
    const acrylic = materials.create('アクリル(クリア)');
    // The CAD export describes acrylic by name but does not include opacity.
    acrylic.transparent = true;
    acrylic.opacity = .38;
    acrylic.depthWrite = false;
    acrylic.side = THREE.DoubleSide;
    loader.setMaterials(materials);
  });
  const model = useMemo(() => {
    const copy = source.clone(true);
    copy.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const surface = Array.isArray(child.material) ? child.material : [child.material];
        const translucent = surface.some((material) => material.transparent);
        child.castShadow = !translucent;
        if (translucent) child.renderOrder = 1;
      }
    });
    return copy;
  }, [source]);
  // The CAD body spans x=0..8; fit it between the existing tires and keep the axle at z=0.
  return <primitive object={model} position={[-1.2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={.3} />;
}

const MODEL_UP = new THREE.Vector3(0, 1, 0);

function RcModel({ dataRef, rcFollowAttitude, linkHealthy }: CanSat3DProps) {
  const body = useRef<THREE.Group>(null);
  const pose = useMemo(() => ({
    up: new THREE.Vector3(), target: new THREE.Quaternion(), yaw: new THREE.Quaternion(),
  }), []);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    const data = dataRef.current;
    if (body.current) {
      if (!rcFollowAttitude) {
        pose.target.identity();
      } else if (linkHealthy && data?.operationMode === 3 && data.imuValid) {
        // RC board mounting: -Z up; exchange the horizontal axes to match the CAD body.
        pose.up.set(-data.accelX, -data.accelZ, -data.accelY);
        const magnitude = pose.up.length();
        if (magnitude >= 7.35 && magnitude <= 12.25) {
          pose.target.setFromUnitVectors(pose.up.multiplyScalar(1 / magnitude), MODEL_UP);
          if (data.magValid && Number.isFinite(data.heading)) {
            pose.yaw.setFromAxisAngle(MODEL_UP, -THREE.MathUtils.degToRad(data.heading));
            pose.target.premultiply(pose.yaw);
          }
        }
      }
      body.current.quaternion.slerp(pose.target, 1 - Math.exp(-6 * delta));
    }
    if (!linkHealthy || data?.operationMode !== 3 || data.state === 7) return;
    // Motor state reports commanded output; this is an illustrative speed, not measured RPM.
    const step = 7 * Math.min(delta, .05);
    if (left.current && (data.motorState === 1 || data.motorState === 3)) left.current.rotation.y += step;
    if (right.current && (data.motorState === 1 || data.motorState === 2)) right.current.rotation.y += step;
  });
  return <group ref={body} position={[0, -.24, 0]}>
    <RcWheel x={-1.45} wheelRef={left} /><RcWheel x={1.45} wheelRef={right} />
    <Suspense fallback={null}><RcCadBody /></Suspense>
  </group>;
}

function DigitalTwin(props: CanSat3DProps) { if (props.rcMode) return <RcModel {...props} />; if (props.state <= 2) return <RocketModel dataRef={props.dataRef} attitudeValid={props.attitudeValid} />; return <RoverModel dataRef={props.dataRef} attitudeValid={props.attitudeValid} deployed={props.state >= 5} />; }

export function CanSat3D(props: CanSat3DProps) {
  return <div className="digital-twin-canvas"><Canvas camera={{ position: [4.8, 3.15, 4.8], fov: 41 }} shadows dpr={[1, 1.5]}>
    <ambientLight intensity={1.2} /><directionalLight position={[5, 7, 4]} intensity={2.3} castShadow /><pointLight position={[-4, 2, -3]} intensity={.75} color="#8fc8e8" />
    <Suspense fallback={null}><DigitalTwin {...props} /></Suspense><ContactShadows position={[0, -1.04, 0]} opacity={.62} scale={8} blur={2.5} far={4} /><gridHelper args={[12, 24, '#263b52', '#172538']} position={[0, -1.04, 0]} /><OrbitControls makeDefault enablePan={false} minDistance={3.8} maxDistance={9} />
  </Canvas></div>;
}
