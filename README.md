# Desurf Ecosystem v2.0

Offline-first behavioral contracts for prompts & agents.

## Packages
- `@desurf/core` — engine
- `@desurf/cli` — CLI
- `@desurf/reflex` — **zero-config LLM cassette interceptor** (the bet)
- `@desurf/sdk` — embed
- `@desurf/web` — dashboard

## Desurf Reflex (invented)
```js
import { installReflex } from '@desurf/reflex';
installReflex({ mode: 'auto' }); // DESURF_REFLEX=record|replay|auto
// every OpenAI-compatible fetch is now cassette-backed
```

## Contract Cards
Portable single-file `.desurfcard` = prompt + input + output + assertions + fingerprint.

## Quickstart
```bash
node packages/cli/dist/cli.js test --suite examples/support-agent
```

Exit codes: 0 PASS · 1 REGRESSION · 2 ERROR
