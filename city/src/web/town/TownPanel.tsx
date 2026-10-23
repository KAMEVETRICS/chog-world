// The Town tab: your villager (join Chog City, pick a job), City Hall (treasury and the constitution) and
// everyone living in Newcomers' Row. Renders committed state only.
import { useRef, useState } from 'react';
import { JOBS, PARAM_IDS, type CitizenState, type Job, type JobRequest, type JobResult, type JoinRequest, type JoinResult, type VillagerLook, type WorldState } from '../../shared/contracts';
import { CONSTITUTION, PROTECTED } from '../../shared/constitution';
import { appearanceOf } from '../../shared/looks';
import { AppearanceBadge } from '../world/Badge';
import { GATHER_SITES, JOB_SITE, TREASURY_CAP, VILLAGER_OPTIONS, VOTE_ACTIVE_DAYS, siteYield } from '../../shared/rules';
import { villagerNameSchema } from '../../shared/schemas';
import { canVote, citizenAsleep, villagerLookFor } from '../../simulation/citizens';
import { JOB_LABEL, RESOURCE_LABEL, placeName } from '../format';
import { ActionStatus, GiftForm, useAct, type OnAct } from '../economy/actions';
import { Projects } from '../economy/Projects';
import { Votes } from '../economy/Votes';
import { growthOf, GROWTH_RULES, RANKS } from './rank';
import './growth.css';
import type { AgentState } from '../../shared/contracts';

const LOOK_LABEL: Record<keyof VillagerLook, string> = { Skin: 'Fur', Head: 'Hat', Body: 'Outfit', Eyes: 'Eyes' };

const JOIN_ERRORS: Record<Exclude<JoinResult, { ok: true }>['code'], string> = {
  LOGIN_REQUIRED: 'Sign in first.',
  DISTRICT_FULL: "Newcomers' Row is full. New lots open as the city grows.",
  IDEMPOTENCY_CONFLICT: 'That request collided with an earlier one. Please try again.',
};

const JOB_ERRORS: Record<Exclude<JobResult, { ok: true }>['code'], string> = {
  LOGIN_REQUIRED: 'Sign in first.',
  NOT_A_CITIZEN: 'Join the city first.',
  JOB_CHANGED: 'Your job changed somewhere else first. Pick again.',
  IDEMPOTENCY_CONFLICT: 'That request collided with an earlier one. Please try again.',
};

/** A small drawing of a villager in its chosen colours. */
export function VillagerBadge({ look, size = 56 }: { look: VillagerLook; size?: number }) {
  return <AppearanceBadge appearance={appearanceOf(look)} size={size} label="Villager" />;
}

function statusOf(citizen: CitizenState, world: WorldState): string {
  if (citizenAsleep(citizen, world.tick)) return 'Asleep at home';
  if (citizen.location.kind === 'place') return `${JOB_LABEL[citizen.job]} at ${placeName(world, citizen.location.placeId)}`;
  return citizen.job === 'off' ? 'Taking the day off at home' : 'At home';
}

