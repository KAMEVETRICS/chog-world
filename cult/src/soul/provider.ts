// Model providers behind Chog Soul. OpenRouter speaks the OpenAI-compatible chat API; tests use a fake.

export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
}

export interface ModelResult {
  readonly text: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** The provider's reported cost in USD, when it reports one. */
  readonly costUsd: number | null;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResult>;
}

export class ProviderError extends Error {
  override readonly name = "ProviderError";
}

export interface OpenRouterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Sent as HTTP-Referer and X-Title so OpenRouter can attribute usage to the app. */
  readonly appUrl?: string;
  readonly appName?: string;
}

/**
 * OpenRouter chat completions. One attempt per call, with a hard deadline: a retry could double the
 * project's model spend, and the caller refunds the holder on any failure anyway.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  readonly #options: Required<Omit<OpenRouterOptions, "appUrl">> & { appUrl: string | undefined };

  constructor(options: OpenRouterOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenRouter needs an API key.");
    this.#options = {
      apiKey: options.apiKey, model: options.model, baseUrl: (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      timeoutMs: options.timeoutMs ?? 20_000, appUrl: options.appUrl, appName: options.appName ?? "Chog World Order",
    };
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    const { apiKey, model, baseUrl, timeoutMs, appUrl, appName } = this.#options;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": appName,
          ...(appUrl ? { "http-referer": appUrl } : {}),
        },
        body: JSON.stringify({
          model, max_tokens: request.maxTokens, temperature: request.temperature ?? 0.8,
          messages: [{ role: "system", content: request.system }, ...request.messages],
          usage: { include: true },
        }),
      });
    } catch (error) {
      throw new ProviderError(`OpenRouter request failed: ${(error as Error).name === "TimeoutError" ? `no answer within ${timeoutMs} ms` : "network error"}.`);
    }
    const body = await response.json().catch(() => null) as {
      choices?: { message?: { content?: unknown } }[]; model?: unknown;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown }; error?: { message?: unknown };
    } | null;
    // Never echo the request or key; the provider's own message is enough to diagnose.
    if (!response.ok) throw new ProviderError(`OpenRouter returned HTTP ${response.status}: ${String(body?.error?.message ?? "no message").slice(0, 200)}`);
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new ProviderError("OpenRouter returned no text.");
    const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
    return {
      text, model: typeof body?.model === "string" ? body.model : model,
      promptTokens: count(body?.usage?.prompt_tokens), completionTokens: count(body?.usage?.completion_tokens),
      costUsd: typeof body?.usage?.cost === "number" ? body.usage.cost : null,
    };
  }
}

/** Removes markup and control characters, collapses whitespace and caps the length of model output. */
export function cleanOutput(text: string, maxChars: number): string {
  const plain = text
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_#>|~]+/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= maxChars ? plain : `${plain.slice(0, maxChars - 1).trimEnd()}…`;
}
