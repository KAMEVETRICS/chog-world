// A Chog's market and council tabs. Everyone sees prices and the offer; only the holder can trade, hire, give,
// instruct, speak or propose.
import { useState } from 'react';
import { JOBS, RESOURCES, type AgentState, type Job, type WorldState } from '../../shared/contracts';
import { OFFER_WAGE_MAX, OFFER_WAGE_MIN } from '../../shared/rules';
import { marketFee, marketPrices } from '../../simulation/economy';
import { JOB_LABEL, RESOURCE_LABEL } from '../format';
import { ActionStatus, AmountInput, GiftForm, parseAmount, useAct, type OnAct } from './actions';
import { ProposeForm } from './Votes';
import { Instructions, SpeakForm } from './Council';
import type { InstructionsRequest, InstructionsResult } from '../../shared/contracts';

export interface InstructionsPort {
  load: (key: string) => Promise<string | null>;
  save: (key: string, request: InstructionsRequest) => Promise<InstructionsResult>;
}

const HIRE_JOBS = JOBS.filter((j): j is Exclude<Job, 'off'> => j !== 'off');

function Market({ agent, world, canEdit, onAct }: { agent: AgentState; world: WorldState; canEdit: boolean; onAct: OnAct }) {
  const [amount, setAmount] = useState(1);
  const { busy, status, run } = useAct(onAct);
  const trade = (side: 'sell' | 'buy', resource: (typeof RESOURCES)[number]) =>
    void run(
      { type: 'trade', chog: agent.key, expectedEpoch: agent.control.epoch, side, resource, amount },
      `${side === 'sell' ? 'Sold' : 'Bought'} ${amount} ${resource}.`,
    );
  return (
    <div className="market">
      <table className="constitution market-table">
        <caption>
          Lantern Plaza market <span className="section-aside">Fee {marketFee(world)}%</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Goods</th>
            <th scope="col">Sell for</th>
            <th scope="col">Buy for</th>
            <th scope="col">In stock</th>
            {canEdit ? <th scope="col"><span className="visually-hidden">Trade</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {RESOURCES.map((r) => {
            const p = marketPrices(world, r);
            return (
              <tr key={r}>
                <th scope="row">{RESOURCE_LABEL[r]}</th>
                <td className="num">{p.sell}</td>
                <td className="num">{p.buy}</td>
                <td className="num">{world.treasury.stores[r]}</td>
                {canEdit ? (
                  <td className="market-buttons">
                    <button type="button" className="button button--quiet button--small" disabled={busy} onClick={() => trade('sell', r)} aria-label={`Sell ${amount} ${r}`}>
                      Sell
                    </button>
                    <button type="button" className="button button--quiet button--small" disabled={busy} onClick={() => trade('buy', r)} aria-label={`Buy ${amount} ${r}`}>
                      Buy
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {canEdit ? (
        <label className="look-pick econ-amount">
          <span className="setting-label">Units per trade</span>
          <select className="select-input" value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="setting-hint">Prices are in coins per unit and move with the city's stock. Only free materials can be sold.</p>
      <ActionStatus status={status} />
    </div>
  );
}

function Hiring({ agent, world, canEdit, onAct }: { agent: AgentState; world: WorldState; canEdit: boolean; onAct: OnAct }) {
  const [job, setJob] = useState<Exclude<Job, 'off'>>(agent.offer?.job ?? 'woodcutter');
  const [wageText, setWageText] = useState(String(agent.offer?.wage ?? 3));
  const parsed = parseAmount(wageText);
  const wage = parsed !== null && parsed >= OFFER_WAGE_MIN && parsed <= OFFER_WAGE_MAX ? parsed : null;
  const { busy, status, run } = useAct(onAct);
  const employee = world.citizens.find((c) => c.employer === agent.key);
  const offer = agent.offer;
  return (
    <div className="hiring">
      <p className="readonly-note">
        {offer
          ? `Hiring a ${JOB_LABEL[offer.job].toLowerCase()} at ${offer.wage} coins an hour${employee ? `, worked by ${employee.name}` : ', open to any villager'}.`
          : 'Not hiring.'}
      </p>
      {canEdit ? (
        <form
          className="econ-form"
          aria-label="Job offer"
          onSubmit={(e) => {
            e.preventDefault();
            if (wage === null) return;
            void run({ type: 'offer', chog: agent.key, expectedEpoch: agent.control.epoch, offer: { job, wage } }, 'Job offer posted.');
          }}
        >
          <label className="look-pick">
            <span className="setting-label">Job</span>
            <select className="select-input" value={job} onChange={(e) => setJob(e.target.value as Exclude<Job, 'off'>)}>
              {HIRE_JOBS.map((j) => (
                <option key={j} value={j}>
                  {JOB_LABEL[j]}
                </option>
              ))}
            </select>
          </label>
          <label className="look-pick econ-amount">
            <span className="setting-label">Wage</span>
            <AmountInput value={wageText} max={OFFER_WAGE_MAX} onChange={setWageText} />
          </label>
          <button type="submit" className="button button--quiet button--small" disabled={busy || wage === null}>
            {offer ? 'Update offer' : 'Post offer'}
          </button>
          {offer ? (
            <button type="button" className="button button--quiet button--small" disabled={busy} onClick={() => void run({ type: 'offer', chog: agent.key, expectedEpoch: agent.control.epoch, offer: null }, 'Offer withdrawn.')}>
              Stop hiring
            </button>
          ) : null}
          <ActionStatus status={status} />
        </form>
      ) : null}
      {canEdit ? <p className="setting-hint">A hired villager's work goes into this Chog's stores. Each hour worked costs the wage, if the Chog has the coins.</p> : null}
    </div>
  );
}

/** The Market tab: the Chog's purse, the Plaza market, its job offer and gifts. */
export function ChogMarket({ agent, world, isMine, onAct }: { agent: AgentState; world: WorldState; isMine: boolean; onAct: OnAct }) {
  const canEdit = isMine && agent.control.kind === 'controlled';
  return (
    <>
      <p className="tab-lede">
        {agent.name} has <strong className="num">{agent.coins}</strong> {agent.coins === 1 ? 'coin' : 'coins'}.{' '}
        {canEdit ? 'Sell spare materials for coins, or buy what it is short of.' : 'Its holder can trade, hire and give from here.'}
      </p>
      <section className="panel-section" aria-labelledby="econ-h">
        <h3 id="econ-h" className="section-title">
          Buy and sell
        </h3>
        <Market agent={agent} world={world} canEdit={canEdit} onAct={onAct} />
      </section>
      <section className="panel-section" aria-labelledby="hire-h">
        <h3 id="hire-h" className="section-title">
          Hiring
        </h3>
        <Hiring key={agent.key} agent={agent} world={world} canEdit={canEdit} onAct={onAct} />
      </section>
      {canEdit ? (
        <section className="panel-section" aria-labelledby="gift-chog-h">
          <h3 id="gift-chog-h" className="section-title">
            Give a gift
          </h3>
          <GiftForm key={agent.key} world={world} from={{ kind: 'chog', key: agent.key, expectedEpoch: agent.control.epoch }} fromKey={agent.key} canGiveMaterials onAct={onAct} />
        </section>
      ) : null}
    </>
  );
}

/** The Council tab (holder only): private instructions, speaking on open proposals, and proposing. */
export function ChogCouncil({ agent, world, onAct, instructions }: { agent: AgentState; world: WorldState; onAct: OnAct; instructions?: InstructionsPort }) {
  return (
    <>
      <p className="tab-lede">
        Every morning the Chogs meet at the council. {agent.name} may put one idea forward and speak for or against the others. Villagers then vote.
      </p>
      {instructions ? (
        <section className="panel-section" aria-labelledby="instruct-h">
          <h3 id="instruct-h" className="section-title">
            Your private advice
          </h3>
          <Instructions agent={agent} load={instructions.load} save={instructions.save} />
        </section>
      ) : null}
      <section className="panel-section" aria-labelledby="council-h">
        <h3 id="council-h" className="section-title">
          Speak at the council
        </h3>
        <SpeakForm key={`speak-${agent.key}`} agent={agent} world={world} onAct={onAct} />
      </section>
      <section className="panel-section" aria-labelledby="propose-h">
        <h3 id="propose-h" className="section-title">
          Propose for the city
        </h3>
        <ProposeForm key={`propose-${agent.key}`} agent={agent} world={world} onAct={onAct} />
      </section>
    </>
  );
}
