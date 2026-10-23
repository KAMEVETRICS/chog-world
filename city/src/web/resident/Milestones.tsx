// The milestone track on a Chog's Life tab: what it has earned, and the one it's working towards.
import type { AgentState } from '../../shared/contracts';
import { MILESTONES } from './titles';

function Mark({ state }: { state: 'earned' | 'next' | 'later' }) {
  return (
    <span className={`milestone-mark milestone-mark--${state}`} aria-hidden="true">
      {state === 'earned' ? (
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.4 L6.6 11.3 L12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="-8 -8 16 16" width="12" height="12">
          <path d="M0 -6 L1.7 -2 L6 -1.7 L2.7 1.2 L3.7 5.5 L0 3.3 L-3.7 5.5 L-2.7 1.2 L-6 -1.7 L-1.7 -2 Z" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

export function Milestones({ agent }: { agent: AgentState }) {
  const next = MILESTONES.find((m) => m.ladder && !m.earned(agent));
  const earned = MILESTONES.filter((m) => m.earned(agent)).length;
  return (
    <div className="milestones">
      <p className="setting-hint">
        {earned} of {MILESTONES.length} earned.{next ? ` Next: ${next.title}, ${next.needs.toLowerCase()}.` : ' Every home title is earned.'}
      </p>
      <ol className="milestone-track" aria-label="Milestones">
        {MILESTONES.map((m) => {
          const state = m.earned(agent) ? 'earned' : m === next ? 'next' : 'later';
          return (
            <li key={m.id} className={`milestone milestone--${state}`}>
              <Mark state={state} />
              <span className="milestone-title">{m.title}</span>
              <span className="milestone-needs">{m.needs}</span>
              <span className="visually-hidden">{state === 'earned' ? '(earned)' : state === 'next' ? '(next)' : '(not yet)'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
