// Server mode: which world this is, wallet sign-in, and bringing your own awakened Chog into the village.
// Signing in only signs a message; nothing here sends a transaction.
import { useEffect, useId, useRef, useState } from 'react';
import type { AgentState } from '../../shared/contracts';
import { CityApiError, type HttpCityClient, type SiteInfo } from '../api/http-client';
import { shortAddress } from '../format';

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; message: string };

const messageOf = (error: unknown) =>
  error instanceof CityApiError || error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function AccountBar({
  client,
  site,
  me,
  onSession,
  onAdmitted,
  request,
}: {
  client: HttpCityClient;
  site: SiteInfo;
  me: string | null;
  onSession: (address: string | null) => void;
  onAdmitted: (agent: AgentState) => void;
  /** Asked from elsewhere (the welcome or a goal): sign in if needed, then maybe open "Bring a Chog". */
  request?: { n: number; bring: boolean };
}) {
  const [session, setSession] = useState<Status>({ kind: 'idle' });
  const [bringing, setBringing] = useState(false);
  const [tokenId, setTokenId] = useState('');
  const [arrival, setArrival] = useState<Status>({ kind: 'idle' });
  const formId = useId();
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    client.me().then(onSession, (error: unknown) => {
      onSession(null);
      setSession({ kind: 'error', message: `Couldn't check your sign-in. ${messageOf(error)}` });
    });
  }, [client, onSession]);

  const signIn = async () => {
    setSession({ kind: 'busy' });
    try {
      onSession(await client.signIn(site.chainIds[0]!));
      setSession({ kind: 'idle' });
      return true;
    } catch (error) {
      setSession({ kind: 'error', message: messageOf(error) });
      return false;
    }
  };

  const handled = useRef(0);
  useEffect(() => {
    if (!request || request.n === handled.current) return;
    handled.current = request.n;
    if (me) {
      if (request.bring) setBringing(true);
      return;
    }
    if (!site.login) return;
    void signIn().then((ok) => {
      if (ok && request.bring) setBringing(true);
    });
    // signIn reads only stable props; re-running on its identity would repeat the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, me, site.login]);

  const signOut = async () => {
    setBringing(false);
    try {
      await client.signOut();
      setSession({ kind: 'idle' });
    } catch (error) {
      setSession({ kind: 'error', message: `Signed out here, but the server didn't confirm it. ${messageOf(error)}` });
    }
    onSession(null);
  };

  const bring = async () => {
    const id = tokenId.trim();
    if (!/^[0-9]{1,6}$/.test(id)) {
      setArrival({ kind: 'error', message: 'Enter the token number of your Chog, like 1234.' });
      return;
    }
    setArrival({ kind: 'busy' });
    try {
      const agent = await client.admit(String(Number(id)));
      setArrival({ kind: 'done', message: `${agent.name} lives on plot ${agent.plotId.replace(/^p0*/, '')}.` });
      setTokenId('');
      onAdmitted(agent);
    } catch (error) {
      setArrival({ kind: 'error', message: messageOf(error) });
    }
  };

  return (
    <>
      <div className="hud hud-fixture hud-account hud-card" role="region" aria-label="Account" data-occluder>
        <span className="fixture-badge">{site.label}</span>
        {me ? (
          <>
            <span className="account-address mono" title={me}>
              {shortAddress(me)}
            </span>
            <button
              type="button"
              className="button button--quiet button--small"
              aria-expanded={bringing}
              aria-controls={formId}
              onClick={() => setBringing((open) => !open)}
            >
              Bring a Chog
            </button>
            <button type="button" className="button button--quiet button--small" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : site.login ? (
          <button
            type="button"
            className="button button--primary button--small"
            disabled={session.kind === 'busy'}
            onClick={() => void signIn()}
          >
            {session.kind === 'busy' ? 'Check your wallet…' : 'Sign in with wallet'}
          </button>
        ) : null}
      </div>

      {session.kind === 'error' ? (
        <p className="hud hud-alert" role="alert">
          {session.message}
        </p>
      ) : null}

      {me && bringing ? (
        <form
          id={formId}
          className="hud hud-card bring"
          aria-label="Bring a Chog into the village"
          onSubmit={(e) => {
            e.preventDefault();
            if (arrival.kind !== 'busy') void bring();
          }}
        >
          <label className="bring-label" htmlFor={inputId}>
            Chog Genesis token number
          </label>
          <p className="bring-hint" id={hintId}>
            It must be awakened and held by this wallet. It gets the next free plot and some wood, stone and food to start.
          </p>
          <div className="bring-row">
            <input
              id={inputId}
              className="bring-input num"
              inputMode="numeric"
              autoComplete="off"
              aria-describedby={hintId}
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
            />
            <button type="submit" className="button button--primary button--small" disabled={arrival.kind === 'busy'}>
              {arrival.kind === 'busy' ? 'Bringing…' : 'Bring it in'}
            </button>
          </div>
          {arrival.kind === 'error' ? (
            <p className="bring-error" role="alert">
              {arrival.message}
            </p>
          ) : null}
          {arrival.kind === 'done' ? (
            <p className="bring-done" role="status">
              {arrival.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
