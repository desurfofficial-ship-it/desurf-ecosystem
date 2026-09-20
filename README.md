# Desurf

**Prompts and agents are code. Desurf is the regression suite that runs offline in CI.**

[![npm](https://img.shields.io/npm/v/desurf-cli.svg)](https://www.npmjs.com/package/desurf-cli)

## 60-second start

```bash
npm install -g desurf-cli
desurf init ./contracts
desurf test --suite ./contracts          # exit 0 in a few ms
# edit contracts/prompts/*.txt
desurf test --suite ./contracts          # sealed drift → exit 2
```

No API key on the merge gate. Sealed cassettes + assertions = behavioral contracts.

## Install

```bash
npm install desurf-cli
# pulls desurf-core automatically
npx desurf version
# → desurf-cli 2.4.0 (engine 2.3.0)
```

## Commands

| Command | Purpose |
|---------|---------|
| `test --suite <dir>` | Run contracts (`--json` `--fail-unsealed` `--changed` `--case`) |
| `init <dir>` | Example sealed suite |
| `seal` / `record` | Refresh provenance / capture live |
| `doctor` | Health + security audit |
| `mutate [--apply]` | Invent adversarial cases (optionally replace suite.json) |
| `badge` | README shields.io snippet |

**Exit codes:** `0` PASS · `1` REGRESSION · `2` ERROR (stale seal, policy, bad config)

## CI

See [`.github/workflows/desurf-contracts.yml`](.github/workflows/desurf-contracts.yml).

```yaml
- run: npm install -g desurf-cli
- run: desurf test --suite ./contracts --fail-unsealed
```

## Packages

| Package | Role |
|---------|------|
| [desurf-cli](https://www.npmjs.com/package/desurf-cli) | CLI binary `desurf` |
| [desurf-core](https://www.npmjs.com/package/desurf-core) | Engine |
| [desurf-reflex](https://www.npmjs.com/package/desurf-reflex) | Zero-config fetch interceptor |

## License

MIT
