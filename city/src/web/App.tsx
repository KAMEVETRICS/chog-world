import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentState, CityAction, InstructionsRequest, DecorateRequest, JobRequest, JoinRequest, PolicyUpdateRequest } from '../shared/contracts';
import { TICK_MS } from '../shared/rules';
import { FIXTURE_ACTORS, type FixtureActorId } from '../fixtures/residents';
import type { FixtureCityClient } from '../fixtures/fixture-client';
import { AccountBar } from './account/AccountBar';
import { CultRulers } from './cult/CultRulers';
import { CultPanel } from './cult/CultPanel';
import { useCultRulers } from './cult/rulers';
import { ResidentSoul } from './soul/SoulPanel';
import { useCity } from './api/city-client';
import type { HttpCityClient, SiteInfo } from './api/http-client';
import { appearanceFor, lookOf, redressVillage, useWears } from './looks';
import { ActivityFeed } from './activity/ActivityFeed';
import { ResidentPanel } from './resident/ResidentPanel';
import { CityMap } from './world/CityMap';
import { PlaceList } from './world/PlaceList';
import { TownPanel } from './town/TownPanel';
import { TownFixtureTools } from './town/TownFixtureTools';
import { dayNumber, fractionalTick, phaseName, timeOfDay } from './world3d/daylight';
import './app.css';

const Scene3D = lazy(() => import('./world3d/Scene3D'));

type Tab = 'resident' | 'town' | 'cult' | 'roster' | 'log';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resident', label: 'Resident' },
  { id: 'town', label: 'Town' },
  { id: 'cult', label: 'Cult' },
  { id: 'roster', label: 'Roster' },
  { id: 'log', label: 'Village log' },
];

function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGL2RenderingContext === 'undefined') return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function readUrl(): { chog: string | null; tab: Tab } {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return { chog: params.get('chog'), tab: tab === 'roster' || tab === 'log' || tab === 'town' || tab === 'cult' ? tab : 'resident' };
}

function writeUrl(chog: string | null, tab: Tab) {
  const params = new URLSearchParams(window.location.search);
  if (chog === null) params.delete('chog');
  else params.set('chog', chog);
  if (tab === 'resident') params.delete('tab');
  else params.set('tab', tab);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function Clock({ nextDueAt, tick }: { nextDueAt: string; tick: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, new Date(nextDueAt).getTime() - now);
  const fraction = 1 - remaining / TICK_MS;
  const ft = fractionalTick(tick, nextDueAt, now);
  const tod = timeOfDay(ft);
  const r = 9;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="clock hud-card" aria-label={`Day ${dayNumber(ft)}, ${phaseName(tod)}. Tick ${tick}. Next tick in ${Math.ceil(remaining / 1000)} seconds.`}>
      <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true">
        <circle r={r} className="clock-track" />
        <circle
          r={r}
          className="clock-hand"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
          transform="rotate(-90)"
        />
      </svg>
      <span className="clock-text" aria-hidden="true">
        <span className="clock-day">
          Day {dayNumber(ft)} · {phaseName(tod)}
        </span>
        <span className="clock-next num">
          Tick {tick} · next in {Math.ceil(remaining / 1000)}s
        </span>
      </span>
    </div>
  );
}

const holderName = (address: string) => {
  const match = Object.values(FIXTURE_ACTORS).find((a) => a.address === address.toLowerCase());
  return match ? match.label : 'a holder';
};

/** Fixture mode runs the village in the browser; server mode follows the Chog server with wallet sign-in. */
export type AppProps =
  | { client: FixtureCityClient; server?: undefined }
  | { client: HttpCityClient; server: { site: SiteInfo } };

