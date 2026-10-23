// Selected resident: who they are, what they're doing, what they hold, and (for the holder) settings.
import { useState } from 'react';
import type { AgentState, DecorateRequest, DecorateResult, PolicyUpdateRequest, PolicyUpdateResult, WorldState } from '../../shared/contracts';
import type { Appearance, ChogLook } from '../../shared/looks';
import { activityOf, shortAddress } from '../format';
import { PolicySettings } from '../owner/PolicySettings';
import { ChogFigure, GlyphIcon, scarfFor } from '../world/art';
import { GENESIS_CONTRACT } from '../../fixtures/chog-genesis';
import { BuildingProgress } from './BuildingProgress';
import { Inventory } from './Inventory';
import { DecorShop, NeedsView } from './Needs';
import { ChogEconomy, type InstructionsPort } from '../economy/ChogEconomy';
import type { OnAct } from '../economy/actions';

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
}) {
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  const showImage = look?.image && imageFailed !== look.image;
  const activity = activityOf(agent, world);
  const controller = agent.control.controller;

  return (
    <article className="resident" aria-labelledby="resident-name">
      <header className="resident-head">
        <div className="portrait" style={appearance ? { background: appearance.background } : undefined}>
          {showImage ? (
            <img
              src={look!.image!}
              alt={`Chog Genesis #${look!.sourceTokenId}`}
              width={84}
              height={84}
              loading="lazy"
              onError={() => setImageFailed(look!.image)}
            />
          ) : (
            <svg viewBox="-16 -24 32 28" width="76" height="66" aria-hidden="true">
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
                <span aria-hidden="true">· </span>Held by {holderName(controller)} <span className="mono">{shortAddress(controller)}</span>
              </span>
            ) : (
              <span>No holder</span>
            )}
            {isMine ? <span className="tag tag--mine">Yours</span> : null}
          </p>
          {look ? (
            <p className="resident-look">
              Wearing Chog Genesis <span className="num">#{look.sourceTokenId}</span>
              {agent.identity.collection.toLowerCase() !== GENESIS_CONTRACT.toLowerCase() ? <span className="look-note"> · fixture look</span> : null}
            </p>
          ) : null}
        </div>
      </header>

      <p className={`status status--${activity.tone}`}>
        <GlyphIcon glyph={activity.glyph} size={18} />
        <span>{activity.label}</span>
      </p>

      <section className="panel-section" aria-labelledby="needs-h">
        <h3 id="needs-h" className="section-title">
          Needs
        </h3>
        <NeedsView agent={agent} />
      </section>

      <section className="panel-section" aria-labelledby="stores-h">
        <h3 id="stores-h" className="section-title">
          Stores
        </h3>
        <Inventory inventory={agent.inventory} />
      </section>

      <section className="panel-section" aria-labelledby="home-h">
        <h3 id="home-h" className="section-title">
          Home <span className="section-aside">Plot {agent.plotId.slice(1)}</span>
        </h3>
        <BuildingProgress agent={agent} />
        <DecorShop agent={agent} canEdit={isMine} onDecorate={onDecorate} />
      </section>

      <ChogEconomy agent={agent} world={world} isMine={isMine} onAct={onAct} {...(instructions ? { instructions } : {})} />

      <section className="panel-section" aria-labelledby="settings-h">
        <h3 id="settings-h" className="section-title">
          Settings
          {!isMine ? <span className="section-aside">View only</span> : null}
        </h3>
        {!isMine && agent.control.kind === 'controlled' ? (
          <p className="readonly-note">Only the Chog's holder can change these. Everyone can watch.</p>
        ) : null}
        <PolicySettings agent={agent} canEdit={isMine} onSave={onSave} />
      </section>

      {soul}
      {fixtureTools}
    </article>
  );
}
