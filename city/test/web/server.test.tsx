import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import { CityApiError, HttpCityClient, type SiteInfo } from '../../src/web/api/http-client';
import { FIXTURE_ACTORS, makeFixtureWorld } from '../../src/fixtures/residents';
import type { AgentState, CityEvent, CitySnapshot } from '../../src/shared/contracts';

const SITE: SiteInfo = { mode: 'live', label: 'Monad mainnet', chainIds: [143], login: true, city: true };
const HOLDER = FIXTURE_ACTORS.A.address;
const SIGNATURE = `0x${'ab'.repeat(65)}`;

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static all: FakeEventSource[] = [];
  static at(url: string) {
    return FakeEventSource.all.filter((source) => source.url === url).at(-1)!;
  }
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** A stand-in for the Chog server: Holder A's Fennel (token 6) starts outside the village. */
function fakeServer() {
  const full = makeFixtureWorld();
  const fennel = full.agents.find((agent) => agent.name === 'Fennel')!;
  const world = { ...full, agents: full.agents.filter((agent) => agent !== fennel) };
  const state = {
    signedIn: false,
    places: [
      { place: 'plaza', ruler: 'crown', sinceCycle: 3, decree: { id: 'golden-lanterns', title: 'Golden Lanterns', banner: 'lantern-gold', feedLine: 'The Plaza glows.' } },
      { place: 'tavern', ruler: null, sinceCycle: null, decree: null },
      { place: 'workshop', ruler: 'chaos', sinceCycle: 4, decree: { id: 'mask-market', title: 'Mask Market', banner: 'mask-purple', feedLine: 'Masks for sale.' } },
    ] as unknown[],
    messages: [] as { role: 'holder' | 'chog'; text: string; createdAt: string }[],
    chatFailures: 0,
  };
  const mossy = world.agents.find((agent) => agent.name === 'Mossy')!;
  const soulPath = `/api/soul/chogs/${encodeURIComponent(mossy.key)}`;
  const calls: Call[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const loginRequired = () => json(401, { error: { code: 'LOGIN_REQUIRED', message: 'Sign in with your wallet first.' } });
  const snapshot = (): CitySnapshot => ({ revision: '5', tick: '0', nextDueAt: new Date(Date.now() + 10_000).toISOString(), world, recentEvents: [] });
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body });
    const mine = () => world.agents.filter((agent) => agent.control.controller === HOLDER);
    const instructionKey = /^\/api\/city\/agents\/([^/]+)\/instructions$/.exec(url)?.[1];
    if (method === 'GET' && instructionKey) {
      if (!state.signedIn) return loginRequired();
      const agent = world.agents.find((entry) => entry.key === decodeURIComponent(instructionKey));
      if (!agent) return json(404, { error: { code: 'NOT_FOUND', message: 'This Chog is no longer in the village.' } });
      if (agent.control.controller !== HOLDER) return json(403, { error: { code: 'NOT_CONTROLLER', message: 'Only the holder can read these instructions.' } });
      return json(200, { text: null });
    }
    switch (url) {
      case '/api/cult/places':
        return json(200, { revision: '9', cycle: 4, places: state.places });
      case '/api/soul/config':
        return json(200, {
          ai: true, model: 'test', payment: { mode: 'fixture', chainId: 31337, token: null, treasury: null },
          prices: { chat: '1', debate: '0.25', vote: '0.25' }, defaultDailyCap: '20', maxDailyCap: '1000',
        });
      case '/api/soul/me':
        return state.signedIn ? json(200, { address: HOLDER, balance: '50', held: '0', usage: [], deposits: [] }) : loginRequired();
      case soulPath:
        return json(200, {
          persona: {
            name: 'Mossy', temperament: ['calm'], talents: ['farming'], voice: 'slow and soothing', catchphrase: 'Breathe in, build slow.',
            summary: 'Mossy is calm, good at farming, and speaks in slow and soothing.',
          },
        });
      case `${soulPath}/private`:
        return state.signedIn
          ? json(200, { epoch: '1', messages: state.messages, settings: { aiEnabled: false, dailyCap: '20', spentToday: '0' } })
          : loginRequired();
      case `${soulPath}/chat`:
        if (state.chatFailures > 0) {
          state.chatFailures -= 1;
          return json(502, { error: { code: 'PROVIDER_FAILED', message: 'The model failed.' } });
        }
        state.messages.push(
          { role: 'holder', text: String(body?.message), createdAt: '' },
          { role: 'chog', text: 'Breathe in. The forest will wait.', createdAt: '' },
        );
        return json(200, { reply: 'Breathe in. The forest will wait.', price: '1', balance: '49' });
      case '/api/city/snapshot':
        return json(200, snapshot());
      case '/api/city/me/agents':
        return state.signedIn ? json(200, { address: HOLDER, agents: mine() }) : loginRequired();
      case '/api/me':
        return state.signedIn ? json(200, { address: HOLDER }) : loginRequired();
      case '/api/auth/challenge':
        return json(200, { message: `127.0.0.1 wants you to sign in with your Ethereum account:\n${String(body?.address)}\n\nChain ID: ${String(body?.chainId)}` });
      case '/api/auth/verify':
        state.signedIn = true;
        return json(200, { address: HOLDER, chainId: 143, csrfToken: 'c'.repeat(64), expiresAt: new Date().toISOString() });
      case '/api/auth/logout':
        state.signedIn = false;
        return json(200, { loggedOut: true });
      case '/api/city/admissions':
        if (body?.tokenId !== '6') return json(409, { error: { code: 'NOT_AWAKENED', message: `Chog #${String(body?.tokenId)} isn't awakened yet. Awaken it first, then bring it in.` } });
        if (!world.agents.includes(fennel)) world.agents = [...world.agents, fennel];
        return json(200, { agent: fennel });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, calls };
}

