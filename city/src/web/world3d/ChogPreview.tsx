// Art-review stage (open with ?preview=chog): the village line-up, each doing a different action.
// Any real Chog Genesis tokens can be checked with &tokens=954,12,1777 (up to 8).
// Not part of the game UI; used to check the Chog model against the real NFT art.
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { appearanceOf } from '../../shared/looks';
import { genesisLook } from '../../fixtures/chog-genesis';
import { DEFAULT_WEARS } from '../../fixtures/looks';
import type { Glyph } from '../world/art';
import { Chog3D, type ChogAction } from './Chog3D';

const ACTIONS: [ChogAction, Glyph][] = [
  ['idle', 'home'],
  ['wave', 'social'],
  ['chop', 'wood'],
  ['hammer', 'build'],
  ['idle', 'home'],
  ['mine', 'stone'],
  ['wave', 'social'],
  ['sleep', 'rest'],
];

export default function ChogPreview() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action') as ChogAction | null;
  const tokens = (params.get('tokens')?.split(',').map(Number) ?? DEFAULT_WEARS).slice(0, ACTIONS.length);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#cfe6ec' }}>
      <Canvas flat shadows="percentage" camera={{ position: [0, 1.9, 9.5], fov: 30 }} dpr={[1, 2]}>
        <color attach="background" args={['#cfe6ec']} />
        <hemisphereLight args={['#fff6e6', '#8fae6a', 1.2]} />
        <directionalLight position={[3, 6, 5]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[9, 48]} />
          <meshToonMaterial color="#9cc66b" />
        </mesh>
        {tokens.map((token, i) => {
          const look = genesisLook(token);
          if (!look) return null;
          const [a, glyph] = ACTIONS[i]!;
          return (
            <Chog3D
              key={i}
              seed={i}
              appearance={appearanceOf(look.traits)}
              target={[(i - (tokens.length - 1) / 2) * 1.15, 0]}
              face={0}
              action={action ?? a}
              glyph={glyph}
              name={`#${look.sourceTokenId}`}
              selected={false}
              reducedMotion={false}
              onSelect={() => {}}
            />
          );
        })}
        <OrbitControls target={[0, 0.9, 0]} />
      </Canvas>
    </div>
  );
}
