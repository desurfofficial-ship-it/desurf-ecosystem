# Desurf at scale — big project readiness

## Goal
Use Desurf as the **offline behavioral regression gate** across a monorepo / multi-team product — same role as unit tests on the critical path.

## Shipped for scale (v2.5.1)

| Capability | How |
|------------|-----|
| Multi-suite | `desurf.config.json` + `desurf test --all` |
| Team policy | `"failUnsealed": true` or `--fail-unsealed` |
| Enterprise CI | `--junit report.xml` |
| PR visibility | `--summary` + `GITHUB_STEP_SUMMARY` |
| Incremental | `--changed` (only drifted seals) |
| Parallel | default on; `--no-parallel` to disable |
| Glob suites | `packages/*/contracts`, `apps/**/contracts` in config |
| Affected only | `desurf test --affected [--base origin/main]` |
| Windows paths | backslashes normalized to portable form |
| Path safety | containment, symlink check, size caps |

## Minimum setup (monorepo)

```bash
npm install -D desurf-cli
```

`desurf.config.json` at repo root:

```json
{
  "suites": ["packages/api/contracts", "packages/agent/contracts"],
  "failUnsealed": true,
  "junit": "reports/desurf.xml",
  "summary": true
}
```

CI:

```yaml
- run: npx desurf test --all --junit reports/desurf.xml --summary
```

## Must-fix / must-have before “default on every PR” in large orgs

### P0 — blockers for serious adoption
1. **Windows CI matrix** — path rules are POSIX-forward-slash by design; document or support `path.sep` normalization for Windows agents.
2. **Stable SDK publish** — `desurf-core` is the embed API; publish/docs for `runSuite` in custom runners (Nx/Bazel).
3. **Contract ownership** — CODEOWNERS pattern for `**/contracts/**` so prompt edits require review.
4. **No flaky confidence-as-gate** — policy: `json_schema` + `required`/`forbidden`/`choice` for merge gates; `confidence` advisory only.

### P1 — scale & ops
5. ~~Suite glob expansion~~ **Done** (`*` / `**` in config).
6. ~~Affected suites~~ **Done** (`--affected`); deeper Nx integration still optional.
7. **Baseline history** — keep last N sealed fingerprints; `desurf diff` across versions.
8. **Signed attestations** — optional offline-verifiable “this release passed suite X @ commit”.

### P2 — platform
9. **Python/Go runners** or language-agnostic cassette format CLI-only (today Node-first).
10. **Hosted policy pack** (commercial) — org-wide fail-unsealed, required assertion sets.

## What Desurf is *not* (on purpose)
- Not LangSmith/Braintrust (traces, LLM-as-judge UI)
- Not load testing
- Not prompt optimization

At scale, that focus is the feature: **a deterministic merge gate**.

## Recommended policy for big teams
1. Every production prompt/agent path has a sealed suite.
2. CI: `desurf test --all --fail-unsealed` required to merge.
3. Prompt PRs must update cassettes via `record`/`seal --force` with review.
4. Run `mutate` in a scheduled job (not necessarily blocking) to catch weak assertions.
5. JUnit uploaded to CI vendor for trend lines.

## Honest status
**Ready for:** Node/TS monorepos, GitHub Actions, structured outputs, agent trajectories.  
**Not yet default-everywhere until:** Windows verification, glob suites, SDK docs, and assertion policy guidance are institutionalized (P0/P1 above).
