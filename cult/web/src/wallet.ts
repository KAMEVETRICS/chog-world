interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window { ethereum?: Eip1193Provider }
}

export function walletAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/** Asks the browser wallet for an account, then for a personal_sign signature over `makeMessage(address)`. */
export async function signInWithWallet(makeMessage: (address: string) => Promise<string>): Promise<{ address: string; message: string; signature: string }> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No browser wallet found. Install one, or open this page in a wallet's browser.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet did not share an account.");
  const message = await makeMessage(address);
  const hex = `0x${Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signature = (await provider.request({ method: "personal_sign", params: [hex, address] })) as string;
  return { address, message, signature };
}

const CSRF_KEY = "chog-cult-csrf";

/** The CSRF token lives in this tab only; if storage is unavailable the holder signs in again after reload. */
export const csrfStore = {
  get(): string | null { try { return sessionStorage.getItem(CSRF_KEY); } catch { return null; } },
  set(token: string): void { try { sessionStorage.setItem(CSRF_KEY, token); } catch { /* per-tab convenience only */ } },
  clear(): void { try { sessionStorage.removeItem(CSRF_KEY); } catch { /* per-tab convenience only */ } },
};
