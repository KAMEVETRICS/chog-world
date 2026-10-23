import { useCallback, useEffect, useRef, useState } from 'react';
import { FACTIONS, PHASES, PLACES, SWITCH_COOLDOWN_CYCLES, decreeById, decreesFor, type FactionId, type Place, type Stance } from '../../../../cult/src/rules';
import { CityApiError } from '../api/http-client';
import { cultApi, type CultEvent, type CultSnapshot, type MyCultChog } from './api';
import { FACTION_NAME } from './rulers';
import { useCult } from './state';
import './cult.css';

const PLACES_TEXT: Record<Place, string> = { plaza: 'Plaza', tavern: 'Tavern', workshop: 'Workshop' };
const PHASE_TEXT = { propose: 'Propose', debate: 'Debate', vote: 'Vote', resolve: 'Resolve' };
const explain = (error: unknown) => error instanceof Error ? error.message : 'That did not go through. Please try again.';
type Status = { tone: 'ok' | 'error'; text: string } | null;

function Cycle({ snapshot, connection }: { snapshot: CultSnapshot; connection: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil((Date.parse(snapshot.nextBoundaryAt) - now) / 1000));
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  return <section className="cult-cycle" aria-label="Cult cycle">
    <div className="cult-cycle-title"><span className="tag">Cycle {snapshot.cycle}</span><span className="cult-connection" role="status">{connection}</span></div>
    <ol className="cult-phases">{PHASES.map(phase => <li key={phase} aria-current={snapshot.phase === phase ? 'step' : undefined}>{PHASE_TEXT[phase]}</li>)}</ol>
    <p className="setting-hint">{PHASE_TEXT[snapshot.phase]} ends in <strong className="num">{time}</strong></p>
  </section>;
}

