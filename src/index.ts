import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}
export interface GuardrailOptions {
  maxDailySpend: number;
  alertThreshold: number;
  apiKeyProvider: string;
  model?: string;
  cachePath?: string;
  pricing?: TokenPricing;
  maxRequestsPerMinute?: number;
  maxOutputTokensPerRequest?: number;
  exitOnLimit?: boolean;
  exitHandler?: (code: number) => void;
  onAlert?: (message: string) => void;
  pricingSourceUrl?: string;
  pricingTtlMs?: number;
  fetchImpl?: typeof fetch;
}
export interface RequestUsage {
  inputTokens?: number;
  outputTokens?: number;
  actualCostUsd?: number;
  model?: string;
  reservedEstimateUsd?: number;
}
export interface UsageRecord {
  date: string;
  requests: number;
  estimatedSpendUsd: number;
  inputTokens: number;
  outputTokens: number;
  minuteBucket: string;
  requestsThisMinute: number;
  lastUpdatedAt: string;
}
export class GuardrailLimitError extends Error {
  readonly code = "GUARDRAIL_LIMIT_EXCEEDED";
  constructor(message: string) { super(message); this.name = "GuardrailLimitError"; }
}
const FALLBACK: Record<string, TokenPricing> = {
  openai: { inputPerMillion: 2.5, outputPerMillion: 10 },
  anthropic: { inputPerMillion: 3, outputPerMillion: 15 },
  generic: { inputPerMillion: 2.5, outputPerMillion: 10 }
};
const CATALOG_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
type CatalogEntry = { input_cost_per_token?: number; output_cost_per_token?: number };
let catalog: Record<string, CatalogEntry> | undefined;
let catalogAt = 0;
function today(): string { return new Date().toISOString().slice(0, 10); }
function minute(): string { return new Date().toISOString().slice(0, 16); }
function numberAtLeastZero(n: number | undefined, name: string): number {
  const value = n ?? 0;
  if (!Number.isFinite(value) || value < 0) throw new TypeError(name + " must be a finite non-negative number");
  return value;
}
async function pricingFor(options: GuardrailOptions, model?: string): Promise<TokenPricing> {
  if (options.pricing) return options.pricing;
  const ttl = options.pricingTtlMs ?? 21_600_000;
  if (!catalog || Date.now() - catalogAt >= ttl) {
    try {
      const response = await (options.fetchImpl ?? fetch)(options.pricingSourceUrl ?? CATALOG_URL, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error("Pricing catalogue HTTP " + response.status);
      const data = await response.json() as unknown;
      if (data && typeof data === "object" && !Array.isArray(data)) { catalog = data as Record<string, CatalogEntry>; catalogAt = Date.now(); }
    } catch { /* Fall back to estimates if the public catalogue is unavailable. */ }
  }
  const entry = model ? catalog?.[model] ?? Object.entries(catalog ?? {}).find(([k]) => k.toLowerCase().endsWith("/" + model.toLowerCase()))?.[1] : undefined;
  if (entry && Number.isFinite(entry.input_cost_per_token) && Number.isFinite(entry.output_cost_per_token)) {
    return { inputPerMillion: entry.input_cost_per_token! * 1_000_000, outputPerMillion: entry.output_cost_per_token! * 1_000_000 };
  }
  (options.onAlert ?? console.warn)(`[GuardRail-Dev] Pricing estimate is using fallback example rates for ${options.apiKeyProvider}; check your provider's current pricing.`);
  return FALLBACK[options.apiKeyProvider.toLowerCase()] ?? FALLBACK.generic!;
}
async function atomicWrite(file: string, data: string): Promise<void> {
  const resolved = path.resolve(file);
  await mkdir(path.dirname(resolved), { recursive: true });
  const tmp = resolved + "." + process.pid + ".tmp";
  await writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, resolved);
}
function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  return Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);
}
export class Guardrail {
  private usage: UsageRecord;
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly options: GuardrailOptions & { cachePath: string; alertThreshold: number; maxRequestsPerMinute: number; maxOutputTokensPerRequest: number; exitOnLimit: boolean };
  constructor(options: GuardrailOptions) {
    if (!Number.isFinite(options.maxDailySpend) || options.maxDailySpend <= 0) throw new TypeError("maxDailySpend must be greater than zero");
    if (!options.apiKeyProvider?.trim()) throw new TypeError("apiKeyProvider must be a non-empty string");
    const threshold = options.alertThreshold ?? 0.8;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new TypeError("alertThreshold must be between 0 and 1");
    if (options.pricing && [options.pricing.inputPerMillion, options.pricing.outputPerMillion].some(v => !Number.isFinite(v) || v < 0)) throw new TypeError("pricing values must be non-negative");
    this.options = { ...options, cachePath: options.cachePath ?? "./.guardrail-cache.json", alertThreshold: threshold, maxRequestsPerMinute: options.maxRequestsPerMinute ?? Number.MAX_SAFE_INTEGER, maxOutputTokensPerRequest: options.maxOutputTokensPerRequest ?? 1024, exitOnLimit: options.exitOnLimit ?? true };
    this.usage = this.emptyUsage();
  }
  private emptyUsage(): UsageRecord {
    return { date: today(), requests: 0, estimatedSpendUsd: 0, inputTokens: 0, outputTokens: 0, minuteBucket: minute(), requestsThisMinute: 0, lastUpdatedAt: new Date().toISOString() };
  }
  private async persist(): Promise<void> {
    this.usage.lastUpdatedAt = new Date().toISOString();
    const snapshot = JSON.stringify(this.usage, null, 2);
    this.queue = this.queue.then(() => atomicWrite(this.options.cachePath, snapshot));
    await this.queue;
  }
  private async load(): Promise<void> {
    if (this.loaded) {
      if (this.usage.date !== today()) { this.usage = this.emptyUsage(); await this.persist(); }
      return;
    }
    try {
      const raw = await readFile(this.options.cachePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UsageRecord>;
      if (parsed.date === today() && Number.isFinite(parsed.estimatedSpendUsd) && parsed.estimatedSpendUsd! >= 0) this.usage = { ...this.emptyUsage(), ...parsed } as UsageRecord;
      else this.usage = this.emptyUsage();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read GuardRail cache: " + (error as Error).message);
      this.usage = this.emptyUsage();
    }
    this.loaded = true;
    await this.persist();
  }
  private alert(message: string): void { (this.options.onAlert ?? console.warn)(`\u001b[33m\u001b[1m[GuardRail-Dev]\u001b[0m ${message}`); }
  private stop(message: string): never {
    this.alert("BLOCKED: " + message);
    if (this.options.exitOnLimit) {
      if (this.options.exitHandler) this.options.exitHandler(1);
      else process.exit(1);
    }
    throw new GuardrailLimitError(message);
  }
  private enforce(): void {
    if (this.usage.estimatedSpendUsd >= this.options.maxDailySpend) this.stop("Daily spend limit reached.");
    if (this.usage.requestsThisMinute > this.options.maxRequestsPerMinute) this.stop("Request rate limit exceeded.");
    if (this.usage.estimatedSpendUsd >= this.options.maxDailySpend * this.options.alertThreshold) this.alert(`Spend warning: $${this.usage.estimatedSpendUsd.toFixed(4)} of $${this.options.maxDailySpend.toFixed(2)} daily limit.`);
  }
  async beforeRequest(estimatedCostUsd = 0): Promise<void> {
    await this.load();
    const estimate = numberAtLeastZero(estimatedCostUsd, "estimatedCostUsd");
    if (this.usage.minuteBucket !== minute()) { this.usage.minuteBucket = minute(); this.usage.requestsThisMinute = 0; }
    this.enforce();
    if (this.usage.estimatedSpendUsd + estimate >= this.options.maxDailySpend) this.stop("Estimated request would reach the daily spend limit.");
    this.usage.requests++;
    this.usage.requestsThisMinute++;
    this.usage.estimatedSpendUsd += estimate;
    await this.persist();
    this.enforce();
  }
  async recordUsage(record: RequestUsage): Promise<UsageRecord> {
    await this.load();
    const inputTokens = numberAtLeastZero(record.inputTokens, "inputTokens");
    const outputTokens = numberAtLeastZero(record.outputTokens, "outputTokens");
    const actual = record.actualCostUsd === undefined ? undefined : numberAtLeastZero(record.actualCostUsd, "actualCostUsd");
    const pricing = await pricingFor(this.options, record.model ?? this.options.model);
    const cost = actual ?? (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000;
    const reserved = numberAtLeastZero(record.reservedEstimateUsd, "reservedEstimateUsd");
    this.usage.estimatedSpendUsd = Math.max(0, this.usage.estimatedSpendUsd - reserved) + cost;
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    await this.persist();
    this.enforce();
    return this.getUsage();
  }
  async getUsage(): Promise<UsageRecord> { await this.load(); return { ...this.usage }; }
  wrapFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
    const guard = this;
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let body: any = init?.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      else if (body == null && input instanceof Request) { try { body = await input.clone().json(); } catch { body = {}; } }
      const url = input instanceof Request ? input.url : String(input);
      const model = typeof body?.model === "string" ? body.model : guard.options.model;
      const likelyAI = Boolean(model) || /openai|anthropic|generativelanguage|api\.cohere|mistral/i.test(url);
      let reserved = 0;
      if (likelyAI) {
        const text = body?.messages ?? body?.input ?? body?.prompt ?? body ?? "";
        const inTokens = estimateTokens(text);
        const outTokens = Number(body?.max_completion_tokens ?? body?.max_tokens ?? body?.max_output_tokens ?? guard.options.maxOutputTokensPerRequest);
        const pricing = await pricingFor(guard.options, model);
        reserved = (inTokens * pricing.inputPerMillion + outTokens * pricing.outputPerMillion) / 1_000_000;
      }
      await guard.beforeRequest(reserved);
      const response = await fetchImpl(input, init);
      if (likelyAI && response.ok) {
        try {
          const usage = (await response.clone().json() as any)?.usage;
          if (usage) await guard.recordUsage({ model, inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0), actualCostUsd: typeof usage.cost === "number" ? usage.cost : undefined, reservedEstimateUsd: reserved });
        } catch (error) {
          if (error instanceof GuardrailLimitError) throw error;
          guard.alert("Could not reconcile provider usage; keeping the preflight estimate.");
        }
      }
      return response;
    }) as typeof fetch;
  }
}
export async function initGuard(options: GuardrailOptions): Promise<Guardrail> {
  const guard = new Guardrail(options);
  await guard.getUsage();
  return guard;
}
