// The goals card: three things to do now, each with a button that takes you there.
import { useEffect, useRef, useState } from 'react';
import type { Goal, GoalList } from './goals';
import { play } from '../fx/sound';

function Check({ done }: { done: boolean }) {
  return (
    <span className={`goal-check${done ? ' is-done' : ''}`} aria-hidden="true">
      {done ? (
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.4 L6.6 11.3 L12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

function GoalRow({ goal, fresh, onShow }: { goal: Goal; fresh: boolean; onShow: () => void }) {
  return (
    <li className={`goal${goal.done ? ' is-done' : ''}${fresh ? ' is-fresh' : ''}`}>
      <Check done={goal.done} />
      <div className="goal-body">
        <p className="goal-title">
          {goal.title}
          <span className="visually-hidden">{goal.done ? ' (done)' : ' (to do)'}</span>
        </p>
        {!goal.done ? <p className="goal-hint">{goal.hint}</p> : null}
        {!goal.done && goal.progress ? (
          <p className="goal-progress">
            <span>{goal.progress.label}</span>
            <span className="goal-progress-bar" role="img" aria-label={`${goal.progress.value} of ${goal.progress.max}`}>
              <span style={{ width: `${(100 * goal.progress.value) / goal.progress.max}%` }} />
            </span>
            <span className="num">
              {goal.progress.value}/{goal.progress.max}
            </span>
          </p>
        ) : null}
        {!goal.done ? (
          <button type="button" className="goal-go" onClick={onShow} aria-label={`Show me: ${goal.title}`}>
            Show me
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function TodayGoals({
  list,
  streak,
  defaultOpen,
  onShow,
  onHowToPlay,
}: {
  list: GoalList;
  streak: number;
  defaultOpen: boolean;
  onShow: (goal: Goal) => void;
  onHowToPlay: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = list.goals.filter((g) => g.done).length;
  const allDone = list.goals.length > 0 && done === list.goals.length;

  // Briefly highlight goals that finish while the player watches.
  const before = useRef<{ scope: GoalList['scope']; done: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(list.goals.filter((g) => g.done).map((g) => g.id));
    const prev = before.current;
    before.current = { scope: list.scope, done: now };
    if (!prev || prev.scope !== list.scope) return;
    const newly = [...now].filter((id) => !prev.done.has(id));
    if (!newly.length) return;
    play(now.size === list.goals.length ? 'allGoals' : 'goal');
    setFresh(new Set(newly));
    setOpen(true);
    const id = window.setTimeout(() => setFresh(new Set()), 2400);
    return () => window.clearTimeout(id);
  }, [list]);

  return (
    <section className={`hud hud-card goals${open ? '' : ' is-collapsed'}${allDone ? ' is-complete' : ''}`} aria-labelledby="goals-title" data-occluder>
      <header className="goals-head">
        <button type="button" className="goals-toggle" aria-expanded={open} aria-controls="goals-list" onClick={() => setOpen((o) => !o)}>
          <span id="goals-title" className="goals-title">
            {list.title}
          </span>
          <span className="goals-count num" aria-label={`${done} of ${list.goals.length} done`}>
            {done}/{list.goals.length}
          </span>
          <svg className="goals-caret" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d={open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="goals-meter" aria-hidden="true">
        <span style={{ width: `${list.goals.length ? (100 * done) / list.goals.length : 0}%` }} />
      </div>
      <div id="goals-list" hidden={!open}>
        {allDone ? (
          <div className="goals-done" role="status">
            <p className="goals-done-title">{list.scope === 'first' ? "You're settled in!" : 'All done for today!'}</p>
            <p className="goals-done-hint">
              {list.scope === 'first' ? 'New goals appear once you move in.' : 'New goals arrive at dawn.'}
              {streak > 1 ? (
                <>
                  {' '}
                  <span className="goals-streak num">{streak} days in a row</span>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
        <ul className="goals-list" aria-label={list.title}>
          {list.goals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} fresh={fresh.has(goal.id)} onShow={() => onShow(goal)} />
          ))}
        </ul>
        <button type="button" className="link-button goals-help" onClick={onHowToPlay}>
          How to play
        </button>
      </div>
    </section>
  );
}