function wallet() {
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => (method === 'eth_requestAccounts' ? [HOLDER] : SIGNATURE));
  window.ethereum = { request };
  return request;
}

function renderServer() {
  const client = new HttpCityClient({ EventSource: FakeEventSource as unknown as typeof EventSource });
  const user = userEvent.setup();
  render(<App client={client} server={{ site: SITE }} />);
  return { client, user };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/city/');
  sessionStorage.clear();
  FakeEventSource.all = [];
  // The Cult rulers follow Cult's event stream with the browser's EventSource.
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.ethereum;
});

describe('server mode', () => {
  it('labels the live world, follows the event stream and has no fixture tools', async () => {
    fakeServer();
    renderServer();
    expect(await screen.findByRole('heading', { name: 'Mossy' })).toBeInTheDocument();
    expect(screen.getByText('Monad mainnet')).toBeInTheDocument();
    expect(screen.queryByText('Fixture village')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Advance a tick' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sell / })).not.toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.all.map((source) => source.url)).toContain('/api/city/events?after=5'));
  });

  it('signs in with the wallet over SIWE, then lets the holder edit their own Chog', async () => {
    const { calls } = fakeServer();
    const request = wallet();
    const { user } = renderServer();
    await user.click(await screen.findByRole('button', { name: 'Sign in with wallet' }));
    const account = screen.getByRole('region', { name: 'Account' });
    expect(await within(account).findByText('0xa11c…0a11')).toBeInTheDocument();
    const challenge = calls.find((call) => call.url === '/api/auth/challenge')!;
    expect(challenge.body).toEqual({ address: HOLDER, chainId: 143 });
    const message = (await (await fetch('/api/auth/challenge', { method: 'POST', body: JSON.stringify(challenge.body) })).json()) as { message: string };
    const hex = `0x${Array.from(new TextEncoder().encode(message.message), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    expect(request).toHaveBeenCalledWith({ method: 'personal_sign', params: [hex, HOLDER] });
    expect(calls.find((call) => call.url === '/api/auth/verify')?.body).toEqual({ message: message.message, signature: SIGNATURE });
    expect(await screen.findByText('Yours')).toBeInTheDocument();
    expect(screen.queryByText('View only')).not.toBeInTheDocument();
    expect(screen.getByText(/Held by you/)).toBeInTheDocument();
  });

  it('says so when there is no browser wallet', async () => {
    fakeServer();
    const { user } = renderServer();
    await user.click(await screen.findByRole('button', { name: 'Sign in with wallet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No browser wallet found');
  });

  it('brings a Chog in by token number, showing the server’s refusal first', async () => {
    const { calls } = fakeServer();
    wallet();
    const { user } = renderServer();
    await user.click(await screen.findByRole('button', { name: 'Sign in with wallet' }));
    await user.click(await screen.findByRole('button', { name: 'Bring a Chog' }));
    const form = screen.getByRole('form', { name: 'Bring a Chog into the village' });
    const input = within(form).getByLabelText('Chog Genesis token number');
    await user.type(input, '9');
    await user.click(within(form).getByRole('button', { name: 'Bring it in' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent("Chog #9 isn't awakened yet");
    await user.clear(input);
    await user.type(input, '6');
    await user.click(within(form).getByRole('button', { name: 'Bring it in' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('Fennel lives on plot 7.');
    expect(await screen.findByRole('heading', { name: 'Fennel' })).toBeInTheDocument();
    const admission = calls.filter((call) => call.url === '/api/city/admissions').at(-1)!;
    expect(admission).toMatchObject({ method: 'POST', body: { tokenId: '6' }, headers: { 'x-csrf-token': 'c'.repeat(64) } });
  });
});

describe('Cult rulers and Chog Soul in City', () => {
  it('shows who rules each place, follows control changes, and says when the Cult is out of reach', async () => {
    const { state } = fakeServer();
    const { user } = renderServer();
    await user.click(await screen.findByRole('tab', { name: 'Roster' }));
    const rulers = await screen.findByRole('region', { name: /Who rules/ });
    const row = (place: string) => within(rulers).getByText(place).closest('li')!;
    await waitFor(() => expect(row('Lantern Plaza')).toHaveTextContent('The CrownGolden Lanterns'));
    expect(row('The Sleepy Newt')).toHaveTextContent('Neutral');
    expect(row('Tinker Workshop')).toHaveTextContent('The ChaosMask Market');
    expect(within(rulers).getByText('Chog Cult · cycle 4')).toBeInTheDocument();
    expect([...document.querySelectorAll('.map-ruler')].map((label) => label.textContent)).toEqual(['Crown', 'Chaos']);

    state.places[1] = { place: 'tavern', ruler: 'chaos', sinceCycle: 5, decree: { id: 'loud-nights', title: 'Loud Nights', banner: 'x', feedLine: 'y' } };
    FakeEventSource.at('/api/cult/events').emit('place_control_changed', { revision: '10', cycle: 4, type: 'place_control_changed', payload: {}, createdAt: '' });
    await waitFor(() => expect(row('The Sleepy Newt')).toHaveTextContent('The ChaosLoud Nights'));

    FakeEventSource.at('/api/cult/events').emit('error', {});
    expect(await within(rulers).findByText(/may be out of date/)).toBeInTheDocument();
    expect(row('Lantern Plaza')).toHaveTextContent('The Crown');
  });

  it('shows the persona to everyone and lets the holder chat, retrying a failed message without a second charge', async () => {
    const { calls, state } = fakeServer();
    wallet();
    const { user } = renderServer();
    // The persona loads after the resident panel, which takes a moment to render in jsdom.
    expect(await screen.findByText('“Breathe in, build slow.”', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Only its holder can talk to it')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message to Mossy' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in with wallet' }));
    const input = await screen.findByRole('textbox', { name: 'Message to Mossy' }, { timeout: 5000 });
    expect(screen.getByText('50 CHOG')).toBeInTheDocument();
    state.chatFailures = 1;
    await user.type(input, 'How is the forest?');
    await user.click(screen.getByRole('button', { name: 'Send · 1 CHOG' }));
    expect(await screen.findByText("Your Chog couldn't answer just now. You were not charged.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send · 1 CHOG' }));
    expect(await screen.findByText('Breathe in. The forest will wait.')).toBeInTheDocument();
    const chats = calls.filter((call) => call.url.endsWith('/chat'));
    expect(chats).toHaveLength(2);
    expect(chats[0]!.headers['idempotency-key']).toBe(chats[1]!.headers['idempotency-key']);
    expect(chats[1]).toMatchObject({ method: 'POST', body: { message: 'How is the forest?' }, headers: { 'x-csrf-token': 'c'.repeat(64) } });
    // A long flow in jsdom (sign-in, Soul panel, two sends): about 4 s alone, slower when the suite runs in parallel.
  }, 15_000);
});

describe('HttpCityClient', () => {
  it('delivers each event once and reloads on reset', () => {
    const client = new HttpCityClient({ EventSource: FakeEventSource as unknown as typeof EventSource });
    const seen: string[] = [];
    let resets = 0;
    const stop = client.subscribe('5', (event) => seen.push(event.revision), () => (resets += 1));
    const source = FakeEventSource.last!;
    const event = (revision: string): CityEvent => ({ revision, type: 'city_tick', data: { tick: '1', changes: [], activities: [] }, createdAt: new Date().toISOString() });
    source.emit('city_tick', event('6'));
    source.emit('city_tick', event('6'));
    source.emit('policy_changed', { ...event('4'), type: 'policy_changed' });
    source.emit('reset', { revision: '40' });
    source.emit('city_tick', event('39'));
    source.emit('city_tick', event('41'));
    expect(seen).toEqual(['6', '41']);
    expect(resets).toBe(1);
    stop();
    expect(source.closed).toBe(true);
  });

  it('turns settings refusals into form results and other failures into errors with the server’s message', async () => {
    const agent = makeFixtureWorld().agents[0]!;
    const request = { expectedVersion: '1', expectedEpoch: '1', active: true, focus: 'social' as const, homeStyle: 'cottage' as const };
    const client = new HttpCityClient({ EventSource: FakeEventSource as unknown as typeof EventSource });
    await expect(client.updatePolicy(agent.key, request, 'key-00001')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    sessionStorage.setItem('chog-cult-csrf', 'c'.repeat(64));
    const replies: [number, unknown][] = [
      [409, { error: { code: 'POLICY_CHANGED', message: 'These settings changed.' } }],
      [503, { error: { code: 'OWNERSHIP_UNAVAILABLE', message: "Ownership can't be checked right now; try again shortly." } }],
      [200, { agent: { ...agent, policy: { ...agent.policy, focus: 'social', version: '2' } } satisfies AgentState }],
    ];
    const fetchMock = vi.fn(async () => {
      const [status, body] = replies.shift()!;
      return new Response(JSON.stringify(body), { status });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await client.updatePolicy(agent.key, request, 'key-00001')).toEqual({ ok: false, code: 'POLICY_CHANGED' });
    const failure = client.updatePolicy(agent.key, request, 'key-00001');
    await expect(failure).rejects.toBeInstanceOf(CityApiError);
    await expect(failure).rejects.toThrow("Ownership can't be checked right now");
    expect(await client.updatePolicy(agent.key, request, 'key-00001')).toMatchObject({ ok: true, agent: { policy: { version: '2' } } });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/city/agents/${encodeURIComponent(agent.key)}/policy`, expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'x-csrf-token': 'c'.repeat(64), 'idempotency-key': 'key-00001' }),
    }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
