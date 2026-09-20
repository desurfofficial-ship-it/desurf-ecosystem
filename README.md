# Desurf Ecosystem v2.0

**Offline-first behavioral contract platform for prompts & agents.**

Faster · Typed judges (Jev-inspired) · Agent trajectories · Cut-point ready · Expanding ecosystem

## Packages

| Package | Purpose |
|---------|---------|
| `@desurf/core` | Pure engine: fingerprints, assertions, parallel runner |
| `@desurf/cli` | CLI: test, init, seal, record, diff, plugins, dashboard |
| `@desurf/sdk` | Embed `evaluateSuiteDir`, `assertBehavior`, `registerPlugin` |
| `@desurf/web` | Local dashboard (`packages/web/public`) |

## Quickstart

```bash
node packages/cli/dist/cli.js init my-suite
node packages/cli/dist/cli.js test --suite my-suite

# live record
export OPENROUTER_API_KEY=sk-...
node packages/cli/dist/cli.js record --suite my-suite --provider openrouter

# inspect
node packages/cli/dist/cli.js diff --suite my-suite --case <id>
node packages/cli/dist/cli.js plugins
node packages/cli/dist/cli.js dashboard
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | PASS |
| 1 | REGRESSION / FLAKY |
| 2 | ERROR (incl. stale sealed provenance) |

## Assertions

- Classic: `required`, `forbidden`, `regex`, `json_schema`
- Agent: `tool_call`, `trajectory`
- Jev-inspired: `confidence`, `choice` (threshold-gated)

## Examples (all green offline)

- `examples/support-agent` — classifier, RECORDED via OpenRouter
- `examples/agent-trajectory` — tool + trajectory contract
- `examples/multi-turn` — multi-turn conversation contract

## Ecosystem surface

- **SDK**: embed contracts in apps / agent harnesses
- **Plugins**: `registerPlugin()` for custom assertions & providers
- **Dashboard**: static UI — drop results JSON
- **CI**: `.github/workflows/desurf.yml`
- **Roadmap hooks**: real Jev provider, Chronicle cut-point runner, suite marketplace

## Principles

1. Offline path is pure and fast (ms-scale).
2. Provenance is sacred — sealed drift → ERROR.
3. Behavioral contracts > string equality.
4. Agent trajectories are first-class.
5. Ecosystem grows without breaking the core contract.

Trust is the product.
