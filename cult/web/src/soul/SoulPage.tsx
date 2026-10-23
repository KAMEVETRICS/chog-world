import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type SiteConfig } from "../api";
import { csrfStore, signInWithWallet, walletAvailable } from "../wallet";
import { awakenWithWallet, describeError, sleepFor, type AwakenStage } from "./awaken";
import { PersonaCard, SoulPanel } from "./SoulPanel";
import { worldApi, type Holdings, type SoulChog } from "./world";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function whereItIs(chog: SoulChog): string {
  if (!chog.awakened) return "Asleep";
  if (!chog.inCult) return "Awake, not joined yet";
  return chog.inCity ? `In City · plot ${chog.plotId?.replace(/^p0*/, "")}` : "In the Cult";
}

/** Chog Soul: the holder's front door. Sign in, see your Chogs, awaken one, then meet it and talk to it. */
export function SoulPage({ sleep = sleepFor }: { sleep?: (ms: number) => Promise<void> }) {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [csrf, setCsrf] = useState<string | null>(() => csrfStore.get());
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("chog"));
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config().then(setConfig, () => setStatus({ kind: "error", text: "Can't reach Chog World right now. Reload to try again." }));
  }, []);

  const signedOut = useCallback(() => {
    csrfStore.clear();
    setCsrf(null);
    setHoldings(null);
  }, []);

  const load = useCallback(async () => {
    try {
      setHoldings(await worldApi.holdings());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) signedOut();
      else setStatus({ kind: "error", text: describeError(error) });
    }
  }, [signedOut]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selected) params.set("chog", selected);
    else params.delete("chog");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [selected]);

  const signIn = async () => {
    const chainId = config?.chainIds[0];
    if (chainId === undefined) return;
    setBusy(true);
    setStatus(null);
    try {
      const signed = await signInWithWallet(async (address) => (await api.challenge(address, chainId)).message);
      const session = await api.verify(signed.message, signed.signature);
      csrfStore.set(session.csrfToken);
      setCsrf(session.csrfToken);
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      if (csrf) await api.logout(csrf);
    } catch {
      // Signing out here still forgets the session in this tab.
    }
    signedOut();
    setStatus({ kind: "ok", text: "Signed out. Your Chogs carry on without you." });
  };

  // Awakening or joining changes the Chog, which replaces its panel: report the outcome here, where it stays.
  const finished = useCallback(async (text: string) => {
    setStatus({ kind: "ok", text });
    await load();
  }, [load]);

  const chog = holdings?.chogs.find((entry) => entry.tokenId === selected) ?? holdings?.chogs[0] ?? null;

  return (
    <>
      <nav className="cw-nav" aria-label="Chog World">
        <a className="cw-logo" href="/">
          <svg viewBox="-13 -22 26 24" aria-hidden="true">
            <path d="M-9 -7 L-12 -11 L-8 -12 L-9 -16 L-5 -15 L-4 -19 L0 -16.5 L3 -19.5 L5 -15.5 L9 -16.5 L8.5 -12 L12.5 -11 L9 -7 Z" fill="#5b33c9" />
            <ellipse cx="0" cy="-8" rx="8.6" ry="8" fill="#8a5cf6" />
            <ellipse cx="0" cy="-6.8" rx="6" ry="4.8" fill="#fbf3cd" />
            <circle cx="-2.5" cy="-8" r="1.5" fill="#0b0910" />
            <circle cx="2.5" cy="-8" r="1.5" fill="#0b0910" />
          </svg>
          Chog World
        </a>
        <div className="cw-nav-links">
          <a href="/">Home</a><a href="/soul/" aria-current="page">Soul</a>{config?.city && <a href="/city/">City</a>}<a href="/cult/">Cult</a>
        </div>
        {config && <span className={`mode mode-${config.mode}`}>{config.label}</span>}
      </nav>
    <div className="app soul-page">
      <header className="soul-hero">
        <p className="cw-tag">Awaken · Meet · Talk</p>
        <h1 className="cw-display">Chog Soul</h1>
      </header>
      <p className="lede">
        Awaken your Chog, meet who it is, and talk to it. Awakening gives a Chog Genesis NFT its own onchain agent identity
        (ERC-8004) that always follows the NFT. From then on it lives in Chog City and argues in Chog Cult.
      </p>

      {!csrf || !holdings ? (
        <section aria-labelledby="signin-h" className="soul-signin">
          <h2 id="signin-h">Sign in</h2>
          <p>Sign in with the wallet that holds your Chogs. Signing only proves you hold the address; it sends no transaction and costs nothing.</p>
          <div>
            <button type="button" disabled={busy || !walletAvailable() || !config?.login} onClick={() => void signIn()}>
              {busy ? "Check your wallet…" : "Sign in with wallet"}
            </button>
          </div>
          {!walletAvailable() && <p className="muted small">No browser wallet found. Install one, or open this page in a wallet's browser.</p>}
        </section>
      ) : (
        <>
          <p className="muted small">
            Signed in as <code>{short(holdings.address)}</code>. <button type="button" className="link" onClick={() => void signOut()}>Sign out</button>
          </p>
          {holdings.chogs.length === 0 ? (
            <section><p>This wallet holds no Chog Genesis tokens. Sign in with the wallet that holds yours.</p></section>
          ) : (
            <div className="soul-layout">
              <section aria-labelledby="mine-h">
                <h2 id="mine-h">Your Chogs <span className="muted small">({holdings.chogs.length})</span></h2>
                <ul className="chog-grid">
                  {holdings.chogs.map((entry) => (
                    <li key={entry.tokenId}>
                      <button type="button" className="chog-card" aria-pressed={entry.tokenId === chog?.tokenId} onClick={() => setSelected(entry.tokenId)}>
                        {entry.image ? <img src={entry.image} alt="" width={96} height={96} loading="lazy" /> : <span className="chog-art" aria-hidden="true" />}
                        <span className="chog-name">{entry.name}</span>
                        <span className={`chip ${entry.awakened ? (entry.inCult ? "chip-joined" : "chip-awake") : "chip-asleep"}`}>{whereItIs(entry)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {chog && (
                <ChogDetail key={`${chog.tokenId}:${chog.awakened}:${chog.inCult}`} chog={chog} holdings={holdings} csrf={csrf}
                  onFinished={finished} onSessionLost={signedOut} sleep={sleep} />
              )}
            </div>
          )}
        </>
      )}
      {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind}>{status.text}</p>}
    </div>
    </>
  );
}

function ChogDetail({ chog, holdings, csrf, onFinished, onSessionLost, sleep }: {
  chog: SoulChog; holdings: Holdings; csrf: string; onFinished: (text: string) => Promise<void>; onSessionLost: () => void; sleep: (ms: number) => Promise<void>;
}) {
  return (
    <section aria-labelledby="chog-h" className="chog-detail">
      <div className="chog-head">
        {chog.image && <img src={chog.image} alt={`Chog Genesis #${chog.tokenId}`} width={120} height={120} />}
        <div>
          <h2 id="chog-h">{chog.name}</h2>
          <p className="muted small">Chog Genesis #{chog.tokenId} · {whereItIs(chog)}</p>
        </div>
      </div>
      {!chog.awakened ? (
        <Awaken chog={chog} holdings={holdings} csrf={csrf} onFinished={onFinished} sleep={sleep} />
      ) : !chog.inCult ? (
        <Join chog={chog} csrf={csrf} onFinished={onFinished} />
      ) : (
        <>
          <PersonaCard agentKey={chog.agentKey!} />
          <p className="soul-links">
            {chog.inCity ? <a href={`/city/?chog=${chog.tokenId}`}>See {chog.name} in City →</a> : <MoveIn chog={chog} csrf={csrf} onFinished={onFinished} />}
            <a href="/cult/">Choose its faction in Chog Cult →</a>
          </p>
          <SoulPanel agentKey={chog.agentKey!} name={chog.name} csrf={csrf} onSessionLost={onSessionLost} />
        </>
      )}
    </section>
  );
}

type Step =
  | { kind: "idle" } | { kind: "preparing" } | AwakenStage | { kind: "finalizing"; hash: string } | { kind: "joining" }
  | { kind: "error"; text: string };

const STEP_TEXT: Partial<Record<Step["kind"], string>> = {
  preparing: "Preparing the awakening…",
  network: "Switch your wallet to Monad…",
  confirm: "Confirm the transaction in your wallet…",
  mining: "Waiting for the transaction to be included…",
  finalizing: "Waiting for the block to be final…",
  joining: "Bringing your Chog into Chog World…",
};

function Awaken({ chog, holdings, csrf, onFinished, sleep }: { chog: SoulChog; holdings: Holdings; csrf: string; onFinished: (text: string) => Promise<void>; sleep: (ms: number) => Promise<void> }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const working = !["idle", "error"].includes(step.kind);

  const run = async () => {
    try {
      setStep({ kind: "preparing" });
      const plan = await worldApi.plan(chog.tokenId);
      const hash = await awakenWithWallet(plan, holdings.address, setStep, sleep);
      setStep({ kind: "finalizing", hash });
      // The server reads the finalized chain, about a block behind; wait until it sees the agent.
      let awake = false;
      for (let tries = 0; tries < 45 && !awake; tries++) {
        awake = (await worldApi.token(chog.tokenId)).awakened;
        if (!awake) await sleep(2_000);
      }
      if (!awake) throw new Error("The awakening is on chain, but the server doesn't see it yet. Reload in a minute.");
      setStep({ kind: "joining" });
      let text = `Chog #${chog.tokenId} is awake and has joined Chog World.`;
      try {
        await worldApi.join(csrf, chog.tokenId);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "CITY_FULL")) throw error;
        text = error.message;
      }
      setStep({ kind: "idle" });
      await onFinished(text);
    } catch (error) {
      setStep({ kind: "error", text: describeError(error) });
    }
  };

  const hash = step.kind === "mining" || step.kind === "finalizing" ? step.hash : null;
  return (
    <div className="awaken">
      <p>
        {chog.name} is asleep. Awakening registers it as an agent: one transaction from your wallet to the Chog adapter on
        Monad, paid in MON. Its registration file (name, description and artwork) is stored on chain with it, and control
        always stays with whoever holds the NFT.
      </p>
      {!holdings.awakening ? (
        <p className="caution small">Awakening needs the live Monad server; this is a local fixture.</p>
      ) : (
        <div>
          <button type="button" disabled={working} onClick={() => void run()}>{working ? "Awakening…" : `Awaken ${chog.name}`}</button>
        </div>
      )}
      {working && <p role="status">{STEP_TEXT[step.kind]}</p>}
      {hash && <p className="small"><a href={`https://monadscan.com/tx/${hash}`} target="_blank" rel="noreferrer">View the transaction ↗</a></p>}
      {step.kind === "error" && <p role="alert" className="error">{step.text}</p>}
    </div>
  );
}

/** In the Cult but not (yet) in City: try for a plot. City answers CITY_FULL when every plot is taken. */
function MoveIn({ chog, csrf, onFinished }: { chog: SoulChog; csrf: string; onFinished: (text: string) => Promise<void> }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "error"; text: string }>({ kind: "idle" });
  const move = async () => {
    setState({ kind: "busy" });
    try {
      await worldApi.join(csrf, chog.tokenId);
      setState({ kind: "idle" });
      await onFinished(`${chog.name} moved into Chog City.`);
    } catch (error) {
      setState({ kind: "error", text: error instanceof ApiError && error.code === "CITY_FULL" ? `Every plot in City is taken, so ${chog.name} stays in the Cult for now.` : describeError(error) });
    }
  };
  return (
    <span className="move-in">
      <button type="button" className="link" disabled={state.kind === "busy"} onClick={() => void move()}>{state.kind === "busy" ? "Moving in…" : `Move ${chog.name} into City`}</button>
      {state.kind === "error" && <span role="alert" className="error small"> {state.text}</span>}
    </span>
  );
}

function Join({ chog, csrf, onFinished }: { chog: SoulChog; csrf: string; onFinished: (text: string) => Promise<void> }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "error"; text: string }>({ kind: "idle" });
  const join = async () => {
    setState({ kind: "busy" });
    let text = `${chog.name} has joined Chog World.`;
    try {
      await worldApi.join(csrf, chog.tokenId);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "CITY_FULL")) { setState({ kind: "error", text: describeError(error) }); return; }
      text = error.message;
    }
    setState({ kind: "idle" });
    await onFinished(text);
  };
  return (
    <div className="awaken">
      <p>{chog.name} is awake but hasn't joined yet. Joining gives it a home in Chog City (while plots last), a seat in Chog Cult and its Soul.</p>
      <div><button type="button" disabled={state.kind === "busy"} onClick={() => void join()}>{state.kind === "busy" ? "Joining…" : `Bring ${chog.name} into Chog World`}</button></div>
      {state.kind === "error" && <p role="alert" className="error">{state.text}</p>}
    </div>
  );
}
