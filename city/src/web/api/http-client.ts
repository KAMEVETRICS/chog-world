// The CityClient port over HTTP, for the village served by the Chog server (Cult and City in one origin).
// Same contracts as the fixture client: committed snapshots, CityEvent stream, fenced policy saves.
// Sign-in is SIWE with a browser wallet; the session is an HttpOnly cookie plus a per-tab CSRF token.
import type {
  ActionRefusal,
  ActionResult,
  AgentKey,
  CityAction,
  AgentState,
  CityClient,
  CityEvent,
  CityEventType,
  CitizenState,
  CitySnapshot,
  InstructionsRequest,
  InstructionsResult,
  DecorateRequest,
  JobRequest,
  JobResult,
  JoinRequest,
  JoinResult,
  DecorateResult,
  PolicyUpdateRequest,
  PolicyUpdateResult,
} from '../../shared/contracts';

/** What the server says about itself (`GET /api/cult/config`). */
export interface SiteInfo {
  mode: 'fixture' | 'live';
  label: string;
  chainIds: number[];
  login: boolean;
  city: boolean;
  /** Whether this server lets people without a Chog join as citizens yet. */
  citizens?: boolean;
}

/** A refusal or failure from the server, carrying a message fit to show. Status 0 means it wasn't reached. */
export class CityApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CityApiError';
  }
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const EVENT_TYPES: readonly CityEventType[] = [
  'city_tick', 'policy_changed', 'control_changed', 'resident_admitted', 'simulation_gap', 'home_decorated', 'citizen_joined', 'job_changed', 'params_changed', 'city_action', 'council',
];
const ACTION_REFUSALS = new Set<string>([
  'LOGIN_REQUIRED', 'NOT_A_CITIZEN', 'NOT_CONTROLLER', 'CONTROL_CHANGED', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'NOT_ENOUGH', 'NO_ROOM',
  'TREASURY_EMPTY', 'MARKET_EMPTY', 'NO_OFFER', 'OFFER_TAKEN', 'NOT_NEEDED', 'NOT_ALLOWED', 'CANT_VOTE_YET', 'VOTE_CLOSED', 'TOO_MANY_PROPOSALS',
]);
const JOIN_REFUSALS = new Set<string>(['LOGIN_REQUIRED', 'DISTRICT_FULL', 'IDEMPOTENCY_CONFLICT']);
const JOB_REFUSALS = new Set<string>(['LOGIN_REQUIRED', 'NOT_A_CITIZEN', 'JOB_CHANGED', 'IDEMPOTENCY_CONFLICT']);
const DECOR_REFUSALS = new Set<string>(['CONTROL_CHANGED', 'NOT_CONTROLLER', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'ALREADY_OWNED', 'DECOR_FULL', 'CANT_AFFORD']);
const POLICY_REFUSALS = new Set<string>(['POLICY_CHANGED', 'CONTROL_CHANGED', 'NOT_CONTROLLER', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT']);
// Shared with the Cult page, so signing in on either works for both in this tab.
const CSRF_KEY = 'chog-cult-csrf';

/** The CSRF token lives in this tab only; if storage is unavailable the holder signs in again after reload. */
const csrfStore = {
  get(): string | null {
    try {
      return sessionStorage.getItem(CSRF_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      sessionStorage.setItem(CSRF_KEY, token);
    } catch {
      /* per-tab convenience only */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(CSRF_KEY);
    } catch {
      /* per-tab convenience only */
    }
  },
};

/** One JSON request to the Chog server; a refusal or failure becomes a CityApiError. */
export async function call<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new CityApiError(0, 'NETWORK', "Can't reach the village right now.");
  }
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    throw new CityApiError(response.status, body?.error?.code ?? `HTTP_${response.status}`, body?.error?.message ?? `The request failed (${response.status}).`);
  }
  return body as T;
}

/** Headers for a state-changing request from the session signed in in this tab. */
export function guardHeaders(): Record<string, string> {
  const csrf = csrfStore.get();
  if (!csrf) throw new CityApiError(401, 'LOGIN_REQUIRED', 'Sign in with your wallet first.');
  return { 'x-csrf-token': csrf };
}

export async function fetchSite(): Promise<SiteInfo> {
  return call<SiteInfo>('/api/cult/config');
}

