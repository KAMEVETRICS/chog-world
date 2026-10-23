// The Chog card: who it is and how it feels up top, then one section at a time (Life, Home, Market,
// Council, Soul, Settings) so nobody faces every control at once. Owner-only sections appear for its holder.
import { useLayoutEffect, useRef } from 'react';
import type { AgentState, DecorateRequest, DecorateResult, PolicyUpdateRequest, PolicyUpdateResult, WorldState } from '../../shared/contracts';
import type { Appearance, ChogLook } from '../../shared/looks';
import { moodOf } from '../../simulation/needs';
import { FOCUS_HINT, FOCUS_LABEL, STYLE_LABEL, activityOf, shortAddress } from '../format';
import { PolicySettings } from '../owner/PolicySettings';
import { ChogFigure, GlyphIcon, scarfFor } from '../world/art';
import { NftPortrait } from '../world/NftPortrait';
import { GENESIS_CONTRACT } from '../../fixtures/chog-genesis';
import { BuildingProgress } from './BuildingProgress';
import { Inventory } from './Inventory';
import { DecorShop, NeedsView } from './Needs';
import { NextHome } from './NextHome';
import { Milestones } from './Milestones';
import { titleOf } from './titles';
import { SectionIcon, type SheetSection } from './sheet-art';
import { ChogCouncil, ChogMarket, type InstructionsPort } from '../economy/ChogEconomy';
import type { OnAct } from '../economy/actions';
import './sheet.css';

export type { SheetSection } from './sheet-art';

const SECTION_LABEL: Record<SheetSection, string> = {
  life: 'Life',
  home: 'Home',
  market: 'Market',
  council: 'Council',
  soul: 'Soul',
  settings: 'Settings',
};

/** Which sections this viewer gets, in order. */
export function sectionsFor(isMine: boolean, agent: AgentState, hasSoul: boolean): SheetSection[] {
  const holder = isMine && agent.control.kind === 'controlled';
  return ['life', 'home', 'market', ...(holder ? (['council'] as const) : []), ...(hasSoul ? (['soul'] as const) : []), 'settings'];
}

