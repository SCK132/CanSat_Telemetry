import { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

import { TelemetryData } from '@cansat/shared';

interface CanSat3DProps {
  dataRef: React.MutableRefObject<TelemetryData | null>;
}

function CanSatModel({ dataRef }: CanSat3DProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Smoothly interpolate rotation to avoid jitter
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // Read the latest telemetry data directly without triggering React re-renders!
    const data = dataRef.current;
    const pitch = data?.orientationX ?? 0;
    const roll = data?.orientationY ?? 0;
    const yaw = data?.orientationZ ?? 0;
    
    // Convert degrees to radians
    // Note: Three.js uses Y-up right-handed coordinate system.
    // Pitch (X-axis), Yaw (Y-axis), Roll (Z-axis)
    const targetRotation = new THREE.Euler(
      pitch * (Math.PI / 180),
      -yaw * (Math.PI / 180), // Invert yaw to match standard compass rotation
      -roll * (Math.PI / 180), // Invert roll to match right-hand rule visually
      'YXZ'
    );
    
    // Slerp for smooth rotation
    const currentQuat = groupRef.current.quaternion;
    const targetQuat = new THREE.Quaternion().setFromEuler(targetRotation);
    currentQuat.slerp(targetQuat, 0.1);
  });

  return (
    <group ref={groupRef}>
      {/* Main Body (Cylinder) */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 3, 32]} />
        <meshStandardMaterial color="#0ea5e9" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Nose cone to indicate "Forward" (Top) */}
      <mesh position={[0, 1.5 + 0.5, 0]} castShadow>
        <coneGeometry args={[1, 1, 32]} />
        <meshStandardMaterial color="#f43f5e" metalness={0.5} roughness={0.5} />
      </mesh>

      {/* Axis Indicators (X: Red=Pitch, Y: Green=Yaw, Z: Blue=Roll) */}
      <axesHelper args={[2.5]} />
    </group>
  );
}

export function CanSat3D({ dataRef }: CanSat3DProps) {
  return (
    <div className="w-full h-full relative bg-slate-900/50 rounded-lg overflow-hidden border border-slate-700">
      <Canvas camera={{ position: [4, 3, 4], fov: 50 }}>
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow shadow-bias={-0.0001} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        
        {/* Environment for nice reflections */}
        <Environment preset="city" />

        {/* The Model */}
        <CanSatModel dataRef={dataRef} />

        {/* Ground shadow for depth */}
        <ContactShadows position={[0, -2.5, 0]} opacity={0.5} scale={10} blur={2} far={4} />

        {/* Camera Controls */}
        <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={10} />
      </Canvas>
    </div>
  );
}
