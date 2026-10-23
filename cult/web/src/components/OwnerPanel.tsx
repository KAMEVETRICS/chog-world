import { useCallback, useEffect, useState } from "react";
import { FACTIONS, PLACES, SWITCH_COOLDOWN_CYCLES, decreesFor, type FactionId, type Place, type Stance } from "../../../src/rules";
import { ApiError, api, type Me, type MyChog, type SiteConfig, type SnapshotDto } from "../api";
import { PLACE_NAMES, decreeTitle, factionName } from "../describe";
import { csrfStore, signInWithWallet, walletAvailable } from "../wallet";
import { PersonaCard, SoulPanel } from "../soul/SoulPanel";

const ERROR_TEXT: Record<string, string> = {
  SWITCH_COOLDOWN: "This Chog changed faction recently.",
  CONTROL_CHANGED: "This Chog changed hands since you loaded it. The panel has been refreshed.",
  NOT_CONTROLLER: "Your wallet no longer holds this Chog.",
  OWNERSHIP_UNAVAILABLE: "Ownership can't be checked right now. Try again in a moment.",
  VOTING_CLOSED: "Voting is closed for this cycle.",
  NOT_ELIGIBLE: "This Chog can't vote this cycle.",
  LOGIN_REQUIRED: "Your session ended. Sign in again.",
  CSRF_FAILED: "Your session needs refreshing. Sign in again.",
  RATE_LIMITED: "Too many changes. Wait a minute and try again.",
};

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    const known = ERROR_TEXT[error.code];
    if (!known) return error.message;
    // The cooldown message from the server names the cycle when the Chog can change again.
    return error.code === "SWITCH_COOLDOWN" ? `${known} ${error.message}` : known;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function OwnerPanel({ config, snapshot, onChanged }: { config: SiteConfig; snapshot: SnapshotDto; onChanged: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [csrf, setCsrf] = useState<string | null>(() => csrfStore.get());
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMe = useCallback(async () => {
    const next = await api.me();
    setMe(next);
    if (!next) { csrfStore.clear(); setCsrf(null); }
    return next;
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);
  // Re-read holdings whenever the council moves on, so transfers show up without a reload.
  useEffect(() => { if (me) void loadMe(); }, [snapshot.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ kind: "ok", text: await work() });
    } catch (error) {
      setStatus({ kind: "error", text: explain(error) });
      if (error instanceof ApiError && ["LOGIN_REQUIRED", "CSRF_FAILED"].includes(error.code)) { csrfStore.clear(); setCsrf(null); setMe(null); }
    } finally {
      await loadMe().catch(() => {});
      onChanged();
      setBusy(false);
    }
  };

  if (!config.login) return null;

  if (!me || !csrf) {
    const chainId = config.chainIds[0];
    return (
      <section aria-labelledby="owner-heading" className="owner">
        <h2 id="owner-heading">Your Chogs</h2>
        <p>Sign in with the wallet that holds your Chog to choose its faction and votes. Signing only proves you hold the address; it sends no transaction and costs nothing.</p>
        <button type="button" disabled={busy || !walletAvailable() || chainId === undefined}
          onClick={() => run(async () => {
            const signed = await signInWithWallet(async (address) => (await api.challenge(address, chainId!)).message);
            const session = await api.verify(signed.message, signed.signature);
            csrfStore.set(session.csrfToken);
            setCsrf(session.csrfToken);
            return "Signed in.";
          })}>
          Sign in with wallet
        </button>
        {!walletAvailable() && <p className="muted small">No browser wallet detected.</p>}
        {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind}>{status.text}</p>}
      </section>
    );
  }

  const chog = me.chogs.find((entry) => entry.agentKey === selected) ?? me.chogs[0] ?? null;
  return (
    <section aria-labelledby="owner-heading" className="owner">
      <h2 id="owner-heading">Your Chogs</h2>
      <p className="muted small">Signed in as <code>{me.address.slice(0, 6)}…{me.address.slice(-4)}</code>.{" "}
        <button type="button" className="link" onClick={() => run(async () => { await api.logout(csrf); csrfStore.clear(); setCsrf(null); setMe(null); return "Signed out. Your Chogs keep their settings."; })}>Sign out</button>
      </p>
      {me.chogs.length === 0 ? <p>This wallet doesn't hold any Chogs in the council.</p> : (
        <>
          {me.chogs.length > 1 && (
            <fieldset className="chog-picker">
              <legend>Chog</legend>
              {me.chogs.map((entry) => (
                <label key={entry.agentKey}><input type="radio" name="chog" checked={entry.agentKey === chog?.agentKey} onChange={() => setSelected(entry.agentKey)} /> {entry.name}</label>
              ))}
            </fieldset>
          )}
          {chog && <ChogSettings key={`${chog.agentKey}:${chog.ownershipEpoch}`} chog={chog} snapshot={snapshot} busy={busy} run={run} csrf={csrf} />}
        </>
      )}
      {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind}>{status.text}</p>}
    </section>
  );
}

