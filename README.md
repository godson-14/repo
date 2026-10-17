# GuardRail-Dev

A local Node.js/TypeScript safety guard for approximate AI API spend and runaway request frequency.

## Requirements
- Node.js 20+
- npm

## Install and test
```sh
npm install
npm test
```

## Quick start
```ts
import { initGuard } from "guardrail-dev";

const guard = await initGuard({
  maxDailySpend: 5,
  alertThreshold: 0.8,
  apiKeyProvider: "openai",
  model: "gpt-4o",
  maxOutputTokensPerRequest: 1024,
});

const guardedFetch = guard.wrapFetch(fetch);
const response = await guardedFetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
    max_completion_tokens: 256,
  }),
});
console.log(await guard.getUsage());
```

## Behaviour and limitations
- Stores daily aggregate request/token/cost totals in `.guardrail-cache.json`; never stores API keys.
- `wrapFetch(fetch)` estimates cost before likely AI requests and reconciles familiar non-streaming JSON usage fields after successful responses.
- When a model is known, it attempts to load the public LiteLLM pricing catalogue and caches it in memory. If unavailable, it uses clearly warned example fallback rates. Set `pricing: { inputPerMillion, outputPerMillion }` to supply known prices.
- A hard limit triggers a warning and, by default, `process.exit(1)`. Set `exitOnLimit: false` to receive a `GuardrailLimitError` instead.
- `maxRequestsPerMinute` adds an optional request-rate cap.
- Token counts before the response are rough estimates, not provider tokenization. Streaming, non-JSON, concurrent processes, and provider-specific billing adjustments are not fully accounted for. Keep provider-side billing limits enabled too.

## Options
- `maxDailySpend`: required daily budget in USD, greater than zero.
- `alertThreshold`: warning fraction from 0 to 1 (0.8 means 80%).
- `apiKeyProvider`: provider label such as openai, anthropic, or generic.
- `model`, `cachePath`, `pricing`, `maxRequestsPerMinute`, `maxOutputTokensPerRequest`, `exitOnLimit`, `exitHandler`, `onAlert`, `pricingSourceUrl`, `pricingTtlMs`, and `fetchImpl` are optional.

## License
MIT