function JoinForm({ address, onJoin }: { address: string; onJoin: (request: JoinRequest, key: string) => Promise<JoinResult> }) {
  const [name, setName] = useState('');
  const [look, setLook] = useState<VillagerLook>(() => villagerLookFor(address));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const parsed = villagerNameSchema.safeParse(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.success) return;
    attempt.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const result = await onJoin({ name: parsed.data, look }, attempt.current);
      attempt.current = null;
      if (!result.ok) setError(JOIN_ERRORS[result.code]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="join" onSubmit={(e) => void submit(e)} aria-label="Join Chog City">
      <p className="readonly-note">No Chog NFT needed. Your villager gets a home in Newcomers' Row and works for the city.</p>
      <div className="join-row">
        <VillagerBadge look={look} size={72} />
        <label className="join-name">
          <span className="setting-label">Name</span>
          <input
            className="text-input"
            value={name}
            maxLength={20}
            onChange={(e) => {
              attempt.current = null;
              setName(e.target.value);
            }}
            aria-invalid={name.length > 0 && !parsed.success}
            aria-describedby="join-name-hint"
          />
          <span id="join-name-hint" className="setting-hint">2–20 letters, starting with a letter.</span>
        </label>
      </div>
      <div className="look-grid">
        {(Object.keys(VILLAGER_OPTIONS) as Array<keyof VillagerLook>).map((part) => (
          <label key={part} className="look-pick">
            <span className="setting-label">{LOOK_LABEL[part]}</span>
            <select
              className="select-input"
              value={look[part]}
              onChange={(e) => {
                attempt.current = null;
                setLook((l) => ({ ...l, [part]: e.target.value }));
              }}
            >
              {VILLAGER_OPTIONS[part].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="settings-actions">
        <button type="submit" className="button button--primary" disabled={!parsed.success || busy}>
          {busy ? 'Moving in…' : 'Join Chog City'}
        </button>
        <span className="settings-status decor-status--error" role="status" aria-live="polite">
          {error ?? ''}
        </span>
      </div>
    </form>
  );
}

/** Chogs hiring right now, and whether this villager already works for one. */
function JobOffers({ citizen, world, onAct }: { citizen: CitizenState; world: WorldState; onAct: OnAct }) {
  const { busy, status, run } = useAct(onAct);
  const employer = citizen.employer ? world.agents.find((a) => a.key === citizen.employer) : null;
  const open = world.agents.filter((a) => a.offer && a.control.kind === 'controlled' && !world.citizens.some((c) => c.employer === a.key && c.key !== citizen.key));
  return (
    <div className="offers">
      <span className="setting-label">Work for a Chog</span>
      {employer ? <p className="readonly-note">You work for {employer.name}. Picking a job above goes back to working for the city.</p> : null}
      {open.length ? (
        <ul className="villagers" aria-label="Job offers">
          {open.map((a) => (
            <li key={a.key} className="offer-row">
              <span className="villager-row-name">{a.name}</span>
              <span className="villager-row-status">
                {JOB_LABEL[a.offer!.job]} · {a.offer!.wage} coins an hour
              </span>
              {citizen.employer === a.key ? (
                <span className="tag tag--mine">Your job</span>
              ) : (
                <button type="button" className="button button--quiet button--small" disabled={busy} onClick={() => void run({ type: 'take_offer', employer: a.key }, `You now work for ${a.name}.`)}>
                  Take job
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="setting-hint">No Chog is hiring right now.</p>
      )}
      <ActionStatus status={status} />
    </div>
  );
}

function MyVillager({ citizen, world, onJob, onAct }: { citizen: CitizenState; world: WorldState; onJob: (request: JobRequest, key: string) => Promise<JobResult>; onAct: OnAct }) {
  const [busy, setBusy] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { values } = world.params;
  const daysLeft = Math.max(0, VOTE_ACTIVE_DAYS - citizen.activeDays);

  const choose = async (job: Job) => {
    if (job === citizen.job && !citizen.employer) return;
    setBusy(job);
    setError(null);
    try {
      const result = await onJob({ expectedVersion: citizen.jobVersion, job }, crypto.randomUUID());
      if (!result.ok) setError(JOB_ERRORS[result.code]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="villager">
      <div className="join-row">
        <VillagerBadge look={citizen.look} size={72} />
        <div>
          <h3 className="villager-name">{citizen.name}</h3>
          <p className="resident-meta">
            <span>Lot {citizen.lotId.slice(1)}</span> · <span>{statusOf(citizen, world)}</span>
          </p>
          <p className="villager-coins">
            <span className="num">{citizen.coins}</span> coins
          </p>
        </div>
      </div>
      <p className={`tag ${canVote(citizen) ? 'tag--mine' : ''}`}>
        {canVote(citizen) ? 'Can vote' : `Votes after ${daysLeft} more working ${daysLeft === 1 ? 'day' : 'days'}`}
      </p>
      <div className="setting" role="radiogroup" aria-label="Job">
        <span className="setting-label">Job</span>
        <div className="choice-row">
          {JOBS.map((job) => {
            const site = job === 'off' ? null : JOB_SITE[job];
            return (
              <label key={job} className={`choice${citizen.job === job && !citizen.employer ? ' is-checked' : ''}`}>
                <input type="radio" name="job" value={job} checked={citizen.job === job && !citizen.employer} disabled={busy !== null} onChange={() => void choose(job)} />
                <span className="choice-title">{JOB_LABEL[job]}</span>
                <span className="choice-hint">
                  {site ? `${siteYield(site, values)} ${RESOURCE_LABEL[GATHER_SITES[site]!.output].toLowerCase()} for the city · ${values.wage} coins` : 'Stay home'}
                </span>
              </label>
            );
          })}
        </div>
        <span className="setting-hint">A new job starts within the hour. Work pays only while the city's stores have room.</span>
      </div>
      <p className="settings-status decor-status--error" role="status" aria-live="polite">
        {error ?? ''}
      </p>
      <JobOffers citizen={citizen} world={world} onAct={onAct} />
      <span id="gift-h" className="setting-label">
        Give coins
      </span>
      <GiftForm world={world} from={{ kind: 'citizen' }} fromKey={citizen.key} canGiveMaterials={false} onAct={onAct} />
    </div>
  );
}

/** Where the village stands on the road from Hamlet to City, and what grows it. */
function VillageGrowth({ world }: { world: WorldState }) {
  const g = growthOf(world);
  return (
    <div className="growth">
      <ol className="growth-ranks" aria-label="Village ranks">
        {RANKS.map((r, i) => (
          <li
            key={r.name}
            className={r === g.rank ? 'is-current' : g.points >= r.from ? 'is-past' : undefined}
            style={{ left: `${(i / (RANKS.length - 1)) * 100}%` }}
          >
            {r.name}
          </li>
        ))}
      </ol>
      <span className="growth-bar" role="img" aria-label={g.next ? `${g.points} of ${g.next.from} growth to become a ${g.next.name}` : 'Fully grown'}>
        <span style={{ width: `${Math.round(g.journey * 100)}%` }} />
        {RANKS.slice(1, -1).map((r, i) => (
          <i key={r.name} className="growth-tick" style={{ left: `${((i + 1) / (RANKS.length - 1)) * 100}%` }} />
        ))}
      </span>
      <p className="setting-hint">
        {g.next ? (
          <>
            <strong>{g.next.from - g.points} more growth</strong> to become a {g.next.name}.{' '}
          </>
        ) : (
          'A full city: the village has grown as far as it goes. '
        )}
        Every home level built adds {GROWTH_RULES.homeLevel}, every villager who moves in adds {GROWTH_RULES.villager}, and every shared project adds{' '}
        {GROWTH_RULES.project}. The town makes room as people arrive: when the main island fills, a new district rises across a footbridge.
      </p>
    </div>
  );
}

function CityHall({ world }: { world: WorldState }) {
  const { treasury, params } = world;
  return (
    <>
      <p className="setting-hint">City Hall runs the Plaza market from these stores.</p>
      <dl className="treasury">
        <div>
          <dt>Treasury</dt>
          <dd className="num">{treasury.coins} coins</dd>
        </div>
        {(['wood', 'stone', 'food'] as const).map((r) => (
          <div key={r}>
            <dt>{RESOURCE_LABEL[r]}</dt>
            <dd className="num">
              {treasury.stores[r]}
              <span className="store-cap">/{TREASURY_CAP}</span>
            </dd>
          </div>
        ))}
      </dl>
      <table className="constitution">
        <caption>
          City rules <span className="section-aside">Version {params.version}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Now</th>
            <th scope="col">Allowed</th>
            <th scope="col">Per vote</th>
          </tr>
        </thead>
        <tbody>
          {PARAM_IDS.map((id) => {
            const rule = CONSTITUTION[id];
            return (
              <tr key={id}>
                <th scope="row" title={rule.meaning}>
                  {rule.label}
                </th>
                <td className="num">
                  {params.values[id]} {rule.unit}
                </td>
                <td className="num">
                  {rule.min}–{rule.max}
                </td>
                <td className="num">±{rule.maxStep}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="setting-hint">Votes can change only these numbers, within these limits. No vote can ever change:</p>
      <ul className="protected">
        {PROTECTED.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

export function TownPanel({
  world,
  myAddress,
  canJoin,
  signInHint,
  onJoin,
  onJob,
  onAct,
  myChogs,
  fixtureTools,
}: {
  world: WorldState;
  /** The signed-in player's address, or null for a visitor. */
  myAddress: string | null;
  /** False when this server doesn't take citizens yet. */
  canJoin: boolean;
  signInHint: string;
  onJoin: (request: JoinRequest, key: string) => Promise<JoinResult>;
  onJob: (request: JobRequest, key: string) => Promise<JobResult>;
  onAct: OnAct;
  /** Chogs the signed-in player holds, who can chip in to projects. */
  myChogs: AgentState[];
  fixtureTools?: React.ReactNode;
}) {
  const mine = myAddress ? world.citizens.find((c) => c.address === myAddress.toLowerCase()) ?? null : null;
  return (
    <article className="town" aria-label="Town">
      <section className="panel-section" aria-labelledby="you-h">
        <h3 id="you-h" className="section-title">
          Your villager
        </h3>
        {mine ? (
          <MyVillager citizen={mine} world={world} onJob={onJob} onAct={onAct} />
        ) : !canJoin ? (
          <p className="readonly-note">Villagers are coming to this server soon.</p>
        ) : myAddress ? (
          <JoinForm key={myAddress} address={myAddress} onJoin={onJoin} />
        ) : (
          <p className="readonly-note">{signInHint}</p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="grow-h">
        <h3 id="grow-h" className="section-title">
          Our village
        </h3>
        <VillageGrowth world={world} />
      </section>

      <section className="panel-section" aria-labelledby="hall-h">
        <h3 id="hall-h" className="section-title">
          City Hall
        </h3>
        <CityHall world={world} />
        {fixtureTools}
      </section>

      <section className="panel-section" aria-labelledby="votes-h">
        <h3 id="votes-h" className="section-title">
          Votes
        </h3>
        <Votes world={world} me={mine} onAct={onAct} />
      </section>

      <section className="panel-section" aria-labelledby="projects-h">
        <h3 id="projects-h" className="section-title">
          Shared projects
        </h3>
        <Projects world={world} villagerName={mine?.name ?? null} myChogs={myChogs} onAct={onAct} />
      </section>

      <section className="panel-section" aria-labelledby="row-h">
        <h3 id="row-h" className="section-title">
          Newcomers' Row <span className="section-aside">{world.citizens.length}/{world.lots.length} lots</span>
        </h3>
        {world.citizens.length ? (
          <ul className="villagers" aria-label="Villagers">
            {world.citizens.map((c) => (
              <li key={c.key} className="villager-row">
                <VillagerBadge look={c.look} size={34} />
                <span className="villager-row-name">{c.name}</span>
                <span className="villager-row-status">{statusOf(c, world)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="readonly-note">Nobody has moved in yet.</p>
        )}
      </section>
    </article>
  );
}