function MoodFace({ tone }: { tone: 'ok' | 'warn' | 'alert' }) {
  const mouth = tone === 'ok' ? 'M-3 1.5 Q0 4.2 3 1.5' : tone === 'warn' ? 'M-3 2.6 H3' : 'M-3 3.6 Q0 1 3 3.6';
  return (
    <svg width="18" height="18" viewBox="-8 -8 16 16" aria-hidden="true">
      <circle r="7" fill="currentColor" opacity="0.18" />
      <circle r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="-2.4" cy="-1.6" r="1.1" fill="currentColor" />
      <circle cx="2.4" cy="-1.6" r="1.1" fill="currentColor" />
      <path d={mouth} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ResidentPanel({
  agent,
  world,
  isMine,
  holderName,
  onSave,
  onDecorate,
  onAct,
  instructions,
  fixtureTools,
  soul,
  look,
  appearance,
  section,
  onSection,
}: {
  agent: AgentState;
  world: WorldState;
  isMine: boolean;
  holderName: (address: string) => string;
  onSave: (request: PolicyUpdateRequest, idempotencyKey: string) => Promise<PolicyUpdateResult>;
  onDecorate: (request: DecorateRequest, idempotencyKey: string) => Promise<DecorateResult>;
  onAct: OnAct;
  /** The holder's private standing instructions for this Chog. */
  instructions?: InstructionsPort;
  fixtureTools?: React.ReactNode;
  /** Server mode: the Chog's Soul (persona, and for its holder credits, AI consent and chat). */
  soul?: React.ReactNode;
  look?: ChogLook | null;
  appearance?: Appearance;
  /** The open section; owned by the app so goals can point at one. */
  section: SheetSection;
  onSection: (section: SheetSection) => void;
}) {
  const activity = activityOf(agent, world);
  const controller = agent.control.controller;
  const mood = moodOf(agent);
  const moodTone = mood.kind === 'cheerful' || mood.kind === 'content' ? 'ok' : mood.kind === 'miserable' ? 'alert' : 'warn';
  const live = agent.control.kind === 'controlled' && agent.controlAvailability === 'verified' && agent.policy.active;
  const sections = sectionsFor(isMine, agent, Boolean(soul));
  const open = sections.includes(section) ? section : 'life';

  // A new section starts at its top: if the tabs are stuck over the scrolled body, scroll back up to them.
  const tabsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shown = useRef(open);
  useLayoutEffect(() => {
    if (shown.current === open) return;
    shown.current = open;
    const tabs = tabsRef.current;
    const body = bodyRef.current;
    const scroller = body?.closest('.tab-panel');
    if (!tabs || !body || !scroller) return;
    const hidden = tabs.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
    if (hidden > 0) scroller.scrollTop -= hidden;
  }, [open]);

  return (
    <article className="resident sheet" aria-labelledby="resident-name">
      <header className="sheet-hero" style={appearance ? ({ '--hero': appearance.background } as React.CSSProperties) : undefined}>
        <div className="portrait sheet-portrait">
          {appearance ? (
            <NftPortrait image={look?.image} appearance={appearance} size={88} alt={look ? `Chog Genesis #${look.sourceTokenId}` : agent.name} />
          ) : (
            <svg viewBox="-16 -24 32 28" width="80" height="70" aria-hidden="true">
              <ChogFigure scarf={scarfFor(agent.identity.tokenId)} mood={activity.glyph === 'rest' ? 'sleep' : 'idle'} />
            </svg>
          )}
        </div>
        <div className="resident-id">
          <h2 id="resident-name">{agent.name}</h2>
          <p className="resident-meta">
            <span className="num">Chog #{agent.identity.tokenId}</span>
            {controller ? (
              <span title={controller}>
                <span aria-hidden="true">· </span>Held by {holderName(controller)} <span className="mono sheet-address">{shortAddress(controller)}</span>
              </span>
            ) : (
              <span>No holder</span>
            )}
          </p>
          <p className="sheet-chips">
            {isMine ? <span className="tag tag--mine">Yours</span> : <span className="tag tag--view">View only</span>}
            <span className="title-chip">{titleOf(agent)}</span>
            {live ? (
              <span className={`mood-chip mood-chip--${moodTone}`}>
                <MoodFace tone={moodTone} />
                Feeling {mood.kind}
              </span>
            ) : null}
            <span className="coin-chip" title="City coins">
              <span className="coin-dot" aria-hidden="true" />
              <span className="num">{agent.coins}</span> <span className="visually-hidden">coins</span>
            </span>
          </p>
          {look ? (
            <p className="resident-look">
              Wearing Chog Genesis <span className="num">#{look.sourceTokenId}</span>
              {agent.identity.collection.toLowerCase() !== GENESIS_CONTRACT.toLowerCase() ? <span className="look-note"> · demo look</span> : null}
            </p>
          ) : null}
        </div>
      </header>

      <p className={`status status--${activity.tone}`}>
        <GlyphIcon glyph={activity.glyph} size={18} />
        <span>{activity.label}</span>
      </p>

      <div ref={tabsRef} className="sheet-tabs" role="tablist" aria-label={`${agent.name}'s card`}>
        {sections.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`sheet-tab-${id}`}
            aria-selected={open === id}
            aria-controls={`sheet-${id}`}
            tabIndex={open === id ? 0 : -1}
            className="sheet-tab"
            onClick={() => onSection(id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = sections.indexOf(open);
              const next = sections[(i + (e.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length]!;
              onSection(next);
              document.getElementById(`sheet-tab-${next}`)?.focus();
            }}
          >
            <SectionIcon section={id} />
            <span>{SECTION_LABEL[id]}</span>
          </button>
        ))}
      </div>

      <div ref={bodyRef} className="sheet-body" role="tabpanel" id={`sheet-${open}`} aria-labelledby={`sheet-tab-${open}`} key={open}>
        {open === 'life' ? (
          <>
            <NextHome agent={agent} />
            <section className="panel-section" aria-labelledby="milestones-h">
              <h3 id="milestones-h" className="section-title">
                Milestones
              </h3>
              <Milestones agent={agent} />
            </section>
            <section className="panel-section" aria-labelledby="needs-h">
              <h3 id="needs-h" className="section-title">
                Mood and needs
              </h3>
              <NeedsView agent={agent} />
            </section>
            <section className="panel-section" aria-labelledby="stores-h">
              <h3 id="stores-h" className="section-title">
                Stores
              </h3>
              <Inventory inventory={agent.inventory} />
            </section>
            <section className="panel-section" aria-labelledby="plan-h">
              <h3 id="plan-h" className="section-title">
                Its plan
              </h3>
              <p className="plan-line">
                <strong>{FOCUS_LABEL[agent.policy.focus]}.</strong> {FOCUS_HINT[agent.policy.focus]}
                {isMine ? (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => onSection('settings')}>
                      Change
                    </button>
                  </>
                ) : null}
              </p>
            </section>
          </>
        ) : null}

        {open === 'home' ? (
          <>
            <section className="panel-section panel-section--first" aria-labelledby="home-h">
              <h3 id="home-h" className="section-title">
                Home <span className="section-aside">Plot {agent.plotId.slice(1)}</span>
              </h3>
              <BuildingProgress agent={agent} />
              <p className="setting-hint">
                Its next level will be a {STYLE_LABEL[agent.policy.homeStyle].toLowerCase()}.
                {isMine ? (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => onSection('settings')}>
                      Change style
                    </button>
                  </>
                ) : null}
              </p>
            </section>
            <section className="panel-section" aria-labelledby="decor-h">
              <h3 id="decor-h" className="section-title">
                Garden and decorations
              </h3>
              <DecorShop agent={agent} canEdit={isMine} onDecorate={onDecorate} />
            </section>
          </>
        ) : null}

        {open === 'market' ? <ChogMarket agent={agent} world={world} isMine={isMine} onAct={onAct} /> : null}

        {open === 'council' ? <ChogCouncil agent={agent} world={world} onAct={onAct} {...(instructions ? { instructions } : {})} /> : null}

        {open === 'soul' ? soul : null}

        {open === 'settings' ? (
          <section className="panel-section panel-section--first" aria-labelledby="settings-h">
            <h3 id="settings-h" className="section-title">
              Settings
            </h3>
            {!isMine && agent.control.kind === 'controlled' ? <p className="readonly-note">Only the Chog's holder can change these. Everyone can watch.</p> : null}
            <PolicySettings agent={agent} canEdit={isMine} onSave={onSave} />
          </section>
        ) : null}
      </div>

      {fixtureTools}
    </article>
  );
}
