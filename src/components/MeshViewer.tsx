/* eslint-disable react/no-unknown-property */
import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

interface MeshViewerProps {
  filePath: string;
  className?: string;
}

function STLModel({ url }: { url: string }): React.JSX.Element {
  const geometry = useLoader(STLLoader, url);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        metalness: 0.3,
        roughness: 0.6,
        flatShading: true,
      }),
    [],
  );

  return (
    <Center>
      <mesh geometry={geometry} material={material} />
    </Center>
  );
}

function OBJModel({ url }: { url: string }): React.JSX.Element {
  const obj = useLoader(OBJLoader, url);

  const cloned = useMemo(() => {
    const clone = obj.clone();
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: 0x8899aa,
          metalness: 0.3,
          roughness: 0.6,
          flatShading: true,
        });
      }
    });
    return clone;
  }, [obj]);

  return (
    <Center>
      <primitive object={cloned} />
    </Center>
  );
}

function ModelScene({
  filePath,
  extension,
}: {
  filePath: string;
  extension: string;
}): React.JSX.Element {
  const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Environment preset="studio" />

      {extension === '.stl' && <STLModel url={fileUrl} />}
      {extension === '.obj' && <OBJModel url={fileUrl} />}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  );
}

function LoadingSpinner(): React.JSX.Element {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color={0x666666} wireframe />
    </mesh>
  );
}

export default function MeshViewer({
  filePath,
  className = '',
}: MeshViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const ext = `.${extension}`;

  const isSupported = ext === '.stl' || ext === '.obj';

  if (!isSupported) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${className}`}
        data-testid="mesh-viewer-unsupported"
      >
        <p>Unsupported format: {ext}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`} data-testid="mesh-viewer">
      <Canvas
        camera={{ position: [3, 3, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={<LoadingSpinner />}>
          <ModelScene filePath={filePath} extension={ext} />
        </Suspense>
      </Canvas>
    </div>
  );
}
