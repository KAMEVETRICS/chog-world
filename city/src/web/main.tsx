import { lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { FixtureCityClient } from '../fixtures/fixture-client';
import { App } from './App';
import { fetchSite, HttpCityClient } from './api/http-client';
import './tokens.css';

// `vite --mode server` and `build:server` follow the Chog server (wallet sign-in, live ownership);
// plain `dev:web` runs the fixture village in the browser.
const serverMode = import.meta.env.MODE === 'server';

const ChogPreview = lazy(() => import('./world3d/ChogPreview'));
const preview = new URLSearchParams(window.location.search).get('preview') === 'chog';

// No StrictMode: its dev-only double mount orphans drei <Html> overlays in the 3D scene,
// and production never double-mounts, so development now matches what players see.
const root = createRoot(document.getElementById('root')!);
const show = (node: ReactNode) => root.render(node);
const notice = (message: string) =>
  show(
    <div className="loading" role="alert">
      <p>{message}</p>
    </div>,
  );

if (preview) {
  show(
    <Suspense fallback={null}>
      <ChogPreview />
    </Suspense>,
  );
} else if (serverMode) {
  fetchSite().then(
    (site) => (site.city ? show(<App client={new HttpCityClient()} server={{ site }} />) : notice("This server isn't running Chog City.")),
    () => notice("Can't reach the village right now. Reload to try again."),
  );
} else {
  show(<App client={new FixtureCityClient()} />);
}