function ChogSettings({ chog, snapshot, busy, run, csrf }: { chog: MyChog; snapshot: SnapshotDto; busy: boolean; run: (work: () => Promise<string>) => Promise<void>; csrf: string }) {
  const [faction, setFaction] = useState<FactionId | "">(chog.faction ?? "");
  // Joining a faction makes the agent vote by persona unless the holder picks abstain.
  const [stance, setStance] = useState<Stance>(chog.faction ? chog.stance : "persona");
  const member = snapshot.members.find((entry) => entry.agentKey === chog.agentKey);
  const eligible = chog.faction !== null && chog.joinedCycle !== null && chog.joinedCycle < snapshot.cycle && chog.control === "verified";
  const changingFaction = (faction || null) !== chog.faction;

  return (
    <div className="settings">
      <h3>{chog.name}</h3>
      <PersonaCard agentKey={chog.agentKey} />
      <form onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api.setMembership(csrf, chog.agentKey, { ...(changingFaction ? { faction: faction || null } : {}), ...(faction ? { stance } : {}), expectedEpoch: chog.ownershipEpoch });
          return "Saved.";
        });
      }}>
        <label>Faction
          <select value={faction} onChange={(event) => setFaction(event.target.value as FactionId | "")}>
            <option value="">Unaligned</option>
            {FACTIONS.map((id) => <option key={id} value={id}>{factionName(id)}</option>)}
          </select>
        </label>
        {faction !== "" && (
          <fieldset>
            <legend>How it votes</legend>
            <label><input type="radio" name="stance" checked={stance === "persona"} onChange={() => setStance("persona")} /> Let its agent vote, guided by its traits</label>
            <label><input type="radio" name="stance" checked={stance === "abstain"} onChange={() => setStance("abstain")} /> Abstain unless I choose</label>
          </fieldset>
        )}
        {changingFaction && <p className="caution small">Changing faction starts a {SWITCH_COOLDOWN_CYCLES}-cycle wait before the next change. A new member votes from the next cycle.</p>}
        <button type="submit" disabled={busy || (!changingFaction && (faction === "" || stance === chog.stance))}>Save</button>
      </form>

      {chog.faction && (
        <div className="votes">
          <h4>This cycle's votes</h4>
          {!eligible ? <p className="muted small">{chog.control !== "verified" ? "Ownership can't be checked right now." : "This Chog votes from the cycle after it joined."}</p>
            : snapshot.phase !== "vote" ? <p className="muted small">You can change votes during the Vote phase.</p>
            : PLACES.map((place) => <VoteRow key={place} place={place} chog={chog} cycle={snapshot.cycle} current={member?.currentVotes.find((vote) => vote.place === place) ?? null} busy={busy} run={run} csrf={csrf} />)}
        </div>
      )}
      <SoulPanel key={`soul:${chog.agentKey}:${chog.ownershipEpoch}`} agentKey={chog.agentKey} name={chog.name} csrf={csrf} />
    </div>
  );
}

function VoteRow({ place, chog, cycle, current, busy, run, csrf }: { place: Place; chog: MyChog; cycle: number; current: { decreeId: string | null; source: string } | null; busy: boolean; run: (work: () => Promise<string>) => Promise<void>; csrf: string }) {
  const [choice, setChoice] = useState<string>(current?.decreeId ?? "");
  const id = `vote-${place}`;
  return (
    <div className="vote-row">
      <label htmlFor={id}>{PLACE_NAMES[place]}</label>
      <select id={id} value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="">Abstain</option>
        {decreesFor(chog.faction!, place).map((decree) => <option key={decree.id} value={decree.id}>{decree.title}</option>)}
      </select>
      <button type="button" disabled={busy || choice === (current?.decreeId ?? "")}
        onClick={() => run(async () => { await api.vote(csrf, cycle, chog.agentKey, place, choice || null, chog.ownershipEpoch); return `${PLACE_NAMES[place]} vote saved.`; })}>
        Vote
      </button>
      <span className="muted small">{current ? `Now: ${decreeTitle(current.decreeId)} (${current.source === "holder" ? "your choice" : "agent"})` : "No vote yet"}</span>
    </div>
  );
}