export function App(props: AppProps) {
  const { client } = props;
  const fixture = props.server ? null : props.client;
  const { snapshot, mine, error, refresh } = useCity(client);
  useWears(); // re-render when the fixture village is re-dressed
  const initial = useMemo(readUrl, []);
  const [selectedToken, setSelectedToken] = useState<string | null>(initial.chog);
  const [tab, setTab] = useState<Tab>(initial.tab === 'cult' && !props.server ? 'town' : initial.tab);
  const tabs = props.server ? TABS : TABS.filter(entry => entry.id !== 'cult');
  const [actor, setActorState] = useState<FixtureActorId | null>(fixture?.currentActor ?? null);
  // Server mode: the signed-in wallet. Signing in or out changes which residents are "mine".
  const [me, setMe] = useState<string | null>(null);
  const live = Boolean(props.server);
  const rulers = useCultRulers(live);
  useEffect(() => {
    if (live) void refresh();
  }, [live, me, refresh]);
  const [focusNonce, setFocusNonce] = useState(0);
  const narrow = useMediaQuery('(max-width: 760px)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [panelOpen, setPanelOpen] = useState(() => initial.tab === 'cult' || !(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches));
  const webgl = useMemo(supportsWebGL, []);

  const world = snapshot?.world;
  const mineKeys = useMemo(() => new Set(mine.map((a) => a.key)), [mine]);
  const selected: AgentState | undefined = world
    ? world.agents.find((a) => a.identity.tokenId === selectedToken) ?? world.agents[0]
    : undefined;

  useEffect(() => writeUrl(selected?.identity.tokenId ?? null, tab), [selected?.identity.tokenId, tab]);

  const select = useCallback(
    (key: string) => {
      const agent = world?.agents.find((a) => a.key === key);
      if (!agent) return;
      setSelectedToken(agent.identity.tokenId);
      setTab('resident');
      setFocusNonce((n) => n + 1);
      setPanelOpen(true);
    },
    [world],
  );

  const selectCitizen = useCallback(() => {
    setTab('town');
    setPanelOpen(true);
  }, []);

  // [ and ] cycle through residents, like switching characters in a game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!world || (e.key !== '[' && e.key !== ']')) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const i = world.agents.findIndex((a) => a.key === selected?.key);
      const next = world.agents[(i + (e.key === ']' ? 1 : world.agents.length - 1)) % world.agents.length];
      if (next) select(next.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [world, selected?.key, select]);

  const switchActor = (next: FixtureActorId | null) => {
    fixture?.setActor(next);
    setActorState(next);
    void refresh();
  };

  const save = useCallback(
    async (request: PolicyUpdateRequest, idempotencyKey: string) => {
      const result = await client.updatePolicy(selected!.key, request, idempotencyKey);
      void refresh();
      return result;
    },
    [client, selected, refresh],
  );

  const decorate = useCallback(
    async (request: DecorateRequest, idempotencyKey: string) => {
      const result = await client.decorate(selected!.key, request, idempotencyKey);
      void refresh();
      return result;
    },
    [client, selected, refresh],
  );

  const join = useCallback(
    async (request: JoinRequest, idempotencyKey: string) => {
      const result = await client.joinCity(request, idempotencyKey);
      void refresh();
      return result;
    },
    [client, refresh],
  );

  const setJob = useCallback(
    async (request: JobRequest, idempotencyKey: string) => {
      const result = await client.setJob(request, idempotencyKey);
      void refresh();
      return result;
    },
    [client, refresh],
  );

  const act = useCallback(
    async (action: CityAction, idempotencyKey: string) => {
      const result = await client.act(action, idempotencyKey);
      void refresh();
      return result;
    },
    [client, refresh],
  );

  const instructions = useMemo(
    () => ({ load: (key: string) => client.getInstructions(key), save: (key: string, request: InstructionsRequest) => client.setInstructions(key, request) }),
    [client],
  );

  const signedOut = useCallback(() => setMe(null), []);

  const admitted = useCallback(
    (agent: AgentState) => {
      setSelectedToken(agent.identity.tokenId);
      setTab('resident');
      setPanelOpen(true);
      void refresh();
    },
    [refresh],
  );

  if (!snapshot || !world) {
    return (
      <div className="loading" role="status">
        <p>Opening the village gates…</p>
      </div>
    );
  }

  const built = world.agents.filter((a) => a.homeLevel > 0).length;
  const myAddress = props.server ? me : actor ? FIXTURE_ACTORS[actor].address : null;
  const fixtureTools =
    fixture && selected && selected.control.kind === 'controlled' ? (
      <aside className="fixture-tools" aria-label="Fixture tools">
        <p className="fixture-tools-title">Fixture tools</p>
        <p className="fixture-tools-hint">Simulates an NFT sale through the same rule a real transfer uses.</p>
        <button type="button" className="button button--quiet" onClick={() => fixture.simulateTransfer(selected.key)}>
          Sell {selected.name} to{' '}
          {holderName(selected.control.controller!) === FIXTURE_ACTORS.A.label ? FIXTURE_ACTORS.B.label : FIXTURE_ACTORS.A.label}
        </button>
        <p className="fixture-tools-hint">Swaps every resident's look for a random Chog from the real collection of 1,969.</p>
        <button type="button" className="button button--quiet" onClick={() => redressVillage(world.agents.length)}>
          Dress the village as random Chogs
        </button>
      </aside>
    ) : null;

  const flatMap = (
    <div className="flat-stage">
      <CityMap world={world} selectedKey={selected?.key ?? null} onSelect={select} rulers={rulers} />
    </div>
  );

  return (
    <div className={`game${narrow ? ' is-narrow' : ''}`}>
      <section className="stage" aria-label="Village">
        {webgl ? (
          <Suspense
            fallback={
              <div className="stage-loading" role="status">
                Raising the village…
              </div>
            }
          >
            <Scene3D
              world={world}
              tick={snapshot.tick}
              nextDueAt={snapshot.nextDueAt}
              selectedKey={selected?.key ?? null}
              focusNonce={focusNonce}
              reducedMotion={reducedMotion}
              onSelect={select}
              onSelectCitizen={selectCitizen}
              rulers={rulers}
            />
          </Suspense>
        ) : (
          flatMap
        )}
      </section>

      <header className="hud hud-brand hud-card">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="-12 -22 24 24" width="30" height="30">
            <path d="M-9 -7 L-12 -11 L-8 -12 L-9 -16 L-5 -15 L-4 -19 L0 -16.5 L3 -19.5 L5 -15.5 L9 -16.5 L8.5 -12 L12.5 -11 L9 -7 Z" fill="var(--chog-deep)" />
            <ellipse cx="0" cy="-8" rx="8.6" ry="8" fill="var(--chog)" />
            <ellipse cx="0" cy="-6.8" rx="6" ry="4.8" fill="#fbf3cd" />
            <circle cx="-2.5" cy="-8" r="1.5" fill="var(--ink)" />
            <circle cx="2.5" cy="-8" r="1.5" fill="var(--ink)" />
          </svg>
        </span>
        <div>
          <h1 className="brand-name">Chog City</h1>
          <p className="brand-sub">
            <span className="num">{world.agents.length}</span> Chogs · <span className="num">{world.citizens.length}</span> villagers · <span className="num">{built}</span> homes built
          </p>
        </div>
      </header>

      <div className="hud hud-clock">
        <Clock nextDueAt={snapshot.nextDueAt} tick={snapshot.tick} />
      </div>

      {props.server ? (
        <AccountBar client={props.client} site={props.server.site} me={me} onSession={setMe} onAdmitted={admitted} />
      ) : (
        <div className="hud hud-fixture hud-card" role="region" aria-label="Fixture mode">
          <span className="fixture-badge">Fixture village</span>
          <span className="fixture-note">Scripted local demo. No wallet or chain is connected.</span>
          <div className="viewer" role="radiogroup" aria-label="Viewing as">
            {([null, 'A', 'B', 'C'] as const).map((id) => (
              <button
                key={id ?? 'visitor'}
                type="button"
                role="radio"
                aria-checked={actor === id}
                className="viewer-option"
                onClick={() => switchActor(id)}
              >
                {id ? FIXTURE_ACTORS[id].label : 'Visitor'}
              </button>
            ))}
          </div>
          <button type="button" className="button button--quiet button--small" onClick={() => props.client.tick()}>
            Advance a tick
          </button>
        </div>
      )}

      {error ? (
        <p className="hud hud-alert" role="alert">
          {error}
        </p>
      ) : null}

      {webgl && !narrow ? (
        <p className="hud hud-hint" aria-hidden="true">
          Drag to look around · Scroll to zoom · Right-drag to pan · <kbd>[</kbd> <kbd>]</kbd> switch Chog
        </p>
      ) : null}

      <aside className={`hud panel hud-card${panelOpen ? '' : ' is-collapsed'}`} aria-label="Village journal">
        <div className="panel-bar">
          <div className="tabs" role="tablist" aria-label="Panels">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className="tab"
                onClick={() => {
                  setTab(t.id);
                  setPanelOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i = tabs.findIndex((x) => x.id === tab);
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
                  setTab(next.id);
                  document.getElementById(`tab-${next.id}`)?.focus();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={panelOpen}
            aria-controls={`panel-${tab}`}
            onClick={() => setPanelOpen((o) => !o)}
          >
            <span className="visually-hidden">{panelOpen ? 'Hide panel' : 'Show panel'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d={panelOpen ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} hidden={!panelOpen}>
          {tab === 'resident' && selected ? (
            <ResidentPanel
              agent={selected}
              world={world}
              isMine={mineKeys.has(selected.key)}
              holderName={props.server ? (address) => (address === me ? 'you' : 'a holder') : holderName}
              onSave={save}
              onDecorate={decorate}
              onAct={act}
              instructions={instructions}
              fixtureTools={fixtureTools}
              soul={
                props.server ? (
                  <ResidentSoul agentKey={selected.key} name={selected.name} isMine={mineKeys.has(selected.key)} onSessionLost={signedOut} />
                ) : undefined
              }
              look={lookOf(selected)}
              appearance={appearanceFor(selected)}
            />
          ) : null}
          {tab === 'resident' && !selected ? (
            <p className="feed-empty">No Chogs live here yet. Holders can sign in and bring in an awakened Chog.</p>
          ) : null}
          {tab === 'town' ? (
            <TownPanel
              world={world}
              myAddress={myAddress}
              canJoin={props.server ? Boolean(props.server.site.citizens) : true}
              signInHint={props.server ? 'Sign in with your wallet to join. No Chog NFT needed.' : 'Pick Holder A, Holder B or Citizen C above to play as someone.'}
              onJoin={join}
              onJob={setJob}
              onAct={act}
              myChogs={world.agents.filter((a) => mineKeys.has(a.key))}
              fixtureTools={fixture ? <TownFixtureTools client={fixture} /> : undefined}
            />
          ) : null}
          {tab === 'cult' && props.server ? <CultPanel address={me} onSessionLost={signedOut} /> : null}
          {tab === 'roster' ? (
            <>
              {rulers ? <CultRulers rulers={rulers} world={world} onOpen={() => setTab('cult')} /> : null}
              <PlaceList world={world} selectedKey={selected?.key ?? null} onSelect={select} mine={mineKeys} />
            </>
          ) : null}
          {tab === 'log' ? <ActivityFeed events={snapshot.recentEvents} world={world} /> : null}
        </div>
      </aside>
    </div>
  );
}
