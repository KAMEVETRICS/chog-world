// Sends an awakening from the holder's own browser wallet: the right account, on Monad, then waits for the receipt.
// The server only prepared the call (see /api/soul/awaken); nothing here signs on anyone else's behalf.
import { ApiError } from "../api";
import type { AwakenPlan } from "./world";

export type AwakenStage = { readonly kind: "network" } | { readonly kind: "confirm" } | { readonly kind: "mining"; readonly hash: string };

export class WalletError extends Error {}

export const MONAD_MAINNET = {
  chainId: "0x8f", chainName: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: ["https://rpc.monad.xyz"], blockExplorerUrls: ["https://monadscan.com"],
};

export const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorCode = (error: unknown) => (error as { code?: unknown } | null)?.code;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Returns the transaction hash once it is included with success. */
export async function awakenWithWallet(plan: AwakenPlan, address: string, onStage: (stage: AwakenStage) => void, sleep = sleepFor): Promise<string> {
  const provider = window.ethereum;
  if (!provider) throw new WalletError("No browser wallet found. Install one, or open this page in a wallet's browser.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts.find((account) => account.toLowerCase() === address.toLowerCase());
  if (!from) throw new WalletError(`Switch your wallet to the account you signed in with (${short(address)}).`);

  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (BigInt(current) !== BigInt(plan.chainId)) {
    onStage({ kind: "network" });
    const chainId = `0x${plan.chainId.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      // 4902: the wallet doesn't know Monad yet.
      if (errorCode(error) !== 4902 || chainId !== MONAD_MAINNET.chainId) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [MONAD_MAINNET] });
    }
  }

  onStage({ kind: "confirm" });
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from, to: plan.to, data: plan.data }] })) as string;
  onStage({ kind: "mining", hash });
  for (let waited = 0; waited <= 180_000; waited += 1_500) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x1") return hash;
      throw new WalletError("The awakening transaction failed on chain. Reload the page: the Chog may already be awake, or may have moved to another wallet.");
    }
    await sleep(1_500);
  }
  throw new WalletError("The transaction hasn't been included after three minutes. Check your wallet; once it's included, reload this page.");
}

export function describeError(error: unknown): string {
  if (errorCode(error) === 4001) return "You cancelled it in your wallet. Nothing was sent.";
  if (error instanceof WalletError || error instanceof ApiError) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "Something went wrong. Please try again.";
}
