// Fixture-only: enact a rule change directly, the way a passed vote will once voting opens.
import { useState } from 'react';
import type { FixtureCityClient } from '../../fixtures/fixture-client';

const CHANGES: ReadonlyArray<{ label: string; proposal: Record<string, number> | ((wage: number) => Record<string, number>) }> = [
  { label: 'Raise the wage by 2', proposal: (wage) => ({ wage: wage + 2 }) },
  { label: 'Try raising the wage by 5', proposal: (wage) => ({ wage: wage + 5 }) },
];

export function TownFixtureTools({ client }: { client: FixtureCityClient }) {
  const [message, setMessage] = useState<string | null>(null);
  const enact = async (proposal: (typeof CHANGES)[number]['proposal']) => {
    const wage = (await client.getSnapshot()).world.params.values.wage;
    const result = client.enactParams(typeof proposal === 'function' ? proposal(wage) : proposal);
    setMessage(result.ok ? 'Enacted. The new numbers apply from the next tick.' : `Refused by the constitution: ${result.problems.join(' ')}`);
  };
  return (
    <aside className="fixture-tools" aria-label="Fixture tools">
      <p className="fixture-tools-title">Fixture tools</p>
      <p className="fixture-tools-hint">Enacts a change the way a passed vote will, through the same constitution check.</p>
      {CHANGES.map((c) => (
        <button key={c.label} type="button" className="button button--quiet" onClick={() => void enact(c.proposal)}>
          {c.label}
        </button>
      ))}
      <p className="fixture-tools-hint">Runs 36 ticks at once, so a vote opened now closes.</p>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          client.skipDay();
          setMessage('A village day went by.');
        }}
      >
        Skip a village day
      </button>
      <p className="fixture-tools-hint" role="status" aria-live="polite">
        {message ?? ''}
      </p>
    </aside>
  );
}
