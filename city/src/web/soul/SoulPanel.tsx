// Chog Soul in City (server mode). Everyone sees the Chog's character; its holder also sees their $CHOG credits,
// the AI switch for the Chog's Cult debates and votes, and a private chat. Ported from the Cult page's panel.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CityApiError } from '../api/http-client';
import { shortAddress } from '../format';
import { soulApi, type Persona, type SoulAccount, type SoulConfig, type SoulPrivate } from './soul-api';

const ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'Not enough credits. Top up with $CHOG below.',
  AI_UNAVAILABLE: "AI isn't switched on for this server yet.",
  PROVIDER_FAILED: "Your Chog couldn't answer just now. You were not charged.",
  NOT_CONTROLLER: 'Your wallet no longer holds this Chog.',
  CONTROL_CHANGED: 'This Chog changed hands since you loaded it. Reload the page.',
  OWNERSHIP_UNAVAILABLE: "Ownership can't be checked right now. Try again in a moment.",
  RATE_LIMITED: 'Slow down a little; your Chog needs a breath.',
  LOGIN_REQUIRED: 'Your session ended. Sign in again.',
  CSRF_FAILED: 'Your session needs refreshing. Sign in again.',
};
const SESSION_LOST = new Set(['LOGIN_REQUIRED', 'CSRF_FAILED']);
const explain = (error: unknown) =>
  error instanceof CityApiError ? ERROR_TEXT[error.code] ?? error.message : 'Something went wrong. Please try again.';

/** The Chog's character, derived from its traits. Shown only for Chogs that are Cult members. */
function PersonaCard({ agentKey }: { agentKey: string }) {
  const [persona, setPersona] = useState<Persona | null>(null);
  useEffect(() => {
    let live = true;
    setPersona(null);
    soulApi.persona(agentKey).then(
      (result) => live && setPersona(result.persona),
      // Decoration only: a Chog without a persona (not in the Cult) simply shows none.
      () => live && setPersona(null),
    );
    return () => {
      live = false;
    };
  }, [agentKey]);
  if (!persona) return null;
  return (
    <div className="persona">
      <p className="persona-catchphrase">“{persona.catchphrase}”</p>
      <p className="persona-summary">{persona.summary}</p>
    </div>
  );
}

/** The Soul section of a resident's panel: persona for everyone, credits, AI consent and chat for its holder. */
export function ResidentSoul({ agentKey, name, isMine, onSessionLost }: { agentKey: string; name: string; isMine: boolean; onSessionLost: () => void }) {
  return (
    <section className="panel-section" aria-labelledby="soul-h">
      <h3 id="soul-h" className="section-title">
        Soul
        {isMine ? null : <span className="section-aside">Only its holder can talk to it</span>}
      </h3>
      <PersonaCard agentKey={agentKey} />
      {isMine ? <SoulPanel key={agentKey} agentKey={agentKey} name={name} onSessionLost={onSessionLost} /> : null}
      <p className="soul-muted">
        <a href={`/soul/?chog=${agentKey.split(":")[4]}`}>Open {name} in Chog Soul →</a>
      </p>
    </section>
  );
}

function SoulPanel({ agentKey, name, onSessionLost }: { agentKey: string; name: string; onSessionLost: () => void }) {
  const [config, setConfig] = useState<SoulConfig | null>(null);
  const [account, setAccount] = useState<SoulAccount | null>(null);
  const [view, setView] = useState<SoulPrivate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextAccount, nextView] = await Promise.all([soulApi.config(), soulApi.me(), soulApi.private(agentKey)]);
      setConfig(nextConfig);
      setAccount(nextAccount);
      setView(nextView);
      setError(null);
    } catch (cause) {
      if (cause instanceof CityApiError && SESSION_LOST.has(cause.code)) onSessionLost();
      setError(explain(cause));
    }
  }, [agentKey, onSessionLost]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deposits are credited once their block is finalized; check again every few seconds while open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      soulApi.me().then(setAccount, () => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  if (!config || !account || !view) {
    return error ? (
      <p className="soul-error" role="alert">
        {error}
      </p>
    ) : (
      <p className="soul-muted" role="status">
        Loading {name}'s Soul…
      </p>
    );
  }
  return (
    <div className="soul">
      <Credits config={config} account={account} />
      <Consent config={config} agentKey={agentKey} view={view} onSaved={load} />
      <Chat config={config} agentKey={agentKey} name={name} view={view} onSent={load} />
    </div>
  );
}

