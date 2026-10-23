import { useCallback, useEffect, useRef, useState } from "react";
import { BotPanel } from "./BotPanel";
import { ApiError } from "../api";
import { soulApi, type Persona, type SoulAccount, type SoulConfig, type SoulPrivate } from "./api";

const ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_CREDITS: "Not enough credits. Top up with $CHOG below.",
  AI_UNAVAILABLE: "AI isn't switched on for this server yet.",
  PROVIDER_FAILED: "Your Chog couldn't answer just now. You were not charged.",
  NOT_CONTROLLER: "Your wallet no longer holds this Chog.",
  CONTROL_CHANGED: "This Chog changed hands since you loaded it. Reload the page.",
  OWNERSHIP_UNAVAILABLE: "Ownership can't be checked right now. Try again in a moment.",
  RATE_LIMITED: "Slow down a little; your Chog needs a breath.",
  LOGIN_REQUIRED: "Your session ended. Sign in again.",
  CSRF_FAILED: "Your session needs refreshing. Sign in again.",
};
const explain = (error: unknown) => (error instanceof ApiError ? ERROR_TEXT[error.code] ?? error.message : "Something went wrong.");
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Public: the Chog's character, derived from its traits. */
export function PersonaCard({ agentKey }: { agentKey: string }) {
  const [persona, setPersona] = useState<Persona | null>(null);
  useEffect(() => {
    let live = true;
    setPersona(null);
    soulApi.persona(agentKey).then((result) => { if (live) setPersona(result.persona); }).catch(() => {});
    return () => { live = false; };
  }, [agentKey]);
  if (!persona) return null;
  return (
    <div className="persona">
      <p className="catchphrase">“{persona.catchphrase}”</p>
      <p className="small muted">{persona.summary}</p>
    </div>
  );
}

/** Holder only: credits, the AI switch for this Chog, and chat. */
export function SoulPanel({ agentKey, name, csrf, onSessionLost }: { agentKey: string; name: string; csrf: string; onSessionLost?: () => void }) {
  const [config, setConfig] = useState<SoulConfig | null>(null);
  const [account, setAccount] = useState<SoulAccount | null>(null);
  const [view, setView] = useState<SoulPrivate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [nextConfig, nextAccount, nextView] = await Promise.all([soulApi.config(), soulApi.me(), soulApi.private(agentKey)]);
      setConfig(nextConfig); setAccount(nextAccount); setView(nextView); setError(null);
    } catch (cause) {
      if (cause instanceof ApiError && ["LOGIN_REQUIRED", "CSRF_FAILED"].includes(cause.code)) onSessionLost?.();
      setError(explain(cause));
    }
  }, [agentKey, onSessionLost]);
  useEffect(() => { void load(); }, [load]);
  // Deposits are credited when their block is finalized; check again every few seconds while open.
  useEffect(() => {
    const timer = setInterval(() => { soulApi.me().then(setAccount).catch(() => {}); }, 8000);
    return () => clearInterval(timer);
  }, []);

  if (error && !view) return <section className="soul"><h3>{name}'s Soul</h3><p role="alert" className="error">{error}</p></section>;
  if (!config || !account || !view) return <section className="soul"><h3>{name}'s Soul</h3><p role="status" className="muted">Loading…</p></section>;
  return (
    <section className="soul" aria-labelledby={`soul-${agentKey}`}>
      <h3 id={`soul-${agentKey}`}>{name}'s Soul</h3>
      <Credits config={config} account={account} />
      <Consent config={config} agentKey={agentKey} view={view} csrf={csrf} onSaved={load} />
      <Chat config={config} agentKey={agentKey} name={name} view={view} csrf={csrf} onSent={load} />
      <BotPanel agentKey={agentKey} name={name} csrf={csrf} aiOn={config.ai && view.settings.aiEnabled} />
    </section>
  );
}