export function CultPanel({ address, onSessionLost }: { address: string | null; onSessionLost: () => void }) {
  const { snapshot, feed, connection, error, refresh } = useCult();
  const [owned, setOwned] = useState<{ address: string | null; chogs: MyCultChog[] }>({ address: null, chogs: [] });
  const currentAddress = useRef(address);
  currentAddress.current = address;
  const mine = owned.address === address ? owned.chogs : [];
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const revision = snapshot?.revision;
  const loadMine = useCallback(async () => {
    if (!address) { setOwned({ address: null, chogs: [] }); return; }
    const next = await cultApi.mine();
    if (currentAddress.current !== address) return;
    if (next === null) { setOwned({ address, chogs: [] }); onSessionLost(); return; }
    setOwned({ address, chogs: next });
  }, [address, onSessionLost]);
  useEffect(() => { void loadMine().catch(cause => setStatus({ tone: 'error', text: explain(cause) })); }, [loadMine, revision]);
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setStatus(null);
    try { await work(); setStatus({ tone: 'ok', text }); }
    catch (cause) {
      setStatus({ tone: 'error', text: explain(cause) });
      if (cause instanceof CityApiError && ['LOGIN_REQUIRED', 'CSRF_FAILED'].includes(cause.code)) onSessionLost();
    } finally {
      await Promise.all([loadMine(), refresh()]).catch(cause => setStatus({ tone: 'error', text: explain(cause) }));
      setBusy(false);
    }
  };
  const chog = mine.find(entry => entry.agentKey === selected) ?? mine[0];
  return <div className="cult-panel">
    <header><h2 className="panel-title">Chog Cult</h2><p className="section-intro">The Crown and the Chaos compete for the places your Chogs visit.</p></header>
    {error ? <p className="action-status action-status--error" role="alert">{error} Showing the last available state.</p> : null}
    {!snapshot ? <p role="status">Opening the Cult…</p> : <>
      <Cycle snapshot={snapshot} connection={connection} />
      <section aria-labelledby="cult-places-h"><h3 id="cult-places-h" className="section-title">Who rules</h3>
        <div className="cult-places">{snapshot.places.map(place => <article className={`cult-place ruler--${place.ruler ?? 'neutral'}`} key={place.place}>
          <div className="cult-card-heading"><h4>{PLACES_TEXT[place.place]}</h4><span className={`tag ruler--${place.ruler ?? 'neutral'}`}>{place.ruler ? FACTION_NAME[place.ruler] : 'Neutral'}</span></div>
          <p>{place.decree ? <><strong>{place.decree.title}</strong> · {place.decree.feedLine}</> : 'No decree in force.'}</p>
          {place.sinceCycle !== null ? <p className="setting-hint">Since cycle {place.sinceCycle}</p> : null}
          {snapshot.phase === 'vote' || snapshot.phase === 'resolve' ? <p className="setting-hint">{FACTIONS.map(faction => `${FACTION_NAME[faction]} ${snapshot.members.filter(member => member.faction === faction && member.currentVotes.some(vote => vote.place === place.place && vote.decreeId)).length}`).join(' · ')} votes</p> : null}
        </article>)}</div>
      </section>
      <section aria-labelledby="cult-factions-h"><h3 id="cult-factions-h" className="section-title">Factions</h3>
        <div className="cult-factions">{snapshot.factions.map(faction => <article key={faction.id} className={`cult-faction ruler--${faction.id}`}>
          <h4>{faction.name}</h4><p>{faction.creed}</p><dl className="cult-stats"><div><dt>Members</dt><dd>{faction.members}</dd></div><div><dt>Places</dt><dd>{faction.placesRuled.length}</dd></div><div><dt>Glory</dt><dd>{faction.glory}</dd></div></dl>
        </article>)}</div>
      </section>
      <section aria-labelledby="cult-mine-h"><h3 id="cult-mine-h" className="section-title">Your Chogs</h3>
        {!address ? <p className="setting-hint">Sign in with your wallet above to choose your Chog's faction and votes.</p> : !chog ? <p className="setting-hint">Your wallet has no Chogs in the Cult yet. Awaken one in <a href="/soul/">Chog Soul</a>, then join the world.</p> : <>
          {mine.length > 1 ? <label className="look-pick"><span className="setting-label">Chog</span><select value={chog.agentKey} onChange={event => setSelected(event.target.value)}>{mine.map(entry => <option key={entry.agentKey} value={entry.agentKey}>{entry.name}</option>)}</select></label> : null}
          <MemberSettings key={`${chog.agentKey}:${chog.ownershipEpoch}`} chog={chog} snapshot={snapshot} busy={busy} run={run} />
        </>}
        {status ? <p className={`action-status action-status--${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>{status.text}</p> : null}
      </section>
      <details className="cult-members"><summary>Chogs in the Cult ({snapshot.members.length})</summary>
        {snapshot.members.length === 0 ? <p className="setting-hint">No Chogs have joined yet.</p> : <ul>{snapshot.members.map(member => <li key={member.agentKey}><strong>{member.name}</strong><span>{member.faction ? FACTION_NAME[member.faction] : 'Unaligned'} · {member.stance === 'persona' ? 'Agent votes' : 'Abstains'} · {member.reputation.glory} glory · {member.reputation.loyalty} loyalty</span></li>)}</ul>}
      </details>
      <section aria-labelledby="cult-feed-h"><h3 id="cult-feed-h" className="section-title">Cult activity</h3>
        {feed.length ? <ol className="cult-feed">{[...feed].reverse().map(event => <li key={event.revision}><span className="cult-event-meta">Cycle {event.cycle} · {event.type === 'debate' ? (event.payload as { scripted?: boolean })?.scripted === false ? 'AI debate' : 'Debate' : event.type.replaceAll('_', ' ')}</span><p>{eventLine(event, snapshot)}</p></li>)}</ol> : <p className="setting-hint">The Cult's story will appear here.</p>}
      </section>
    </>}
  </div>;
}

function MemberSettings({ chog, snapshot, busy, run }: { chog: MyCultChog; snapshot: CultSnapshot; busy: boolean; run: (work: () => Promise<unknown>, text: string) => Promise<void> }) {
  const [faction, setFaction] = useState<FactionId | ''>(chog.faction ?? '');
  const [stance, setStance] = useState<Stance>(chog.faction ? chog.stance : 'persona');
  const changingFaction = (faction || null) !== chog.faction;
  const eligible = chog.faction && chog.joinedCycle !== null && chog.joinedCycle < snapshot.cycle && chog.control === 'verified';
  const member = snapshot.members.find(entry => entry.agentKey === chog.agentKey);
  return <div className="cult-settings">
    <h4>{chog.name}</h4>
    <form aria-label="Faction settings" onSubmit={event => { event.preventDefault(); void run(() => cultApi.membership(chog, { ...(changingFaction ? { faction: faction || null } : {}), ...(faction ? { stance } : {}) }), 'Faction settings saved.'); }}>
      <label className="look-pick"><span className="setting-label">Faction</span><select value={faction} onChange={event => setFaction(event.target.value as FactionId | '')}><option value="">Unaligned</option>{FACTIONS.map(id => <option key={id} value={id}>{FACTION_NAME[id]}</option>)}</select></label>
      {faction ? <fieldset className="cult-stance"><legend className="setting-label">How it votes</legend>
        <label><input type="radio" name={`stance-${chog.agentKey}`} checked={stance === 'persona'} onChange={() => setStance('persona')} /> Let its agent vote from its traits</label>
        <label><input type="radio" name={`stance-${chog.agentKey}`} checked={stance === 'abstain'} onChange={() => setStance('abstain')} /> Abstain unless I choose</label>
      </fieldset> : null}
      {changingFaction ? <p className="setting-hint">A new faction starts a {SWITCH_COOLDOWN_CYCLES}-cycle switch cooldown. Voting starts next cycle.</p> : null}
      <button type="submit" className="button button--primary button--small" disabled={busy || (!changingFaction && (!faction || stance === chog.stance))}>Save faction settings</button>
    </form>
    {chog.faction ? <fieldset className="cult-votes"><legend className="setting-label">This cycle's votes</legend>
      {!eligible ? <p className="setting-hint">{chog.control !== 'verified' ? "Ownership can't be checked right now." : 'This Chog votes from the cycle after it joined.'}</p> : snapshot.phase !== 'vote' ? <p className="setting-hint">You can choose decrees during the Vote phase.</p> : PLACES.map(place => <VoteChoice key={`${snapshot.cycle}:${place}:${member?.currentVotes.find(vote => vote.place === place)?.decreeId ?? ''}`} chog={chog} snapshot={snapshot} place={place} current={member?.currentVotes.find(vote => vote.place === place)} busy={busy} run={run} />)}
    </fieldset> : null}
  </div>;
}

function VoteChoice({ chog, snapshot, place, current, busy, run }: { chog: MyCultChog; snapshot: CultSnapshot; place: Place; current?: { decreeId: string | null; source: string }; busy: boolean; run: (work: () => Promise<unknown>, text: string) => Promise<void> }) {
  const [choice, setChoice] = useState(current?.decreeId ?? '');
  return <div className="cult-vote">
    <label className="look-pick"><span className="setting-label">{PLACES_TEXT[place]} decree</span><select value={choice} onChange={event => setChoice(event.target.value)}><option value="">Abstain</option>{decreesFor(chog.faction!, place).map(decree => <option key={decree.id} value={decree.id}>{decree.title}</option>)}</select></label>
    <button className="button button--quiet button--small" type="button" disabled={busy || choice === (current?.decreeId ?? '')} onClick={() => void run(() => cultApi.vote(chog, snapshot.cycle, place, choice || null), `${PLACES_TEXT[place]} vote saved.`)}>Vote for {PLACES_TEXT[place]}</button>
    {current ? <p className="setting-hint">Current: {current.decreeId ? decreeById(current.decreeId)?.title ?? current.decreeId : 'Abstain'} · {current.source === 'holder' ? 'your choice' : 'agent choice'}</p> : null}
  </div>;
}

function eventLine(event: CultEvent, snapshot: CultSnapshot): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const name = snapshot.members.find(member => member.agentKey === payload.agentKey)?.name ?? 'A Chog';
  switch (event.type) {
    case 'debate': return String(payload.text ?? '');
    case 'phase_changed': return `${PHASE_TEXT[payload.phase as keyof typeof PHASE_TEXT] ?? payload.phase} begins.`;
    case 'votes_cast': return `Agents cast ${payload.votes} votes.`;
    case 'override': return `${name}'s holder chose ${payload.decreeId ? decreeById(String(payload.decreeId))?.title ?? payload.decreeId : 'Abstain'} for the ${PLACES_TEXT[payload.place as Place]}.`;
    case 'member_changed': return `${name} now stands ${payload.faction ? `with ${FACTION_NAME[payload.faction as FactionId]}` : 'unaligned'}.`;
    case 'control_changed': return payload.status === 'unavailable' ? `Ownership of ${name} cannot be checked; its vote waits.` : `${name}'s ownership was updated.`;
    case 'place_control_changed': { const control = payload.control as { faction: FactionId; decreeId: string } | null; return control ? `${FACTION_NAME[control.faction]} takes the ${PLACES_TEXT[payload.place as Place]}: ${decreeById(control.decreeId)?.feedLine ?? control.decreeId}` : `The ${PLACES_TEXT[payload.place as Place]} is neutral.`; }
    case 'cycle_resolved': return `Cycle ${payload.cycle} resolved.`;
    case 'city_gap': return 'The village could not be reached; presence counts zero this cycle.';
    case 'city_late': return 'Older village ticks were skipped for this cycle.';
    case 'schedule_gap': return 'The Cult resumed after time offline.';
    default: return 'The Cult moved on.';
  }
}
