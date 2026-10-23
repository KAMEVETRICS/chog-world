// Today's goals: a short list that always answers "what do I do next?". Derived from committed state and
// the recent event log, plus a few things only this browser knows (which panels the player opened).
// Nothing here changes the world; finishing goals is for the player's sake, not the ledger's.
import { PROJECT_IDS, type AgentState, type CitizenState, type CityEvent, type PublicChange, type WorldState } from '../../shared/contracts';
import { JOB_SITE, PROJECTS, VOTE_ACTIVE_DAYS } from '../../shared/rules';
import { canVote, citizenAsleep, dayOf } from '../../simulation/citizens';
import { placeName } from '../format';

/** Where a goal's "Show me" button takes the player. */
export type GoalTarget =
  | { kind: 'chog'; key: string; section?: 'market' | 'council'; anchor?: string }
  | { kind: 'town'; anchor: string }
  | { kind: 'log' }
  | { kind: 'join' };

export interface Goal {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  target: GoalTarget;
  /** Optional progress shown under the hint, e.g. working days towards a vote. */
  progress?: { value: number; max: number; label: string };
}

/** Things the player did in this browser that leave no trace in the world. */
export type Seen = 'met' | 'log' | 'checkin';

export interface GoalInput {
  world: WorldState;
  events: readonly CityEvent[];
  /** The player's villager, if they joined. */
  citizen: CitizenState | null;
  /** Chogs the player holds. */
  chogs: readonly AgentState[];
  /** Whether anyone is signed in (or, in the fixture, playing as someone). */
  signedIn: boolean;
  /** Client-only signals already recorded for this day (or, for visitors, ever). */
  seen: ReadonlySet<Seen>;
  /** Goal ids already completed earlier today; a finished goal stays finished. */
  doneBefore: ReadonlySet<string>;
}

export interface GoalList {
  /** 'first' for visitors' one-off first steps, otherwise today's village day. */
  scope: 'first' | number;
  title: string;
  goals: Goal[];
}

/** A day's list stays short: enough to guide, never a chore list. */
export const GOALS_PER_DAY = 3;

/** "a", "a or b", "a, b or c". */
const either = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

/** Every public change committed today, oldest first. */
function changesToday(events: readonly CityEvent[], day: number): PublicChange[] {
  return events.filter((e) => dayOf(e.data.tick) === day).flatMap((e) => e.data.changes);
}

export function goalsFor(input: GoalInput): GoalList {
  const { world, events, citizen, chogs, signedIn, seen, doneBefore } = input;
  const day = dayOf(world.tick);
  const today = changesToday(events, day);
  const finish = (goal: Omit<Goal, 'done'>, done: boolean): Goal => ({ ...goal, done: done || doneBefore.has(goal.id) });

  if (!citizen && chogs.length === 0) {
    return {
      scope: 'first',
      title: 'First steps',
      goals: [
        finish({ id: 'meet', title: 'Meet a Chog', hint: 'Click any Chog on the map to see what it is up to.', target: { kind: 'chog', key: world.agents[0]?.key ?? '' } }, seen.has('met')),
        finish({ id: 'log', title: 'Catch up on the news', hint: 'The village log tells you what everyone did today.', target: { kind: 'log' } }, seen.has('log')),
        finish(
          {
            id: 'join',
            title: 'Move in',
            hint: signedIn ? 'Make a villager and take a job. No Chog NFT needed.' : 'Sign in to make your own villager. No Chog NFT needed.',
            target: { kind: 'join' },
          },
          false,
        ),
      ],
    };
  }

  const goals: Goal[] = [];
  const myKeys = new Set([...(citizen ? [citizen.key] : []), ...chogs.map((c) => c.key)]);
  const open = world.proposals.filter((p) => p.status === 'open');

  if (chogs.length) {
    const first = chogs[0]!;
    goals.push(
      finish(
        {
          id: 'checkin',
          title: chogs.length === 1 ? `Check on ${first.name}` : 'Check on your Chogs',
          hint: 'See how it feels and what it is building.',
          target: { kind: 'chog', key: first.key },
        },
        seen.has('checkin'),
      ),
    );
  }

  if (citizen) {
    const site = citizen.job === 'off' ? null : JOB_SITE[citizen.job];
    const votesLeft = Math.max(0, VOTE_ACTIVE_DAYS - citizen.activeDays);
    const hint = !site
      ? 'Pick a job. Each shift pays coins and fills the city stores.'
      : citizenAsleep(citizen, world.tick)
        ? `Your villager is asleep. They head to ${placeName(world, site)} at dawn.`
        : `Your villager heads to ${placeName(world, site)} on the next hour.`;
    goals.push(
      finish(
        {
          id: 'work',
          title: 'Work a shift',
          hint,
          target: { kind: 'town', anchor: 'you-h' },
          ...(votesLeft > 0 ? { progress: { value: citizen.activeDays, max: VOTE_ACTIVE_DAYS, label: 'Days worked, to unlock voting' } } : {}),
        },
        citizen.lastWorkedDay === day,
      ),
    );
  }

  if (chogs.length) {
    const first = chogs[0]!;
    goals.push(
      finish(
        { id: 'trade', title: 'Trade at the market', hint: 'Sell spare wood, stone or food for coins, or buy what your Chog is short of.', target: { kind: 'chog', key: first.key, section: 'market', anchor: 'econ-h' } },
        today.some((c) => c.type === 'traded' && myKeys.has(c.agentKey)),
      ),
    );
    if (open.length) {
      goals.push(
        finish(
          { id: 'speak', title: 'Speak at the council', hint: `Tell the town where ${first.name} stands on "${open[0]!.title}".`, target: { kind: 'chog', key: first.key, section: 'council', anchor: 'council-h' } },
          today.some((c) => c.type === 'spoke' && c.by === 'holder' && myKeys.has(c.agentKey)),
        ),
      );
    }
  }

  const chipped = today.some((c) => c.type === 'contributed' && myKeys.has(c.from));
  const unbuilt = PROJECT_IDS.filter((id) => world.projects[id].completedTick === null).map((id) => `the ${PROJECTS[id].name}`);
  if (unbuilt.length && goals.length < GOALS_PER_DAY) {
    goals.push(
      finish({ id: 'chip', title: 'Chip in to a project', hint: `Every coin or plank brings ${either(unbuilt)} closer.`, target: { kind: 'town', anchor: 'projects-h' } }, chipped),
    );
  }

  if (citizen && goals.length < GOALS_PER_DAY) {
    if (canVote(citizen) && open.length) {
      goals.push(
        finish(
          { id: 'vote', title: 'Vote on a proposal', hint: `"${open[0]!.title}" closes soon. Your vote counts.`, target: { kind: 'town', anchor: 'votes-h' } },
          open.some((p) => p.votes[citizen.key] !== undefined),
        ),
      );
    } else {
      goals.push(
        finish(
          { id: 'gift', title: 'Be a good neighbour', hint: 'Give a coin to another villager or a Chog.', target: { kind: 'town', anchor: 'gift-h' } },
          today.some((c) => c.type === 'gift' && c.from === citizen.key),
        ),
      );
    }
  }

  return { scope: day, title: `Day ${day + 1} goals`, goals: goals.slice(0, GOALS_PER_DAY) };
}