function Credits({ config, account }: { config: SoulConfig; account: SoulAccount }) {
  const [open, setOpen] = useState(false);
  const { payment } = config;
  return (
    <div className="credits">
      <p><strong>{account.balance} CHOG</strong> in credits{account.held !== "0" ? ` (${account.held} in use)` : ""}. Credits belong to your wallet and work for any Chog you hold.</p>
      <p className="small muted">Chat reply {config.prices.chat} · debate line {config.prices.debate} · vote decision {config.prices.vote} CHOG. You're never charged when something fails.</p>
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide top-up" : "Top up"}</button>
      {open && (payment.mode === "chog" && payment.treasury && payment.token ? (
        <div className="top-up">
          <p className="small">Send $CHOG on Monad to the treasury <strong>from the wallet you signed in with</strong> ({short(account.address)}). Credits appear once the block is finalized, usually within seconds.</p>
          <dl className="small">
            <dt>Treasury</dt><dd><code>{payment.treasury}</code></dd>
            <dt>$CHOG token</dt><dd><code>{payment.token}</code></dd>
          </dl>
          <p className="small caution">Credits are a prepaid service balance: they can't be withdrawn or refunded.</p>
        </div>
      ) : payment.mode === "fixture"
        ? <p className="small muted">This is a local fixture: credits are granted by the server, not bought.</p>
        : <p className="small muted">Top-ups aren't open on this server yet.</p>)}
      {account.deposits.length > 0 && <p className="small muted">Last top-up: {account.deposits[0]!.amount} CHOG.</p>}
    </div>
  );
}

function Consent({ config, agentKey, view, csrf, onSaved }: { config: SoulConfig; agentKey: string; view: SoulPrivate; csrf: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(view.settings.aiEnabled);
  const [cap, setCap] = useState(view.settings.dailyCap);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const changed = enabled !== view.settings.aiEnabled || cap !== view.settings.dailyCap;
  return (
    <form className="consent" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await soulApi.settings(csrf, agentKey, { aiEnabled: enabled, dailyCap: cap, expectedEpoch: view.epoch });
        setStatus({ kind: "ok", text: "Saved." });
        onSaved();
      } catch (error) { setStatus({ kind: "error", text: explain(error) }); }
    }}>
      <label className="switch"><input type="checkbox" checked={enabled} disabled={!config.ai} onChange={(event) => setEnabled(event.target.checked)} /> Let this Chog think with AI in the Cult (uses my credits)</label>
      <label className="small">Daily limit for this Chog <input type="text" inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} aria-describedby={`cap-${agentKey}`} /> CHOG</label>
      <p id={`cap-${agentKey}`} className="small muted">Spent today: {view.settings.spentToday} CHOG. Without AI, or past the limit, it argues and votes by its traits.</p>
      <button type="submit" disabled={!changed}>Save AI settings</button>
      {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind}>{status.text}</p>}
    </form>
  );
}

function Chat({ config, agentKey, name, view, csrf, onSent }: { config: SoulConfig; agentKey: string; name: string; view: SoulPrivate; csrf: string; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [view.messages.length, pending]);
  return (
    <div className="chat">
      <h4>Talk to {name}</h4>
      <ol className="chat-log" aria-live="polite">
        {view.messages.length === 0 && !pending && <li className="muted small">Only you can see this conversation. If you sell {name}, the buyer starts a fresh one.</li>}
        {view.messages.map((entry, index) => <li key={index} className={`bubble ${entry.role}`}><span className="visually-hidden">{entry.role === "holder" ? "You" : name}: </span>{entry.text}</li>)}
        {pending && <li className="bubble holder pending">{pending}</li>}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const text = message.trim();
        if (!text) return;
        setBusy(true); setError(null); setPending(text); setMessage("");
        try { await soulApi.chat(csrf, agentKey, text); onSent(); }
        catch (cause) { setError(explain(cause)); setMessage(text); }
        finally { setBusy(false); setPending(null); }
      }}>
        <label className="visually-hidden" htmlFor={`chat-${agentKey}`}>Message to {name}</label>
        <input id={`chat-${agentKey}`} type="text" maxLength={500} value={message} placeholder={config.ai ? `Say something to ${name}…` : "AI isn't switched on for this server yet"} disabled={!config.ai || busy} onChange={(event) => setMessage(event.target.value)} />
        <button type="submit" disabled={!config.ai || busy || !message.trim()}>{busy ? "Thinking…" : `Send (${config.prices.chat} CHOG)`}</button>
      </form>
      {error && <p role="alert" className="error small">{error}</p>}
    </div>
  );
}
