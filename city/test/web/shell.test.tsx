import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';

function setup() {
  const client = new FixtureCityClient({ autoStart: false });
  const user = userEvent.setup();
  render(<App client={client} />);
  return { client, user };
}

/** Opens one section of the selected Chog's card. */
async function openSection(user: ReturnType<typeof userEvent.setup>, name: 'Life' | 'Home' | 'Market' | 'Council' | 'Settings') {
  await user.click(await screen.findByRole('tab', { name }));
}

async function ticks(client: FixtureCityClient, n: number) {
  await act(async () => {
    for (let i = 0; i < n; i += 1) client.tick();
  });
}

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('observation shell', () => {
  it('labels fixture mode and shows token zero as the first resident', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Mossy' })).toBeInTheDocument();
    expect(screen.getByText('Chog #0')).toBeInTheDocument();
    expect(screen.getByText('Demo village')).toBeInTheDocument();
    expect(screen.getByText(/No wallet or blockchain is connected/)).toBeInTheDocument();
  });

  it('renders all 8 residents and the 3 villagers on the map as keyboard-reachable buttons', async () => {
    setup();
    const map = await screen.findByRole('group', { name: /map of/i });
    const chogs = within(map).getAllByRole('button', { name: /Chog #/ });
    const villagers = within(map).getAllByRole('button', { name: /villager\./ });
    expect(chogs).toHaveLength(8);
    expect(villagers).toHaveLength(3);
    [...chogs, ...villagers].forEach((token) => expect(token).toHaveAttribute('tabindex', '0'));
  });

  it('selects a resident from the roster list and persists it in the URL', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('navigation', { name: 'Residents by location' });
    await user.click(within(roster).getByRole('button', { name: /Bramble/ }));
    expect(screen.getByRole('heading', { name: 'Bramble' })).toBeInTheDocument();
    expect(window.location.search).toContain('chog=2');
  });

  it('shows reserved materials while a home is under construction', async () => {
    const { client } = setup();
    await ticks(client, 3);
    expect(await screen.findByText('6 reserved')).toBeInTheDocument();
    expect(screen.getByText('Building its cottage · 2 hours left')).toBeInTheDocument();
  });
});

