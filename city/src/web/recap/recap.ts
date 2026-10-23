// "While you were away": what changed for you and the town since this browser last looked.
// Built from a light snapshot of the world taken while the page was open, compared with the world now,
// plus the council's own records (speeches and results carry their tick). No event history is needed,
// so a recap after a week is as accurate as one after an hour. Nothing here changes the world.
import { DECOR_IDS, PARAM_IDS, PROJECT_IDS, type AgentState, type CitizenState, type DecorId, type HomeStyle, type Params, type ProjectId, type WorldState } from '../../shared/contracts';
import { CONSTITUTION } from '../../shared/constitution';
import { DECOR, PROJECTS } from '../../shared/rules';
import { canVote, dayOf } from '../../simulation/citizens';
import { moodOf } from '../../simulation/needs';
import { homeName } from '../format';
import { newlyEarned } from '../resident/titles';
import { growthOf } from '../town/rank';
import { projectProgress } from '../world3d/Projects3D';

/** Away less than this many ticks (a little over a village hour each) is just a glance away. */
export const RECAP_AFTER_TICKS = 12;

export interface Seen {
  tick: string;
  chogs: Record<string, { name: string; homeLevel: number; coins: number; decor: DecorId[] }>;
  citizen: { key: string; coins: number; activeDays: number; canVote: boolean } | null;
  projects: Record<ProjectId, { progress: number; built: boolean }>;
  params: Params;
  citizens: number;
  /** The village's rank then (absent in snapshots from before ranks existed). */
  rank?: string;
}

export interface ChogStory {
  key: string;
  name: string;
  lines: string[];
  /** How it feels now, in a word. */
  mood: string;
}

export interface Recap {
  /** Village days that passed, at least 0. */
  days: number;
  hours: number;
  chogs: ChogStory[];
  /** Lines about the reader's own villager, and which villager that is. */
  villager: string[];
  villagerKey: string | null;
  /** Town news: projects, laws and newcomers. */
  town: string[];
}

