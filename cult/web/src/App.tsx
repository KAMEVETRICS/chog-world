import { useEffect, useState } from "react";
import { api, type SiteConfig } from "./api";
import { ChogTable, Factions, Feed, Places, PhaseBar } from "./components/Council";
import { OwnerPanel } from "./components/OwnerPanel";
import { useCult, useNow } from "./useCult";

const TABS = [["council", "Council"], ["factions", "Factions"], ["feed", "Feed"], ["mine", "Your Chogs"]] as const;
type Tab = (typeof TABS)[number][0];

export function App() {
  const { snapshot, feed, connection, error, refresh } = useCult();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [tab, setTab] = useState<Tab>("council");
  const now = useNow();
  useEffect(() => { api.config().then(setConfig).catch(() => setConfig(null)); }, []);

  return (
    <div className="app">
      <header className="top">
        <h1>Chog Cult</h1>
        {config && <span className={`mode mode-${config.mode}`}>{config.label}</span>}
        <nav className="site-nav" aria-label="Chog World Order">
          <a href="/">Home</a><a href="/soul/">Soul</a>{config?.city && <a href="/city/">City</a>}<a href="/cult/" aria-current="page">Cult</a>
        </nav>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {!snapshot ? <p role="status">Loading the council…</p> : (
        <>
          <PhaseBar snapshot={snapshot} now={now} connection={connection} />
          <nav className="tabs" aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <main className="layout">
            <div className="panel" data-active={tab === "council"}><Places snapshot={snapshot} /><ChogTable snapshot={snapshot} /></div>
            <div className="panel" data-active={tab === "factions"}><Factions snapshot={snapshot} /></div>
            <div className="panel" data-active={tab === "feed"}><Feed feed={feed} snapshot={snapshot} /></div>
            {config && <div className="panel" data-active={tab === "mine"}><OwnerPanel config={config} snapshot={snapshot} onChanged={() => { void refresh(); }} /></div>}
          </main>
        </>
      )}
    </div>
  );
}