describe('holder settings', () => {
  it('a visitor sees settings read-only', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Visitor' }));
    expect(screen.getByText('View only')).toBeInTheDocument();
    await openSection(user, 'Settings');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('explains the cancellation before saving, then pauses and releases reservations', async () => {
    const { client, user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await ticks(client, 3);
    await openSection(user, 'Settings');
    const save = screen.getByRole('button', { name: 'Save settings' });
    expect(save).toBeDisabled(); // nothing changed yet: a no-op cannot be saved

    await user.click(screen.getByRole('switch'));
    expect(screen.getByText(/Saving cancels the level 1 build/)).toBeInTheDocument();
    await user.click(save);

    expect(await screen.findByText('Paused by its holder')).toBeInTheDocument();
    await openSection(user, 'Life');
    expect(screen.queryByText(/reserved/)).not.toBeInTheDocument();
    await openSection(user, 'Home');
    expect(screen.getByText('An empty lot')).toBeInTheDocument();
  });

  it('a stale form surfaces the newer version instead of overwriting it', async () => {
    const { client, user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Settings');
    await user.click(screen.getByRole('radio', { name: 'Gatherer' }));

    // Another tab changes the same Chog first.
    const [mossy] = await client.getMyAgents();
    await act(async () => {
      await client.updatePolicy(
        mossy!.key,
        { expectedVersion: mossy!.policy.version, expectedEpoch: mossy!.control.epoch, active: true, focus: 'social', homeStyle: 'cottage' },
        'other-tab',
      );
    });

    expect(await screen.findByText(/changed elsewhere while you were editing/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else first/);
    expect((await client.getAgent(mossy!.key))!.policy.focus).toBe('social');
  });

  it('a simulated sale hands the Chog to the other holder, paused', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Sell Mossy to Holder B' }));
    expect(await screen.findByText('Paused by its holder')).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Holder B' }));
    expect(await screen.findByText('Yours')).toBeInTheDocument();
    await openSection(user, 'Settings');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('needs, mood and decorating', () => {
  it('everyone sees the mood and needs; they move as the village day passes', async () => {
    const { client } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    expect(screen.getByText('Cheerful')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Energy 80 of 100' })).toBeInTheDocument();
    await ticks(client, 1);
    expect(await screen.findByRole('img', { name: 'Energy 76 of 100' })).toBeInTheDocument();
  });

  it('the holder buys a decoration from the Chog stores; a visitor only sees it', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Home');
    expect(screen.getByText('No decorations yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buy Lantern for 2 wood' }));
    expect(await screen.findByText('Lantern added.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Decorations' })).getByText('Lantern')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buy Lantern/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Visitor' }));
    expect(within(screen.getByRole('list', { name: 'Decorations' })).getByText('Lantern')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Buy / })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Village log' }));
    expect(screen.getByText(/home got a new lantern/)).toBeInTheDocument();
  });

  it('says so when the stores can’t pay', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Home');
    await user.click(screen.getByRole('button', { name: /Buy Well/ }));
    expect(await screen.findByText("Not enough free materials in this Chog's stores.")).toBeInTheDocument();
  });
});

describe('town: citizens and City Hall', () => {
  it('a visitor sees City Hall and the villagers, and is asked to pick a player', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Visitor' }));
    await user.click(screen.getByRole('tab', { name: 'Town' }));
    expect(screen.getByText(/Pick Holder A, Holder B or Villager C/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /City rules/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Wage' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Villagers' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('Villager C joins without an NFT, takes a job and is paid by the city', async () => {
    const { client, user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Villager C' }));
    await user.click(screen.getByRole('tab', { name: 'Town' }));
    const join = screen.getByRole('button', { name: 'Join Chog City' });
    expect(join).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Clover');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fur' }), 'Green');
    await user.click(join);
    expect(await screen.findByRole('heading', { name: 'Clover' })).toBeInTheDocument();
    expect(screen.getByText(/Votes after 3 more working days/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Farmhand/ }));
    expect(screen.getByRole('radio', { name: /Farmhand/ })).toBeChecked();
    await ticks(client, 1);
    expect(await screen.findByText('14')).toBeInTheDocument(); // 10 starting coins + a wage of 5, less 1 coin tax
    expect(screen.getAllByText(/Farmhand at Clover Farm/).length).toBeGreaterThan(0);
  });

  it('City Hall enacts a change the constitution allows and refuses one it does not', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Town' }));
    await user.click(screen.getByRole('button', { name: 'Raise the wage by 2' }));
    expect(await screen.findByText(/Done. The new numbers/)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Wage/ })).getByText('7 coins')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try raising the wage by 5' }));
    expect(await screen.findByText(/Not allowed by the city rules: Wage must stay between 0 and 10/)).toBeInTheDocument();
  });
});

