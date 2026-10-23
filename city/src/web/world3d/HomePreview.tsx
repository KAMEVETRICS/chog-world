// Art-review stage (open with ?preview=homes): every home style at every level, side by side on lots.
// Not part of the game UI; used to check that each upgrade reads clearly and the top level looks grandest.
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { HOME_STYLES } from '../../shared/contracts';
import { MAX_HOME_LEVEL } from '../../shared/rules';
import { House3D, Lot3D } from './models';

export default function HomePreview() {
  const levels = Array.from({ length: MAX_HOME_LEVEL }, (_, i) => i + 1);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#cfe6ec' }}>
      <Canvas flat shadows="percentage" camera={{ position: [0, 10, 11.5], fov: 32 }} dpr={[1, 2]}>
        <color attach="background" args={['#cfe6ec']} />
        <hemisphereLight args={['#fff6e6', '#8fae6a', 1.2]} />
        <directionalLight position={[3, 7, 5]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[16, 10]} />
          <meshToonMaterial color="#9cc66b" />
        </mesh>
        {HOME_STYLES.map((style, row) =>
          levels.map((level) => (
            <group key={`${style}${level}`} position={[(level - (MAX_HOME_LEVEL + 1) / 2) * 2.1, 0, (row - 1) * 3.4]}>
              <Lot3D vacant={false} raised={false} highlighted={false} />
              <group position={[-0.08, 0.06, -0.12]}>
                <House3D style={style} level={level} />
              </group>
            </group>
          )),
        )}
        <OrbitControls target={[0, 0.4, 0]} />
      </Canvas>
    </div>
  );
}
