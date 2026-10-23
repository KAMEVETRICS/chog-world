// The holder's controls for their Chog's bot: profile, where it may answer, a daily limit, the kill switch,
// a place to try each skill, and the log of everything it said.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api";
import { botApi, type BotActivity, type BotConfig, type BotSettings } from "./api";

const explain = (error: unknown) => (error instanceof ApiError ? error.message : "Something went wrong. Please try again.");

export function BotPanel({ agentKey, name, csrf, aiOn }: { agentKey: string; name: string; csrf: string; aiOn: boolean }) {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [saved, setSaved] = useState<(BotSettings & { epoch: string }) | null>(null);
  const [draft, setDraft] = useState<BotSettings | null>(null);
  const [serversText, setServersText] = useState("");
  const [activity, setActivity] = useState<readonly BotActivity[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const [nextConfig, { settings }, log] = await Promise.all([botApi.config(), botApi.settings(agentKey), botApi.activity(agentKey)]);
      setConfig(nextConfig); setSaved(settings); setDraft(settings); setServersText(settings.servers.join(", ")); setActivity(log.activity);
    } catch (error) { setStatus({ kind: "error", text: explain(error) }); }
  }, [agentKey]);
  useEffect(() => { void load(); }, [load]);
  if (!config || !saved || !draft) return <div className="bot"><h4>{name} as a bot</h4><p className="muted small" role="status">{status?.text ?? "Loading…"}</p></div>;
  const profile = config.profiles.find((p) => p.id === draft.profile)!;
  const servers = serversText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const changed = JSON.stringify({ ...draft, servers }) !== JSON.stringify({ enabled: saved.enabled, profile: saved.profile, channels: saved.channels, servers: saved.servers, dailyReplies: saved.dailyReplies });

  return (
    <div className="bot">
      <h4>{name} as a bot</h4>
      <p className="small muted">The same {name}, with the same character and memory, answering on Discord and to other agents. Each reply uses your credits ({aiOn ? "AI is on above" : "switch AI on above first"}). It can only talk: it never moves funds or changes settings.</p>
      <form className="consent" aria-label="Bot settings" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await botApi.save(csrf, agentKey, { ...draft, servers, expectedEpoch: saved.epoch });
          setStatus({ kind: "ok", text: "Saved." });
          await load();
        } catch (error) { setStatus({ kind: "error", text: explain(error) }); }
      }}>
        <label className="switch"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Bot on (the kill switch: off stops every public reply at once)</label>
        <fieldset className="bot-profiles">
          <legend>Profile</legend>
          {config.profiles.map((p) => (
            <label key={p.id} className="small">
              <input type="radio" name={`profile-${agentKey}`} value={p.id} checked={draft.profile === p.id} onChange={() => setDraft({ ...draft, profile: p.id })} /> <strong>{p.name}</strong>: {p.description}
            </label>
          ))}
        </fieldset>
        <p className="small muted">Skills: {profile.skills.map((id) => config.skills.find((s) => s.id === id)!.name).join(", ")}.</p>
        <label className="switch"><input type="checkbox" checked={draft.channels.discord} onChange={(e) => setDraft({ ...draft, channels: { ...draft.channels, discord: e.target.checked } })} /> Answer on Discord</label>
        <label className="small">Discord servers it may answer in (server IDs, comma-separated) <input type="text" value={serversText} onChange={(e) => setServersText(e.target.value)} /></label>
        <label className="small">Most public replies a day <input type="number" min={1} max={200} value={draft.dailyReplies} onChange={(e) => setDraft({ ...draft, dailyReplies: Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))) })} /></label>
        <button type="submit" disabled={!changed}>Save bot settings</button>
        {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind}>{status.text}</p>}
      </form>
      <TryIt agentKey={agentKey} name={name} csrf={csrf} config={config} skills={profile.skills} onDone={load} />
      <details className="bot-log">
        <summary>What {name} said ({activity.length})</summary>
        {activity.length === 0 ? <p className="small muted">Nothing yet. Only you can see this log; a buyer starts a fresh one.</p> : (
          <ol className="small">
            {activity.map((a, i) => (
              <li key={i}>
                <span className="muted">{new Date(a.createdAt).toLocaleString()} · {a.channel} · {a.skill}</span>
                <br />Asked: {a.input || "(nothing)"}
                <br />{a.outcome === "answered" ? `Said: ${a.reply}` : `Declined: ${a.reason}`}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

function TryIt({ agentKey, name, csrf, config, skills, onDone }: { agentKey: string; name: string; csrf: string; config: BotConfig; skills: readonly string[]; onDone: () => void }) {
  const [skill, setSkill] = useState(skills[0]!);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const chosen = skills.includes(skill) ? skill : skills[0]!;
  const info = config.skills.find((s) => s.id === chosen)!;
  return (
    <form className="bot-try" aria-label="Try the bot" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true); setAnswer(null);
      try {
        const result = await botApi.tryIt(csrf, agentKey, { skill: chosen, input });
        setAnswer("reply" in result ? { kind: "ok", text: result.reply } : { kind: "error", text: result.message });
        onDone();
      } catch (error) { setAnswer({ kind: "error", text: explain(error) }); } finally { setBusy(false); }
    }}>
      <h5>Try it</h5>
      <label className="small">Skill <select value={chosen} onChange={(e) => setSkill(e.target.value)}>{skills.map((id) => <option key={id} value={id}>{config.skills.find((s) => s.id === id)!.name}</option>)}</select></label>
      <label className="small">{info.input} <textarea rows={chosen === "summarize" ? 5 : 2} maxLength={info.maxInput} value={input} onChange={(e) => setInput(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? `${name} is thinking…` : `Ask ${name}`}</button>
      {answer && <p role={answer.kind === "error" ? "alert" : "status"} className={answer.kind === "ok" ? "bubble chog" : "error"}>{answer.text}</p>}
    </form>
  );
}