const hexOf = (text: string) => `0x${Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export interface HttpCityClientOptions {
  /** For tests; defaults to the browser's EventSource. */
  EventSource?: typeof EventSource;
}

export class HttpCityClient implements CityClient {
  readonly mode = 'server' as const;
  private readonly EventSourceImpl: typeof EventSource;

  constructor(options: HttpCityClientOptions = {}) {
    this.EventSourceImpl = options.EventSource ?? EventSource;
  }

  // ---- CityClient ------------------------------------------------------------------------

  getSnapshot(): Promise<CitySnapshot> {
    return call<CitySnapshot>('/api/city/snapshot');
  }

  async getAgent(key: AgentKey): Promise<AgentState | null> {
    try {
      return (await call<{ agent: AgentState }>(`/api/city/agents/${encodeURIComponent(key)}`)).agent;
    } catch (error) {
      if (error instanceof CityApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Residents whose last verified holder is the signed-in wallet; none for a visitor. */
  async getMyAgents(): Promise<AgentState[]> {
    if (!csrfStore.get()) return []; // not signed in in this tab: nothing to ask
    try {
      return (await call<{ agents: AgentState[] }>('/api/city/me/agents')).agents;
    } catch (error) {
      if (error instanceof CityApiError && error.status === 401) return [];
      throw error;
    }
  }

  async updatePolicy(key: AgentKey, request: PolicyUpdateRequest, idempotencyKey: string): Promise<PolicyUpdateResult> {
    try {
      const { agent } = await call<{ agent: AgentState }>(`/api/city/agents/${encodeURIComponent(key)}/policy`, {
        method: 'PATCH',
        body: request,
        headers: { ...this.guard(), 'idempotency-key': idempotencyKey },
      });
      return { ok: true, agent };
    } catch (error) {
      if (error instanceof CityApiError && POLICY_REFUSALS.has(error.code)) {
        return { ok: false, code: error.code as Exclude<PolicyUpdateResult, { ok: true }>['code'] };
      }
      throw error;
    }
  }

  async decorate(key: AgentKey, request: DecorateRequest, idempotencyKey: string): Promise<DecorateResult> {
    try {
      const { agent } = await call<{ agent: AgentState }>(`/api/city/agents/${encodeURIComponent(key)}/decor`, {
        method: 'POST',
        body: request,
        headers: { ...this.guard(), 'idempotency-key': idempotencyKey },
      });
      return { ok: true, agent };
    } catch (error) {
      if (error instanceof CityApiError && DECOR_REFUSALS.has(error.code)) {
        return { ok: false, code: error.code as Exclude<DecorateResult, { ok: true }>['code'] };
      }
      throw error;
    }
  }

  async getMyCitizen(): Promise<CitizenState | null> {
    if (!csrfStore.get()) return null;
    try {
      return (await call<{ citizen: CitizenState | null }>('/api/city/citizens/me')).citizen;
    } catch (error) {
      if (error instanceof CityApiError && (error.status === 401 || error.status === 404)) return null;
      throw error;
    }
  }

  async joinCity(request: JoinRequest, idempotencyKey: string): Promise<JoinResult> {
    try {
      const { citizen } = await call<{ citizen: CitizenState }>('/api/city/citizens', {
        method: 'POST',
        body: request,
        headers: { ...this.guard(), 'idempotency-key': idempotencyKey },
      });
      return { ok: true, citizen };
    } catch (error) {
      if (error instanceof CityApiError && JOIN_REFUSALS.has(error.code)) return { ok: false, code: error.code as Exclude<JoinResult, { ok: true }>['code'] };
      throw error;
    }
  }

  async setJob(request: JobRequest, idempotencyKey: string): Promise<JobResult> {
    try {
      const { citizen } = await call<{ citizen: CitizenState }>('/api/city/citizens/me/job', {
        method: 'PATCH',
        body: request,
        headers: { ...this.guard(), 'idempotency-key': idempotencyKey },
      });
      return { ok: true, citizen };
    } catch (error) {
      if (error instanceof CityApiError && JOB_REFUSALS.has(error.code)) return { ok: false, code: error.code as Exclude<JobResult, { ok: true }>['code'] };
      throw error;
    }
  }

  async act(action: CityAction, idempotencyKey: string): Promise<ActionResult> {
    try {
      await call('/api/city/actions', { method: 'POST', body: action, headers: { ...this.guard(), 'idempotency-key': idempotencyKey } });
      return { ok: true };
    } catch (error) {
      if (error instanceof CityApiError && ACTION_REFUSALS.has(error.code)) return { ok: false, code: error.code as ActionRefusal };
      throw error;
    }
  }

  /** Private to the holder: the server checks ownership on every read and write. */
  async getInstructions(key: AgentKey): Promise<string | null> {
    if (!csrfStore.get()) return null;
    try {
      return (await call<{ text: string | null }>(`/api/city/agents/${encodeURIComponent(key)}/instructions`)).text;
    } catch (error) {
      if (error instanceof CityApiError && [401, 403, 404].includes(error.status)) return null;
      throw error;
    }
  }

  async setInstructions(key: AgentKey, request: InstructionsRequest): Promise<InstructionsResult> {
    try {
      const { text } = await call<{ text: string }>(`/api/city/agents/${encodeURIComponent(key)}/instructions`, { method: 'PUT', body: request, headers: this.guard() });
      return { ok: true, text };
    } catch (error) {
      if (error instanceof CityApiError && ['NOT_CONTROLLER', 'CONTROL_CHANGED', 'NOT_FOUND', 'LOGIN_REQUIRED'].includes(error.code)) {
        return { ok: false, code: error.code as Exclude<InstructionsResult, { ok: true }>['code'] };
      }
      throw error;
    }
  }

  /** Follows the public event stream from `afterRevision`. The browser resumes with Last-Event-ID after a drop. */
  subscribe(afterRevision: string, onEvent: (event: CityEvent) => void, onReset: () => void): () => void {
    let last = BigInt(afterRevision);
    const source = new this.EventSourceImpl(`/api/city/events?after=${afterRevision}`);
    const deliver = (message: Event) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as CityEvent;
      const revision = BigInt(event.revision);
      if (revision <= last) return; // already seen
      last = revision;
      onEvent(event);
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, deliver);
    source.addEventListener('reset', (message) => {
      last = BigInt((JSON.parse((message as MessageEvent<string>).data) as { revision: string }).revision);
      onReset();
    });
    return () => source.close();
  }

  // ---- Holder session ----------------------------------------------------------------------

  /** The signed-in wallet, or null. A session from another tab needs a fresh sign-in here for its CSRF token. */
  async me(): Promise<string | null> {
    if (!csrfStore.get()) return null;
    try {
      return (await call<{ address: string }>('/api/me')).address;
    } catch (error) {
      if (error instanceof CityApiError && error.status === 401) {
        csrfStore.clear();
        return null;
      }
      throw error;
    }
  }

  /** Sign-In with Ethereum: the wallet signs the server's message; nothing is sent on chain. */
  async signIn(chainId: number): Promise<string> {
    const provider = window.ethereum;
    if (!provider) throw new CityApiError(0, 'NO_WALLET', 'No browser wallet found. Install one, or open this page in a wallet’s browser.');
    try {
      const [address] = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!address) throw new CityApiError(0, 'NO_ACCOUNT', 'The wallet did not share an account.');
      const { message } = await call<{ message: string }>('/api/auth/challenge', { method: 'POST', body: { address, chainId } });
      const signature = (await provider.request({ method: 'personal_sign', params: [hexOf(message), address] })) as string;
      const verified = await call<{ address: string; csrfToken: string }>('/api/auth/verify', { method: 'POST', body: { message, signature } });
      csrfStore.set(verified.csrfToken);
      return verified.address;
    } catch (error) {
      if ((error as { code?: unknown }).code === 4001) throw new CityApiError(0, 'CANCELLED', 'Sign-in was cancelled in the wallet.');
      throw error;
    }
  }

  /** Ends the human session. Chogs keep running on their saved settings. */
  async signOut(): Promise<void> {
    try {
      await call('/api/auth/logout', { method: 'POST', headers: this.guard() });
    } finally {
      csrfStore.clear();
    }
  }

  /** Brings the holder's awakened Chog into the village by token ID. Asking again returns the same resident. */
  async admit(tokenId: string): Promise<AgentState> {
    return (await call<{ agent: AgentState }>('/api/city/admissions', { method: 'POST', body: { tokenId }, headers: this.guard() })).agent;
  }

  private guard(): Record<string, string> {
    return guardHeaders();
  }
}