/** What to remember about the world for the next recap. */
export function capture(world: WorldState, chogs: readonly AgentState[], citizen: CitizenState | null): Seen {
  return {
    tick: world.tick,
    chogs: Object.fromEntries(chogs.map((a) => [a.key, { name: a.name, homeLevel: a.homeLevel, coins: a.coins, decor: [...a.decor] }])),
    citizen: citizen ? { key: citizen.key, coins: citizen.coins, activeDays: citizen.activeDays, canVote: canVote(citizen) } : null,
    projects: Object.fromEntries(PROJECT_IDS.map((id) => [id, { progress: projectProgress(world, id), built: world.projects[id].completedTick !== null }])) as Seen['projects'],
    params: { ...world.params.values },
    citizens: world.citizens.length,
    rank: growthOf(world).rank.name,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const coinsLine = (delta: number, now: number) =>
  delta > 0 ? `Earned ${plural(delta, 'coin')}, now ${plural(now, 'coin')}.` : `Spent ${plural(-delta, 'coin')}, now ${plural(now, 'coin')}.`;
/** A speech, cut at a word boundary to fit one line of the recap. */
const quote = (text: string, max = 90) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max)).replace(/[,;:.]$/, '')}…`);
const homeTitle = (level: number, style: HomeStyle) => `a ${homeName(style, level)} (level ${level})`;

/** The recap since `seen`, or null when too little time passed or nothing worth telling happened. */
export function recapOf(seen: Seen, world: WorldState, chogs: readonly AgentState[], citizen: CitizenState | null): Recap | null {
  const elapsed = Number(BigInt(world.tick) - BigInt(seen.tick));
  if (elapsed < RECAP_AFTER_TICKS) return null;
  const since = BigInt(seen.tick);
  const after = (tick: string | null) => tick !== null && BigInt(tick) > since;
  const name = (key: string) => world.agents.find((a) => a.key === key)?.name ?? 'A Chog';

  // Your Chogs.
  const stories: ChogStory[] = [];
  for (const agent of chogs) {
    const before = seen.chogs[agent.key];
    const lines: string[] = [];
    if (!before) lines.push('Moved in to the village.');
    if (before && agent.homeLevel > before.homeLevel) lines.push(`Finished ${homeTitle(agent.homeLevel, agent.homeStyle)}.`);
    if (before) for (const m of newlyEarned(before, agent)) lines.push(`Earned the title ${m.title}.`);
    if (agent.construction) lines.push(`Is building its ${homeName(agent.policy.homeStyle, agent.construction.targetLevel)} right now.`);
    if (before && agent.coins !== before.coins) lines.push(coinsLine(agent.coins - before.coins, agent.coins));
    const added = DECOR_IDS.filter((d) => agent.decor.includes(d) && !before?.decor.includes(d));
    if (before && added.length) lines.push(`Got ${added.map((d) => `a ${DECOR[d].name.toLowerCase()}`).join(' and ')} for the garden.`);
    const proposed = world.proposals.filter((p) => p.proposer === agent.key && after(p.openedTick));
    for (const p of proposed) lines.push(`Proposed "${p.title}" at the council.`);
    const speeches = world.proposals.flatMap((p) => p.speeches.filter((s) => s.agentKey === agent.key && after(s.tick)).map((s) => ({ p, s })));
    if (speeches.length) {
      const first = speeches[0]!;
      lines.push(
        speeches.length === 1
          ? `Spoke ${first.s.stance} "${first.p.title}": “${quote(first.s.text)}”`
          : `Spoke ${speeches.length} times at the council, ${first.s.stance} "${first.p.title}" among others.`,
      );
    }
    if (lines.length) stories.push({ key: agent.key, name: agent.name, lines, mood: moodOf(agent).kind });
  }
  for (const [key, before] of Object.entries(seen.chogs)) {
    if (!chogs.some((a) => a.key === key)) stories.push({ key, name: before.name, lines: ['Changed hands. It now belongs to its new holder.'], mood: '' });
  }

  // Your villager.
  const villager: string[] = [];
  if (citizen && seen.citizen?.key === citizen.key) {
    const worked = citizen.activeDays - seen.citizen.activeDays;
    if (worked > 0) villager.push(`Worked on ${plural(worked, 'day')}.`);
    if (citizen.coins !== seen.citizen.coins) villager.push(coinsLine(citizen.coins - seen.citizen.coins, citizen.coins));
    if (!seen.citizen.canVote && canVote(citizen)) villager.push('You can vote now. Your voice counts at the next proposal.');
  }

  // The town.
  const town: string[] = [];
  const rank = growthOf(world).rank.name;
  if (seen.rank && rank !== seen.rank) town.push(`The ${seen.rank.toLowerCase()} grew into a ${rank.toLowerCase()}!`);
  for (const id of PROJECT_IDS) {
    const was = seen.projects[id];
    const built = world.projects[id].completedTick !== null;
    const progress = projectProgress(world, id);
    if (built && !was?.built) town.push(`The ${PROJECTS[id].name} was built.`);
    else if (!built && was && progress > was.progress) town.push(`The ${PROJECTS[id].name} is ${Math.round(progress * 100)}% funded.`);
  }
  for (const p of world.proposals) {
    if (!after(p.resolvedTick)) continue;
    const by = name(p.proposer);
    if (p.status === 'passed') town.push(`Passed: "${p.title}" (proposed by ${by}).`);
    else if (p.status === 'rejected') town.push(`Voted down: "${p.title}".`);
    else if (p.status === 'failed') town.push(`"${p.title}" passed but couldn't be carried out.`);
  }
  const changed = PARAM_IDS.filter((id) => world.params.values[id] !== seen.params[id]);
  if (changed.length && !world.proposals.some((p) => p.status === 'passed' && after(p.resolvedTick))) {
    town.push(`New rules: ${changed.map((id) => `${CONSTITUTION[id].label.toLowerCase()} is now ${world.params.values[id]} ${CONSTITUTION[id].unit}`).join(', ')}.`);
  }
  const arrived = world.citizens.length - seen.citizens;
  if (arrived > 0) town.push(`${plural(arrived, 'new villager')} moved in.`);
  const news = stories.length + villager.length + town.length;
  const open = world.proposals.filter((p) => p.status === 'open');
  // An open vote is a reason to act, not news on its own: it rides along with a recap, never starts one.
  if (open.length && news) town.push(`Open for votes: "${open[0]!.title}"${open.length > 1 ? ` and ${plural(open.length - 1, 'other')}` : ''}.`);

  if (!news) return null;
  return { days: dayOf(world.tick) - dayOf(seen.tick), hours: elapsed, chogs: stories, villager, villagerKey: citizen?.key ?? null, town };
}
