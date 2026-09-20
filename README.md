# Desurf Ecosystem

**Prompts and agents are code. Desurf is the regression suite that runs offline in CI.**

[![npm desurf-cli](https://img.shields.io/npm/v/desurf-cli.svg)](https://www.npmjs.com/package/desurf-cli)
[![npm desurf-core](https://img.shields.io/npm/v/desurf-core.svg)](https://www.npmjs.com/package/desurf-core)

Offline-first behavioral contracts for LLM prompts and agents. Sealed provenance. Honest exit codes. No API key on the merge gate.

## Install

```bash
npm install -g desurf-cli
# or
npx desurf-cli
```

Packages: `desurf-cli` · `desurf-core` · `desurf-reflex`

## 60-second CI gate

```bash
desurf init ./contracts
desurf test --suite ./contracts
# 0 = PASS · 1 = REGRESSION · 2 = ERROR (stale sealed / policy)
```

GitHub Actions: copy [`.github/workflows/desurf-contracts.yml`](.github/workflows/desurf-contracts.yml).

## Why teams use it

| Problem | Desurf |
|---------|--------|
| Model silent-updates | Sealed fingerprint → ERROR on drift |
| Prompt tweaks ship untested | Cassette + assertions on every PR |
| Agent tool regressions | `tool_call` / `trajectory` assertions |
| Eval platforms need keys + $ | Offline path is pure and free |

## Commands

```
desurf test    --suite <dir> [--json] [--fail-unsealed] [--case <id>]
desurf init    <dir>
desurf seal    --suite <dir> [--force]
desurf record  --suite <dir> --provider openrouter
desurf doctor  --suite <dir>     # health + security
desurf mutate  --suite <dir>     # invent adversarial cases
desurf badge   --suite <dir>     # README badge markdown
desurf plugins
desurf version
```

## Reflex (zero-config interceptor)

```bash
npm install desurf-reflex
```

```js
import { installReflex } from 'desurf-reflex'
installReflex({ mode: 'auto' }) // DESURF_REFLEX=record|replay|auto
```

## Commercial

- **OSS**: full offline engine, CLI, Reflex, doctor, mutate — free forever for individuals.
- **Team / Business** (roadmap): shared suite registry, signed run attestations, scheduled live drift canaries, policy packs.

Trust is the product. Contact: desurf.official@gmail.com

## License

MIT
