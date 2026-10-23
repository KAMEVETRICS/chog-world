import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';

function setup() {
  const client = new FixtureCityClient({ autoStart: false });
  const user = userEvent.setup();
  const view = render(<App client={client} onboarding />);
  return { client, user, view };
}

const goalsCard = () => screen.getByRole('region', { name: /goals|first steps/i });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('welcome and goals', () => {
  it('welcomes a first visit once, and a choice of villager opens the join form', async () => {
    const { user, view, client } = setup();
    const dialog = await screen.findByRole('dialog', { name: 'Chog City' });
    expect(within(dialog).getByText('Chogs run themselves')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Move in as a villager/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Villager C' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Town' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Join Chog City' })).toBeInTheDocument();
    expect(within(goalsCard()).getByText('First steps')).toBeInTheDocument();

    view.unmount();
    render(<App client={client} onboarding />);
    await screen.findByRole('tab', { name: 'Town' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a new villager joins, picks a job, and sees the shift ticked off after working', async () => {
    const { user, client } = setup();
    await user.click(await screen.findByRole('button', { name: /Move in as a villager/ }));
    await user.type(await screen.findByRole('textbox', { name: /^Name/ }), 'Tester');
    await user.click(screen.getByRole('button', { name: 'Join Chog City' }));

    const card = await screen.findByRole('region', { name: 'Day 1 goals' });
    expect(within(card).getByLabelText('0 of 3 done')).toBeInTheDocument();
    expect(within(card).getByText('Work a shift')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Farmhand/ }));
    await act(async () => client.tick());
    expect(await within(card).findByLabelText('1 of 3 done')).toBeInTheDocument();
    expect(within(card).getByText('(done)')).toBeInTheDocument();
  });

  it('"Show me" takes a visitor to a Chog, which finishes "Meet a Chog"', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Just look around first' }));
    expect(screen.getByRole('radio', { name: 'Visitor' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Show me: Meet a Chog' }));
    expect(screen.getByRole('tab', { name: 'Resident' })).toHaveAttribute('aria-selected', 'true');
    expect(within(goalsCard()).getByLabelText('1 of 3 done')).toBeInTheDocument();
  });

  it('a holder lands on their own Chog with a check-in goal; How to play reopens the welcome', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /I have a Chog/ }));
    expect(screen.getByRole('radio', { name: 'Holder A' })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Check on your Chogs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByRole('dialog', { name: 'Chog City' })).toBeInTheDocument();
  });
});
