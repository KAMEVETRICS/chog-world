import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { makeFixtureWorld } from '../../src/fixtures/residents';
import { Instructions } from '../../src/web/economy/Council';

it('shows a failed instruction load and keeps saving disabled', async () => {
  const agent = makeFixtureWorld().agents[0]!;
  render(
    <Instructions
      agent={agent}
      load={async () => { throw new Error("Can't reach the village right now."); }}
      save={async () => { throw new Error('Instructions must be loaded before saving.'); }}
    />,
  );

  expect(await screen.findByText("Can't reach the village right now.")).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save instructions' })).toBeDisabled();
});
