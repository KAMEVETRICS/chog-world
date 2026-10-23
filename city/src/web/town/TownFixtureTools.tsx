// Demo village only: enact a rule change directly, the way a passed vote will once voting opens.
import { useState } from 'react';
import type { FixtureCityClient } from '../../fixtures/fixture-client';

const CHANGES: ReadonlyArray<{ label: string; proposal: Record<string, number> | ((wage: number) => Record<string, number>) }> = [
  { label: 'Raise the wage by 2', proposal: (wage) => ({ wage: wage + 2 }) },
  { label: 'Try raising the wage by 5', proposal: (wage) => ({ wage: wage + 5 }) },
];

export function TownFixtureTools({ client, stepAway }: { client: FixtureCityClient; stepAway?: (pass: () => void) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const enact = async (proposal: (typeof CHANGES)[number]['proposal']) => {
    const wage = (await client.getSnapshot()).world.params.values.wage;
    const result = client.enactParams(typeof proposal === 'function' ? proposal(wage) : proposal);
    setMessage(result.ok ? 'Done. The new numbers apply from the next hour.' : `Not allowed by the city rules: ${result.problems.join(' ')}`);
  };
  return (
    <aside className="fixture-tools" aria-label="Demo tools">
      <p className="fixture-tools-title">Demo tools</p>
      <p className="fixture-tools-hint">Changes a rule the way a passed vote would, checked against the same city rules.</p>
      {CHANGES.map((c) => (
        <button key={c.label} type="button" className="button button--quiet" onClick={() => void enact(c.proposal)}>
          {c.label}
        </button>
      ))}
      <p className="fixture-tools-hint">Runs a whole village day at once, so a vote opened now closes.</p>
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
      <p className="fixture-tools-hint">Brings in one more Chog, the way a holder does on the live server. Watch the town grow to fit.</p>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          const name = client.welcomeChog();
          setMessage(name ? `${name} moved in.` : 'Every plot in town is taken.');
        }}
      >
        A new Chog moves in
      </button>
      {stepAway ? (
        <>
          <p className="fixture-tools-hint">Leaves the village for a day, then shows the "While you were away" recap.</p>
          <button type="button" className="button button--quiet" onClick={() => stepAway(() => client.skipDay())}>
            Step away for a village day
          </button>
        </>
      ) : null}
      <p className="fixture-tools-hint" role="status" aria-live="polite">
        {message ?? ''}
      </p>
    </aside>
  );
}