function Credits({ config, account }: { config: SoulConfig; account: SoulAccount }) {
  const [open, setOpen] = useState(false);
  const { payment } = config;
  return (
    <div className="soul-credits">
      <p className="soul-balance">
        <strong className="num">{account.balance} CHOG</strong> in credits
        {account.held !== '0' ? <span className="soul-muted"> ({account.held} in use)</span> : null}
      </p>
      <p className="soul-muted">
        Credits belong to your wallet and work for any Chog you hold. Chat reply {config.prices.chat} · debate line{' '}
        {config.prices.debate} · vote {config.prices.vote} CHOG. You're never charged when something fails.
      </p>
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide top-up' : 'Top up'}
      </button>
      {open ? (
        payment.mode === 'chog' && payment.treasury && payment.token ? (
          <div className="soul-topup">
            <p>
              Send $CHOG on Monad to the treasury <strong>from the wallet you signed in with</strong> ({shortAddress(account.address)}).
              Credits appear once the block is finalized, usually within seconds.
            </p>
            <dl>
              <dt>Treasury</dt>
              <dd className="mono">{payment.treasury}</dd>
              <dt>$CHOG token</dt>
              <dd className="mono">{payment.token}</dd>
            </dl>
            <p className="soul-caution">Credits are a prepaid service balance: they can't be withdrawn or refunded.</p>
          </div>
        ) : payment.mode === 'fixture' ? (
          <p className="soul-muted">This is a local fixture: credits are granted by the server, not bought.</p>
        ) : (
          <p className="soul-muted">Top-ups aren't open on this server yet.</p>
        )
      ) : null}
    </div>
  );
}

function Consent({ config, agentKey, view, onSaved }: { config: SoulConfig; agentKey: string; view: SoulPrivate; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(view.settings.aiEnabled);
  const [cap, setCap] = useState(view.settings.dailyCap);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const capId = useId();
  const hintId = useId();
  const changed = enabled !== view.settings.aiEnabled || cap !== view.settings.dailyCap;
  return (
    <form
      className="soul-consent"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await soulApi.settings(agentKey, { aiEnabled: enabled, dailyCap: cap, expectedEpoch: view.epoch });
          setStatus({ kind: 'ok', text: 'Saved.' });
          onSaved();
        } catch (error) {
          setStatus({ kind: 'error', text: explain(error) });
        }
      }}
    >
      <label className="soul-check">
        <input type="checkbox" checked={enabled} disabled={!config.ai} onChange={(event) => setEnabled(event.target.checked)} /> Let this Chog
        think with AI in the Cult (uses my credits)
      </label>
      <div className="soul-cap">
        <label htmlFor={capId}>Daily limit</label>
        <input id={capId} className="bring-input num" inputMode="decimal" value={cap} aria-describedby={hintId} onChange={(event) => setCap(event.target.value)} />
        <span>CHOG</span>
      </div>
      <p id={hintId} className="soul-muted">
        Spent today: {view.settings.spentToday} CHOG. Without AI, or past the limit, it argues and votes by its traits.
      </p>
      <div>
        <button type="submit" className="button button--quiet button--small" disabled={!changed}>
          Save AI settings
        </button>
      </div>
      {status ? (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className={status.kind === 'error' ? 'soul-error' : 'soul-ok'}>
          {status.text}
        </p>
      ) : null}
    </form>
  );
}

function Chat({ config, agentKey, name, view, onSent }: { config: SoulConfig; agentKey: string; name: string; view: SoulPrivate; onSent: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed send keeps its key, so resending the same words can't be charged twice.
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const inputId = useId();
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [view.messages.length, pending]);

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    if (attempt.current?.text !== text) attempt.current = { text, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    setPending(text);
    setMessage('');
    try {
      await soulApi.chat(agentKey, text, attempt.current.key);
      attempt.current = null;
      onSent();
    } catch (cause) {
      setError(explain(cause));
      setMessage(text);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="soul-chat">
      <h4 className="soul-chat-title">Talk to {name}</h4>
      <ol className="chat-log" aria-live="polite">
        {view.messages.length === 0 && !pending ? (
          <li className="soul-muted">Only you can see this conversation. If you sell {name}, the buyer starts a fresh one.</li>
        ) : null}
        {view.messages.map((entry, index) => (
          <li key={index} className={`bubble bubble--${entry.role}`}>
            <span className="visually-hidden">{entry.role === 'holder' ? 'You' : name}: </span>
            {entry.text}
          </li>
        ))}
        {pending ? <li className="bubble bubble--holder bubble--pending">{pending}</li> : null}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form
        className="bring-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void send();
        }}
      >
        <label className="visually-hidden" htmlFor={inputId}>
          Message to {name}
        </label>
        <input
          id={inputId}
          className="bring-input"
          maxLength={500}
          value={message}
          placeholder={config.ai ? `Say something to ${name}…` : "AI isn't switched on for this server yet"}
          disabled={!config.ai || busy}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" className="button button--primary button--small" disabled={!config.ai || busy || !message.trim()}>
          {busy ? 'Thinking…' : `Send · ${config.prices.chat} CHOG`}
        </button>
      </form>
      {error ? (
        <p role="alert" className="soul-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