describe('the economy', () => {
  it("a holder sells Mossy's wood at the Plaza market and Mossy earns coins", async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Market');
    const market = screen.getByRole('table', { name: /Lantern Plaza market/ });
    expect(within(market).getByRole('rowheader', { name: 'Wood' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sell 1 wood' }));
    expect(await screen.findByText('Sold 1 wood.')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.startsWith('Mossy has 5 coins.') === true)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Village log' }));
    expect(screen.getByText(/Mossy sold 1 wood at the market for 5 coins/)).toBeInTheDocument();
  });

  it('a visitor sees prices and offers but cannot trade, hire or give', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Visitor' }));
    await openSection(user, 'Market');
    expect(screen.getByRole('table', { name: /Lantern Plaza market/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sell \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Job offer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give a gift' })).not.toBeInTheDocument();
  });

  it('Mossy hires Villager C, who takes the job; Villager C chips in to the fountain', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Market');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Job' }), 'quarrier');
    await user.click(screen.getByRole('button', { name: 'Post offer' }));
    expect(await screen.findByText('Job offer posted.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Villager C' }));
    await user.click(screen.getByRole('tab', { name: 'Town' }));
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Clover');
    await user.click(screen.getByRole('button', { name: 'Join Chog City' }));
    await screen.findByRole('heading', { name: 'Clover' });
    const offers = screen.getByRole('list', { name: 'Job offers' });
    expect(within(offers).getByText(/Quarrier · 3 coins an hour/)).toBeInTheDocument();
    await user.click(within(offers).getByRole('button', { name: 'Take job' }));
    expect(await screen.findByText('You now work for Mossy.')).toBeInTheDocument();

    const fountain = screen.getByRole('form', { name: 'Give to the Plaza Fountain' });
    await user.clear(within(fountain).getByRole('spinbutton'));
    await user.type(within(fountain).getByRole('spinbutton'), '4');
    await user.click(within(fountain).getByRole('button', { name: 'Chip in' }));
    expect(await screen.findByText('Thank you! Gave 4 coins.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Coins 4 of 30' })).toBeInTheDocument();
    // A long flow through the UI; give it room on a busy machine.
  }, 15_000);
});

describe('votes', () => {
  it('a holder proposes through their Chog, a villager votes, and the rule changes when the vote closes', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Villager C' }));
    await user.click(screen.getByRole('tab', { name: 'Town' }));
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Clover');
    await user.click(screen.getByRole('button', { name: 'Join Chog City' }));
    await user.click(await screen.findByRole('radio', { name: /Farmhand/ }));
    expect(screen.getByText(/You can vote after working on 3 different village days/)).toBeInTheDocument();
    for (let day = 0; day < 3; day += 1) await user.click(screen.getByRole('button', { name: 'Skip a village day' }));
    expect(await screen.findByText('Can vote')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Holder A' }));
    await user.click(screen.getByRole('tab', { name: 'Resident' }));
    await openSection(user, 'Council');
    const form = screen.getByRole('form', { name: 'Propose for the city' });
    expect(within(form).getByText(/Now 5 coins\. Allowed 0–10, moving at most 2 per vote/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Propose' }));
    expect(await screen.findByText('Proposed. Villagers have one village day to vote.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Villager C' }));
    await user.click(screen.getByRole('tab', { name: 'Town' }));
    const proposals = screen.getByRole('list', { name: 'Proposals' });
    expect(within(proposals).getAllByText(/Wage to 7 coins/).length).toBeGreaterThan(0);
    await user.click(within(proposals).getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText('You voted yes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip a village day' }));
    expect(await within(screen.getByRole('list', { name: 'Proposals' })).findByText('Passed')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Wage/ })).getByText('7 coins')).toBeInTheDocument();
    // Four village days of ticks run through the UI.
  }, 20_000);
});

describe('the council', () => {
  it("a holder's instructions become their Chog's proposal at the morning council, and the Chogs debate it", async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'Mossy' });
    await openSection(user, 'Council');
    const box = await screen.findByRole('form', { name: 'Standing instructions' });
    await user.type(within(box).getByRole('textbox'), 'Please cut the income tax.');
    await user.click(within(box).getByRole('button', { name: 'Save instructions' }));
    expect(await screen.findByText(/Saved\. Mossy will follow this at the next council/)).toBeInTheDocument();

    // A visitor never sees them.
    await user.click(screen.getByRole('radio', { name: 'Visitor' }));
    expect(screen.queryByRole('form', { name: 'Standing instructions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Town' }));
    await user.click(screen.getByRole('button', { name: 'Skip a village day' }));
    const proposals = await screen.findByRole('list', { name: 'Proposals' });
    expect(within(proposals).getAllByText(/Income tax to 15 %/).length).toBeGreaterThan(0);
    const debate = within(proposals).getByRole('list', { name: /Debate on Income tax to 15 %/ });
    expect(within(debate).getAllByRole('listitem').length).toBeGreaterThan(1);
    expect(within(debate).getAllByText('rules').length).toBeGreaterThan(0);
  }, 15_000);
});
