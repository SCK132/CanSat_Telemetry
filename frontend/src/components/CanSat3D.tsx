import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as THREE from 'three';
import { TelemetryData } from '@cansat/shared';

interface CanSat3DProps {
  dataRef: React.MutableRefObject<TelemetryData | null>;
  state: number;
  attitudeValid: boolean;
}

function useTelemetryAttitude(dataRef: CanSat3DProps['dataRef'], attitudeValid: boolean) {
  const groupRef = useRef<THREE.Group>(null);
  const targetQuaternion = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const telemetry = dataRef.current;
    const pitch = THREE.MathUtils.degToRad(attitudeValid ? telemetry?.orientationX ?? 0 : -15);
    const roll = THREE.MathUtils.degToRad(attitudeValid ? telemetry?.orientationY ?? 0 : 0);
    const yaw = THREE.MathUtils.degToRad(
      attitudeValid ? telemetry?.orientationZ ?? telemetry?.heading ?? 0 : 30,
    );
    targetQuaternion.current.setFromEuler(
      new THREE.Euler(roll, yaw, -pitch, 'YXZ'),
    );
    group.quaternion.slerp(
      targetQuaternion.current,
      1 - Math.exp(-5 * delta),
    );
  });

  return groupRef;
}

function RocketModel({ dataRef, attitudeValid }: Pick<CanSat3DProps, 'dataRef' | 'attitudeValid'>) {
  const source = useLoader(OBJLoader, '/models/Regulus.obj');
  const groupRef = useTelemetryAttitude(dataRef, attitudeValid);
  const rocket = useMemo(() => {
    const clone = source.clone(true);
    const material = new THREE.MeshStandardMaterial({
      color: '#d8dee5',
      metalness: 0.38,
      roughness: 0.48,
    });
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    // OBJを表示時と同じ向きにしてから境界を求め、床面と画面中央へ揃える。
    const oriented = new THREE.Group();
    clone.rotation.x = -Math.PI / 2;
    oriented.add(clone);
    oriented.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(oriented);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 3.6 / Math.max(size.x, size.y, size.z);
    oriented.scale.setScalar(scale);
    oriented.position.set(
      -center.x * scale,
      -1.04 - bounds.min.y * scale,
      -center.z * scale,
    );
    return oriented;
  }, [source]);

  useEffect(() => () => {
    rocket.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }, [rocket]);

  return (
    <group ref={groupRef}>
      <primitive object={rocket} />
    </group>
  );
}

function Wheel({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.92, 0.92, 0.48, 32]} />
        <meshStandardMaterial color="#ef772e" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.48, 0.48, 0.04, 32]} />
        <meshStandardMaterial color="#171b22" metalness={0.25} roughness={0.55} />
      </mesh>
      {[-0.24, 0, 0.24].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[0.72, 0.055, 8, 32]} />
          <meshStandardMaterial color="#9e461d" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function RoverModel({
  dataRef,
  attitudeValid,
  deployed,
}: Pick<CanSat3DProps, 'dataRef' | 'attitudeValid'> & { deployed: boolean }) {
  const groupRef = useTelemetryAttitude(dataRef, attitudeValid);
  const wheelX = deployed ? 1.78 : 1.42;

  return (
    <group ref={groupRef} rotation={[0, 0.25, -0.08]}>
      <Wheel x={-wheelX} />
      <Wheel x={wheelX} />

      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.72, 2.82, 48]} />
        <meshPhysicalMaterial
          color="#b8c7cf"
          transparent
          opacity={0.28}
          roughness={0.25}
          metalness={0.05}
          transmission={0.18}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[2.25, 0.18, 0.9]} />
        <meshStandardMaterial color="#26342f" metalness={0.08} roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.23, 0]} castShadow>
        <boxGeometry args={[1.45, 0.12, 0.68]} />
        <meshStandardMaterial color="#315847" metalness={0.08} roughness={0.72} />
      </mesh>

      {[-1.24, 1.24].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.7, 0.7, 0.12, 40]} />
          <meshStandardMaterial color="#242a31" metalness={0.16} roughness={0.7} />
        </mesh>
      ))}

      <mesh position={[0.22, 0.37, 0]} castShadow>
        <boxGeometry args={[0.5, 0.18, 0.45]} />
        <meshStandardMaterial color="#d8dce0" metalness={0.25} roughness={0.48} />
      </mesh>
      <mesh position={[-0.5, 0.42, 0]} castShadow>
        <boxGeometry args={[0.34, 0.22, 0.34]} />
        <meshStandardMaterial color="#171c22" roughness={0.58} />
      </mesh>
    </group>
  );
}

function DigitalTwin({ dataRef, state, attitudeValid }: CanSat3DProps) {
  if (state <= 2) return <RocketModel dataRef={dataRef} attitudeValid={attitudeValid} />;
  return <RoverModel dataRef={dataRef} attitudeValid={attitudeValid} deployed={state >= 5} />;
}

export function CanSat3D({ dataRef, state, attitudeValid }: CanSat3DProps) {
  return (
    <div className="digital-twin-canvas">
      <Canvas camera={{ position: [4.8, 3.1, 4.8], fov: 42 }} shadows dpr={[1, 1.5]}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[5, 7, 4]} intensity={2.2} castShadow />
        <pointLight position={[-4, 2, -3]} intensity={1.2} color="#46b7ff" />
        <Suspense fallback={null}>
          <DigitalTwin dataRef={dataRef} state={state} attitudeValid={attitudeValid} />
        </Suspense>
        <ContactShadows position={[0, -1.04, 0]} opacity={0.62} scale={8} blur={2.5} far={4} />
        <gridHelper args={[12, 24, '#263b52', '#172538']} position={[0, -1.04, 0]} />
        <OrbitControls makeDefault enablePan={false} minDistance={3.8} maxDistance={9} />
      </Canvas>
    </div>
  );
}