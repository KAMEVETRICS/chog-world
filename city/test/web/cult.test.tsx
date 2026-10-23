import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import { HttpCityClient, type SiteInfo } from '../../src/web/api/http-client';
import { makeFixtureWorld, FIXTURE_ACTORS } from '../../src/fixtures/residents';

const world = makeFixtureWorld();
const chog = world.agents[0]!;
const SITE: SiteInfo = { mode: 'live', label: 'Monad mainnet', chainIds: [143], login: true, city: true };
const member = { agentKey: chog.key, name: chog.name, faction: 'crown', stance: 'persona', joinedCycle: 1, control: 'verified', currentVotes: [], reputation: { loyalty: 0, glory: 0 } };
const snapshot = () => ({ revision: '9', cycle: 4, phase: 'vote', nextBoundaryAt: new Date(Date.now() + 60000).toISOString(),
  places: [{ place: 'plaza', ruler: 'crown', sinceCycle: 3, decree: { id: 'golden-lanterns', title: 'Golden Lanterns', feedLine: 'Golden lanterns light the Plaza.' } },
    { place: 'tavern', ruler: null, sinceCycle: null, decree: null }, { place: 'workshop', ruler: null, sinceCycle: null, decree: null }],
  factions: [{ id: 'crown', name: 'The Crown', creed: 'Order, wealth and influence.', members: 1, glory: 0, placesRuled: ['plaza'] },
    { id: 'chaos', name: 'The Chaos', creed: 'Freedom, noise and disruption.', members: 0, glory: 0, placesRuled: [] }],
  members: [member], recentEvents: [{ revision: '9', cycle: 4, type: 'debate', payload: { text: 'The Plaza belongs to the village.', scripted: false }, createdAt: new Date().toISOString() }] });

class Source {
  static all: Source[] = [];
  listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;
  constructor(readonly url: string) { Source.all.push(this); }
  addEventListener(type: string, callback: (event: Event) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners.get(type)?.forEach(callback => callback(new MessageEvent(type, { data: JSON.stringify(data) }))); }
}

function setup({ rejectWrites = false } = {}) {
  let signedIn = false;
  let revision = '9';
  const writes: { url: string; headers: Record<string,string>; body: Record<string,unknown> }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') {
      writes.push({ url, headers: init.headers as Record<string,string>, body: JSON.parse(String(init.body)) });
      if (rejectWrites) return json({ error: { code: 'CONTROL_CHANGED', message: 'This Chog changed hands; reload and try again.' } }, 409);
      return json({ member: {}, vote: {} });
    }
    if (url === '/api/city/snapshot') return json({ revision: '1', tick: '0', nextDueAt: new Date(Date.now() + 10000).toISOString(), world, recentEvents: [] });
    if (url === '/api/city/me/agents') return json({ agents: signedIn ? [chog] : [] });
    if (url === '/api/cult/places') return json({ revision, cycle: 4, places: snapshot().places });
    if (url === '/api/cult/snapshot') return json({ ...snapshot(), revision });
    if (url === '/api/me') return signedIn ? json({ address: FIXTURE_ACTORS.A.address, chogs: [{ ...member, ownershipEpoch: '7' }] }) : json({ error: { code: 'LOGIN_REQUIRED', message: 'Sign in first.' } }, 401);
    if (url === '/api/auth/challenge') return json({ message: 'Sign in to Chog World' });
    if (url === '/api/auth/verify') { signedIn = true; return json({ address: FIXTURE_ACTORS.A.address, csrfToken: 'cult-session-token' }); }
    if (url === '/api/auth/logout') { signedIn = false; return json({ loggedOut: true }); }
    if (url.startsWith('/api/soul/')) return json({ error: { code: 'NOT_FOUND' } }, 404);
    return json({ text: null });
  }));
  window.ethereum = { request: vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? [FIXTURE_ACTORS.A.address] : `0x${'ab'.repeat(65)}`) };
  const client = new HttpCityClient({ EventSource: Source as unknown as typeof EventSource });
  render(<App client={client} server={{ site: SITE }} />);
  return { writes, changeRevision: (value: string) => { revision = value; }, user: userEvent.setup() };
}

beforeEach(() => { sessionStorage.clear(); Source.all = []; vi.stubGlobal('EventSource', Source); window.history.replaceState(null, '', '/city/?tab=cult'); });
afterEach(() => { vi.unstubAllGlobals(); delete window.ethereum; });

it('opens Cult inside the City panel, retains the village and receives live Cult events', async () => {
  const { user } = setup();
  expect(await screen.findByRole('tab', { name: 'Cult' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('region', { name: 'Village' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Chog Cult' })).toBeVisible();
  expect(screen.getByText('Golden Lanterns')).toBeVisible();
  expect(screen.getByText('The Plaza belongs to the village.')).toBeVisible();
  await waitFor(() => expect(Source.all.some(source => source.url === '/api/cult/events?after=9')).toBe(true));
  const source = Source.all.find(source => source.url === '/api/cult/events?after=9')!;
  source.emit('debate', { revision: '10', cycle: 4, type: 'debate', payload: { text: 'Keep the Workshop open.' }, createdAt: new Date().toISOString() });
  expect(await screen.findByText('Keep the Workshop open.')).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Town' }));
  expect(source.closed).toBe(true);
});

it('shows stale-ownership refusals and removes holder controls on sign-out', async () => {
  const { user } = setup({ rejectWrites: true });
  await screen.findByRole('heading', { name: 'Chog Cult' });
  expect(screen.queryByRole('combobox', { name: 'Faction' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Sign in with wallet' }));
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Faction' }), 'chaos');
  await user.click(screen.getByRole('button', { name: 'Save faction settings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This Chog changed hands');
  expect(screen.queryByText('Faction settings saved.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.queryByRole('combobox', { name: 'Faction' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Who rules' })).toBeVisible();
});

it('uses City sign-in and includes the CSRF token, idempotency key and current ownership epoch on Cult actions', async () => {
  const { user, writes } = setup();
  await screen.findByRole('heading', { name: 'Chog Cult' });
  await user.click(screen.getByRole('button', { name: 'Sign in with wallet' }));
  const faction = await screen.findByRole('combobox', { name: 'Faction' });
  const votes = screen.getByRole('group', { name: "This cycle's votes" });
  await user.selectOptions(within(votes).getByRole('combobox', { name: 'Plaza decree' }), 'crown-parade');
  await user.click(within(votes).getByRole('button', { name: 'Vote for Plaza' }));
  await waitFor(() => expect(writes.some(write => write.url.includes('/votes/4/'))).toBe(true));
  expect(writes.find(write => write.url.includes('/votes/4/'))!.body).toMatchObject({ decreeId: 'crown-parade', expectedEpoch: '7' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save faction settings' })).not.toBeEnabled());
  await user.selectOptions(faction, 'chaos');
  await user.click(screen.getByRole('button', { name: 'Save faction settings' }));
  await waitFor(() => expect(writes.some(write => write.url.includes('/members/'))).toBe(true));
  const membership = writes.find(write => write.url.includes('/members/'))!;
  expect(membership.body).toMatchObject({ faction: 'chaos', expectedEpoch: '7' });
  expect(membership.headers['x-csrf-token']).toBe('cult-session-token');
  expect(membership.headers['idempotency-key']).toBeTruthy();
});
