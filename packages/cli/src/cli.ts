#!/usr/bin/env node
/**
 * Desurf Ecosystem CLI v2.0
 * Offline-first • Parallel • Typed judges (Jev-inspired) • Agent trajectories
 */
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, resolve, relative, dirname } from "node:path";
import {
  runSuite,
  makeFingerprint,
  checkDrift,
  VERSION,
  type Suite,
  type TestCase,
  containPath,
} from "desurf-core";

/** CLI package version — keep in sync with packages/cli/package.json */
const CLI_VERSION = "2.5.4";

type DesurfConfig = {
  suites?: string[];
  failUnsealed?: boolean;
  parallel?: boolean;
  junit?: string;
  summary?: boolean;
};


// Expand simple globs: packages/*/contracts or apps/**/contracts
async function expandSuitePatterns(patterns: string[], cwd: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      const abs = resolve(cwd, pattern);
      if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
      continue;
    }
    // segments
    const parts = pattern.split(/[/\\]/).filter(Boolean);
    async function walk(dir: string, pi: number): Promise<void> {
      if (pi >= parts.length) {
        try {
          await access(join(dir, "suite.json"));
          if (!seen.has(dir)) { seen.add(dir); out.push(dir); }
        } catch {}
        return;
      }
      const seg = parts[pi];
      if (seg === "**") {
        // match zero or more dirs
        await walk(dir, pi + 1);
        let entries: string[] = [];
        try { entries = await readdir(dir); } catch { return; }
        for (const e of entries) {
          if (e.startsWith(".")) continue;
          const next = join(dir, e);
          try {
            const st = await readdir(next); // is directory?
            await walk(next, pi); // stay on **
          } catch { /* file */ }
        }
        return;
      }
      if (seg === "*") {
        let entries: string[] = [];
        try { entries = await readdir(dir); } catch { return; }
        for (const e of entries) {
          if (e.startsWith(".")) continue;
          await walk(join(dir, e), pi + 1);
        }
        return;
      }
      await walk(join(dir, seg), pi + 1);
    }
    await walk(cwd, 0);
  }
  // only keep dirs that have suite.json
  const final: string[] = [];
  for (const d of out) {
    try {
      await access(join(d, "suite.json"));
      final.push(d);
    } catch {}
  }
  return final;
}

/** Suites touched by git changes vs base ref (default origin/main or main). */
function affectedSuiteDirs(suiteDirs: string[], cwd: string, baseRef?: string): string[] {
  let diff = "";
  const refs = baseRef ? [baseRef] : ["origin/main", "main", "origin/master", "master", "HEAD~1"];
  for (const ref of refs) {
    try {
      diff = execSync(`git diff --name-only ${ref}...HEAD`, { cwd, encoding: "utf8" });
      break;
    } catch {}
  }
  if (!diff.trim()) {
    try {
      diff = execSync("git diff --name-only HEAD", { cwd, encoding: "utf8" });
    } catch {
      return suiteDirs; // not a git repo → run all
    }
  }
  const files = new Set(diff.split("\n").map((f) => f.trim()).filter(Boolean));
  if (files.size === 0) return []; // nothing changed
  return suiteDirs.filter((dir) => {
    const rel = relative(cwd, dir).replace(/\\/g, "/");
    for (const f of files) {
      const nf = f.replace(/\\/g, "/");
      if (nf === rel || nf.startsWith(rel + "/") || rel.startsWith(nf.replace(/\/suite\.json$/, ""))) {
        return true;
      }
      // any change under suite path
      if (nf.startsWith(rel + "/") || (rel && nf.includes(rel))) return true;
    }
    return false;
  });
}


/** Resolve suite dir from --suite, config, or common defaults (first-timer friendly). */
async function resolveSuiteDir(args: string[], opt = true): Promise<string> {
  const suiteIdx = args.indexOf("--suite");
  if (suiteIdx >= 0 && args[suiteIdx + 1]) return resolve(args[suiteIdx + 1]);
  const cfg = await loadConfig();
  if (cfg.suites?.length === 1 && !cfg.suites[0].includes("*")) {
    return resolve(cfg.suites[0]);
  }
  for (const d of ["contracts", "desurf-suite", ".desurf"]) {
    try {
      await access(join(resolve(d), "suite.json"));
      return resolve(d);
    } catch {}
  }
  if (opt) {
    console.error("Desurf: required --suite <dir> (or ./contracts, ./desurf-suite, desurf.config.json)");
    console.error("  Try: desurf init ./contracts && desurf test --suite ./contracts");
    process.exit(2);
  }
  return "";
}

async function loadConfig(cwd = process.cwd()): Promise<DesurfConfig> {
  for (const name of ["desurf.config.json", ".desurfrc.json"]) {
    try {
      const raw = await readFile(join(cwd, name), "utf8");
      return JSON.parse(raw) as DesurfConfig;
    } catch {}
  }
  return {};
}

function junitXml(result: Awaited<ReturnType<typeof runSuite>>): string {
  const cases = result.results
    .map((r) => {
      const name = r.id.replace(/"/g, "'");
      if (r.reliability === "PASS") {
        return `    <testcase classname="${result.name}" name="${name}" time="${(r.durationMs / 1000).toFixed(3)}"/>`;
      }
      const msg = (r.error || r.assertions.filter((a) => !a.passed).map((a) => a.message).join("; ") || r.reliability)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
      const tag = r.reliability === "ERROR" ? "error" : "failure";
      return `    <testcase classname="${result.name}" name="${name}" time="${(r.durationMs / 1000).toFixed(3)}">\n      <${tag} message="${msg}"/>\n    </testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${result.name}" tests="${result.results.length}" failures="${result.regression}" errors="${result.error}" time="${(result.totalMs / 1000).toFixed(3)}">
${cases}
</testsuite>
`;
}

function markdownSummary(result: Awaited<ReturnType<typeof runSuite>>): string {
  const status = result.exitCode === 0 ? "PASS" : result.exitCode === 1 ? "REGRESSION" : "ERROR";
  const lines = [
    `### Desurf — ${result.name}: **${status}**`,
    ``,
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Passed | ${result.passed} |`,
    `| Regression | ${result.regression} |`,
    `| Error | ${result.error} |`,
    `| Duration | ${result.totalMs.toFixed(0)}ms |`,
    ``,
  ];
  const bad = result.results.filter((r) => r.reliability !== "PASS");
  if (bad.length) {
    lines.push(`Failed cases:`);
    for (const r of bad.slice(0, 20)) {
      lines.push(`- \`${r.id}\` — ${r.reliability}${r.error ? `: ${r.error}` : ""}`);
    }
  }
  return lines.join("\n");
}


const HELP = `
Desurf CLI ${CLI_VERSION}  (engine ${VERSION})
Offline-first behavioral contracts for prompts & agents.

Quick start:
  desurf init ./contracts
  desurf test --suite ./contracts
  # edit a prompt → test again → sealed drift = exit 2

Usage:
  desurf test    --suite <dir> [flags]
  desurf init    <dir> [--force]
  desurf seal    --suite <dir> [--force]
  desurf record  --suite <dir> --provider openrouter [--model <id>]
  desurf diff    --suite <dir> --case <id>
  desurf doctor  --suite <dir>
  desurf mutate  --suite <dir> [--apply]
  desurf badge   --suite <dir>
  desurf plugins
  desurf dashboard
  desurf version

Test flags:
  --all             run every suite in desurf.config.json (globs ok)
  --affected        only suites touched vs git base (see --base)
  --base <ref>      git ref for --affected (default: origin/main)
  --json            machine-readable SuiteResult
  --junit <file>    write JUnit XML (CI/enterprise)
  --summary         markdown summary (GitHub Step Summary aware)
  --fail-unsealed   UNSEALED pass → ERROR (team policy)
  --changed         only cases whose prompt/input changed vs seal
  --case <id>       single case
  --no-parallel     disable parallel execution

Big projects:
  desurf.config.json = { "suites": ["packages/*/contracts"], "failUnsealed": true }
  desurf test --all --junit report.xml --summary

Exit codes: 0=PASS  1=REGRESSION/FLAKY  2=ERROR (stale seal, policy, config)
`;


async function loadSuite(dir: string): Promise<Suite> {
  const path = join(dir, "suite.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`Desurf: suite not found. Expected suite.json at ${path}. Run: desurf init <dir>`);
    }
    throw new Error(`Desurf: cannot read suite.json (${e?.code || e?.message || e})`);
  }
  try {
    const suite = JSON.parse(raw) as Suite;
    if (!suite || !Array.isArray(suite.cases)) {
      throw new Error("suite.json must include a cases array");
    }
    return suite;
  } catch (e: any) {
    if (String(e?.message || e).startsWith("suite.json")) throw e;
    throw new Error(`Desurf: suite.json is not valid JSON (${e?.message || e})`);
  }
}

async function cmdTest(args: string[]) {
  const cfg = await loadConfig();
  const suiteIdx = args.indexOf("--suite");
  let suiteDirs: string[] = [];
  const cwd = process.cwd();
  if (suiteIdx >= 0 && args[suiteIdx + 1]) {
    suiteDirs = await expandSuitePatterns([args[suiteIdx + 1]], cwd);
  } else if ((args.includes("--all") || args.includes("--affected")) && cfg.suites?.length) {
    suiteDirs = await expandSuitePatterns(cfg.suites, cwd);
  } else if (cfg.suites?.length) {
    suiteDirs = await expandSuitePatterns(cfg.suites, cwd);
  } else {
    for (const d of ["contracts", "desurf-suite", ".desurf"]) {
      try {
        await readFile(join(resolve(d), "suite.json"), "utf8");
        suiteDirs = [resolve(d)];
        break;
      } catch {}
    }
  }
  if (args.includes("--affected")) {
    const baseIdx = args.indexOf("--base");
    const baseRef = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
    const before = suiteDirs.length;
    suiteDirs = affectedSuiteDirs(suiteDirs, cwd, baseRef);
    console.log(`Desurf: --affected ${suiteDirs.length}/${before} suite(s)`);
    if (suiteDirs.length === 0) {
      console.log("Desurf: no affected suites — exit 0");
      process.exit(0);
    }
  }
  if (suiteDirs.length === 0) {
    console.error("Desurf: required --suite <dir> (or desurf.config.json suites, or ./contracts)");
    console.error("  Try: desurf init ./contracts && desurf test --suite ./contracts");
    console.error("  Big repos: desurf.config.json → { \"suites\": [\"packages/a/contracts\", \"packages/b/contracts\"] } then desurf test --all");
    process.exit(2);
  }

  const caseIdx = args.indexOf("--case");
  const caseFilter = caseIdx >= 0 ? args[caseIdx + 1] : undefined;
  const parallel = args.includes("--no-parallel") ? false : cfg.parallel !== false;
  const asJson = args.includes("--json");
  const failUnsealed = args.includes("--fail-unsealed") || !!cfg.failUnsealed;
  const onlyChanged = args.includes("--changed");
  const wantSummary = args.includes("--summary") || !!cfg.summary || !!process.env.GITHUB_STEP_SUMMARY;
  const junitIdx = args.indexOf("--junit");
  const junitPath = junitIdx >= 0 ? args[junitIdx + 1] : cfg.junit;

  let worstExit: 0 | 1 | 2 = 0;
  const allResults: Awaited<ReturnType<typeof runSuite>>[] = [];

  for (const suiteDir of suiteDirs) {
    const suite = await loadSuite(suiteDir);

    if (onlyChanged) {
      const filtered = [];
      for (const tc of suite.cases) {
        try {
          const prompt = await readFile(containPath(suiteDir, tc.prompt, "prompt"), "utf8");
          const input = await readFile(containPath(suiteDir, tc.input, "input"), "utf8");
          const side = containPath(suiteDir, tc.output, "output") + ".desurf";
          let fp: any = null;
          try { fp = JSON.parse(await readFile(side, "utf8")); } catch {}
          const drift = checkDrift(fp, prompt, input);
          if (!fp || drift.drifted) filtered.push(tc);
        } catch {
          filtered.push(tc);
        }
      }
      suite.cases = filtered;
      if (suite.cases.length === 0) {
        console.log(`Desurf: --changed matched 0 cases in ${suiteDir}`);
        continue;
      }
    }

    const result = await runSuite(suiteDir, suite, { parallel, caseFilter });

    if (failUnsealed) {
      for (const r of result.results) {
        if (r.cassetteState === "UNSEALED" && r.reliability === "PASS") {
          r.reliability = "ERROR";
          r.error = "policy: --fail-unsealed (cassette not sealed)";
          result.error += 1;
          result.passed = Math.max(0, result.passed - 1);
          result.exitCode = 2;
        }
      }
    }

    allResults.push(result);
    if (result.exitCode > worstExit) worstExit = result.exitCode as 0 | 1 | 2;

    if (asJson && suiteDirs.length === 1) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!asJson) {
      console.log(`\nDesurf  cli ${CLI_VERSION}  engine ${VERSION}`);
      console.log(`Suite: ${result.name}  (${result.results.length} cases, ${result.totalMs.toFixed(0)}ms)  [${suiteDir}]\n`);
      for (const r of result.results) {
        const icon =
          r.reliability === "PASS" ? "✓" :
          r.reliability === "REGRESSION" ? "✗" :
          r.reliability === "FLAKY" ? "~" : "!";
        console.log(`${icon} ${r.id}`);
        console.log(`  ${r.reliability}  cassette: ${r.cassetteState}${r.drift ? " (drift detected)" : ""}  ${r.durationMs.toFixed(0)}ms`);
        if (r.error) console.log(`  ERROR: ${r.error}`);
        for (const a of r.assertions) {
          if (!a.passed) {
            console.log(`  · fail [${a.assertion.type}]: ${a.message}${a.confidence != null ? ` (conf=${a.confidence})` : ""}`);
          } else if (a.confidence != null) {
            console.log(`  · ok   [${a.assertion.type}] conf=${a.confidence}`);
          }
        }
        console.log();
      }
      console.log(
        `Results: ${result.passed} passed, ${result.flaky} flaky, ${result.regression} regression, ${result.error} error`
      );
    }

    if (junitPath) {
      let out = junitPath;
      if (suiteDirs.length > 1) {
        const slug = relative(cwd, suiteDir).replace(/[\\/]/g, "__").replace(/[^a-zA-Z0-9._-]/g, "_") || result.name;
        out = junitPath.replace(/\.xml$/i, `-${slug}.xml`);
      }
      await mkdir(dirname(out), { recursive: true }).catch(() => {});
      await writeFile(out, junitXml(result));
      console.log(`Wrote JUnit: ${out}`);
    }

    if (wantSummary) {
      const md = markdownSummary(result);
      if (process.env.GITHUB_STEP_SUMMARY) {
        await writeFile(process.env.GITHUB_STEP_SUMMARY, md + "\n", { flag: "a" });
      }
      if (args.includes("--summary")) console.log("\n" + md);
    }
  }

  if (asJson && suiteDirs.length > 1) {
    console.log(JSON.stringify({ results: allResults, exitCode: worstExit }, null, 2));
  }

  process.exit(worstExit);
}

async function cmdInit(args: string[]) {
  const force = args.includes("--force");
  const dirArg = args.find((a) => a && !a.startsWith("-"));
  const dir = resolve(dirArg || "desurf-suite");
  try {
    await readFile(join(dir, "suite.json"), "utf8");
    if (!force) {
      console.error(`Desurf: suite already exists at ${dir} (pass --force to overwrite)`);
      process.exit(2);
    }
  } catch {}
  await mkdir(join(dir, "prompts"), { recursive: true });
  await mkdir(join(dir, "inputs"), { recursive: true });
  await mkdir(join(dir, "outputs"), { recursive: true });

  const suite: Suite = {
    name: "example-suite",
    version: "2.0.0",
    cases: [
      {
        id: "support-classifier-good",
        input: "inputs/ticket.txt",
        prompt: "prompts/classify.txt",
        output: "outputs/good.json",
        assertions: [
          { type: "required", value: "category" },
          { type: "forbidden", value: "I am an AI", caseSensitive: false },
          {
            type: "json_schema",
            value: {
              type: "object",
              required: ["category", "explanation"],
            },
          },
          {
            type: "confidence",
            options: ["billing", "technical", "other"],
            threshold: 0.6,
          },
        ],
      },
    ],
  };

  await writeFile(join(dir, "suite.json"), JSON.stringify(suite, null, 2));
  await writeFile(
    join(dir, "prompts/classify.txt"),
    `You are a support ticket classifier.
Return ONLY valid JSON: {"category": "...", "explanation": "..."}
Categories: billing, technical, other.
`
  );
  await writeFile(
    join(dir, "inputs/ticket.txt"),
    "I was charged twice for my subscription. Please refund the extra charge."
  );
  await writeFile(
    join(dir, "outputs/good.json"),
    JSON.stringify(
      {
        category: "billing",
        explanation: "Duplicate charge reported; refund requested.",
      },
      null,
      2
    )
  );

  // Seal it immediately for offline determinism
  const prompt = await readFile(join(dir, "prompts/classify.txt"), "utf8");
  const input = await readFile(join(dir, "inputs/ticket.txt"), "utf8");
  const fp = makeFingerprint(prompt, input, "SEALED");
  await writeFile(join(dir, "outputs/good.json.desurf"), JSON.stringify(fp, null, 2));

  console.log(`Initialized Desurf suite at ${dir}`);
  console.log(`Run: desurf test --suite ${dir}`);
}

async function cmdSeal(args: string[]) {
  const suiteDir = await resolveSuiteDir(args);
  const force = args.includes("--force");
  const suite = await loadSuite(suiteDir);

  for (const tc of suite.cases) {
    const promptPath = containPath(suiteDir, tc.prompt, "prompt");
    const inputPath = containPath(suiteDir, tc.input, "input");
    const outPath = containPath(suiteDir, tc.output, "output");
    const prompt = await readFile(promptPath, "utf8");
    const input = await readFile(inputPath, "utf8");
    const side = outPath + ".desurf";
    // sidecar must also stay under suite (outPath already contained)
    if (!force) {
      try {
        await readFile(side);
        console.log(`skip ${tc.id} (already sealed, use --force)`);
        continue;
      } catch {}
    }
    const fp = makeFingerprint(prompt, input, "SEALED");
    await mkdir(join(outPath, ".."), { recursive: true });
    await writeFile(side, JSON.stringify(fp, null, 2));
    console.log(`sealed ${tc.id}`);
  }
}

async function cmdRecord(args: string[]) {
  const suiteIdx = args.indexOf("--suite");
  const providerIdx = args.indexOf("--provider");
  if (suiteIdx === -1 || providerIdx === -1) {
    console.error("Required: --suite <dir> --provider openrouter");
    process.exit(2);
  }
  const suiteDir = resolve(args[suiteIdx + 1]);
  const provider = args[providerIdx + 1];
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : "openai/gpt-4o-mini";

  if (provider !== "openrouter") {
    console.error("v2 currently ships openrouter provider; others via ecosystem plugins");
    process.exit(2);
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("Desurf: Set OPENROUTER_API_KEY to record live responses");
    process.exit(2);
  }

  const suite = await loadSuite(suiteDir);
  for (const tc of suite.cases) {
    const prompt = await readFile(containPath(suiteDir, tc.prompt, "prompt"), "utf8");
    const input = await readFile(containPath(suiteDir, tc.input, "input"), "utf8");
    const body = {
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: input },
      ],
      temperature: 0,
    };
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://desurf.dev",
        "X-Title": "Desurf Ecosystem",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`provider error ${res.status}: ${await res.text()}`);
      process.exit(2);
    }
    const data = (await res.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? "";
    const outPath = containPath(suiteDir, tc.output, "output");
    const fp = makeFingerprint(prompt, input, "RECORDED", { model, provider });
    await writeFile(outPath, text);
    await writeFile(outPath + ".desurf", JSON.stringify(fp, null, 2));
    console.log(`recorded ${tc.id} (${text.length} chars)`);
  }
}

async function cmdDiff(args: string[]) {
  const caseIdx = args.indexOf("--case");
  if (caseIdx === -1 || !args[caseIdx + 1]) {
    console.error("Desurf: required --case <id>");
    process.exit(2);
  }
  const suiteDir = await resolveSuiteDir(args);
  const caseId = args[caseIdx + 1];
  const suite = await loadSuite(suiteDir);
  const tc = suite.cases.find((c) => c.id === caseId);
  if (!tc) {
    console.error(`Desurf: case not found: ${caseId}`);
    process.exit(2);
  }
  let outPath: string;
  try {
    outPath = containPath(suiteDir, tc.output, "output");
  } catch (e: any) {
    console.error(e?.message || e);
    process.exit(2);
  }
  const out = await readFile(outPath, "utf8").catch(() => "(missing)");
  let fp: any = null;
  try {
    fp = JSON.parse(await readFile(outPath + ".desurf", "utf8"));
  } catch {}
  console.log(`Case: ${caseId}`);
  console.log(`State: ${fp?.state || "UNSEALED"}`);
  console.log(`Model: ${fp?.model || "—"}`);
  console.log(`Trajectory steps: ${fp?.trajectory?.length ?? 0}`);
  console.log("--- output ---");
  console.log(out.slice(0, 2000));
  if (fp?.trajectory) {
    console.log("--- trajectory ---");
    console.log(JSON.stringify(fp.trajectory, null, 2));
  }
}

async function cmdPlugins() {
  console.log("Built-in ecosystem surface:");
  console.log("  core        fingerprints, assertions, parallel runner");
  console.log("  cli         test / init / seal / record / diff");
  console.log("  sdk         embed runSuite / assertBehavior / registerPlugin");
  console.log("  web         local dashboard (desurf dashboard)");
  console.log("  confidence  Jev-inspired typed judge (local + future remote)");
  console.log("  trajectory  agent tool-call sequence contracts");
  console.log("\nRegister custom plugins via desurf-core / future desurf-sdk registerPlugin()");
}

async function cmdDashboard() {
  console.log(`Desurf dashboard (lightweight)`);
  console.log(`  1. Run:  desurf test --suite ./contracts --json > results.json`);
  console.log(`  2. Open results.json in any editor or feed it to your CI summary`);
  console.log(`  3. Optional badge: desurf badge --suite ./contracts`);
  console.log(`  Hosted UI is not required — offline contracts are the product.`);
}


async function cmdDoctor(args: string[]) {
  const suiteDir = await resolveSuiteDir(args);
  const issues: string[] = [];
  let suite: Suite;
  try {
    suite = await loadSuite(suiteDir);
  } catch (e: any) {
    console.error(e?.message || e);
    process.exit(2);
  }
  console.log(`Desurf doctor — ${suite.name} (${suite.cases.length} cases)\n`);
  for (const tc of suite.cases) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(tc.id)) {
      issues.push(`case id unsafe: ${tc.id}`);
    }
    for (const label of ["input", "prompt", "output"] as const) {
      const rel = (tc as any)[label] as string;
      if (!rel || rel.includes("..") || rel.startsWith("/") || rel.includes("\\0")) {
        issues.push(`${tc.id}: ${label} path unsafe: ${rel}`);
      }
    }
    for (const a of tc.assertions || []) {
      if (a.type === "regex") {
        const pat = a.pattern || String(a.value || "");
        if (/\([^)]*[+*][^)]*\)[+*{]/.test(pat)) {
          issues.push(`${tc.id}: regex ReDoS risk: ${pat}`);
        }
      }
    }
    // sealed without sidecar
    try {
      await readFile(join(suiteDir, tc.output), "utf8");
      try {
        await readFile(join(suiteDir, tc.output + ".desurf"), "utf8");
      } catch {
        issues.push(`${tc.id}: output exists but UNSEALED (no .desurf) — prompt drift invisible`);
      }
    } catch {
      issues.push(`${tc.id}: missing output cassette`);
    }
  }
  if (issues.length === 0) {
    console.log("✓ no issues found");
    process.exit(0);
  }
  for (const i of issues) console.log(`! ${i}`);
  console.log(`\n${issues.length} issue(s)`);
  process.exit(issues.some((x) => x.includes("unsafe") || x.includes("ReDoS")) ? 2 : 1);
}

async function cmdMutate(args: string[]) {
  /** Invent adversarial sibling cases: empty, refusal, preamble, wrong-category */
  const suiteDir = await resolveSuiteDir(args);
  const suite = await loadSuite(suiteDir);
  const outDir = join(suiteDir, "outputs", "mutants");
  await mkdir(outDir, { recursive: true });
  const mutants: TestCase[] = [];
  for (const tc of suite.cases.slice(0, 5)) {
    const variants: Array<{ suffix: string; body: string }> = [
      { suffix: "empty", body: "" },
      { suffix: "refusal", body: "I am an AI and cannot help with that request." },
      { suffix: "preamble", body: "Sure! Here is the JSON:\n{\"category\":\"other\",\"explanation\":\"noise\"}\nHope that helps!" },
      { suffix: "wrong", body: JSON.stringify({ category: "technical", explanation: "mutated wrong bucket" }) },
    ];
    for (const v of variants) {
      const id = `${tc.id}__mut_${v.suffix}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
      const outRel = `outputs/mutants/${id}.txt`;
      await writeFile(join(suiteDir, outRel), v.body);
      // Force assertions that should FAIL on mutants (prove the gate works)
      const conf = (tc.assertions || []).find((a) => a.type === "confidence" || a.type === "choice");
      const opts = conf?.options || ["billing", "technical", "account", "other"];
      const expectedChoice = typeof conf?.value === "string" ? conf.value : opts[0];
      const hardened: any[] = [
        ...(tc.assertions || []),
        { type: "forbidden", value: "I am an AI" },
        { type: "required", value: "category" },
        { type: "choice", value: expectedChoice, options: opts, threshold: 0.6 },
        { type: "forbidden", value: "Hope that helps" },
      ];
      // dedupe by type+value
      const seen = new Set<string>();
      const assertions = hardened.filter((a) => {
        const k = a.type + ":" + String((a as any).value ?? "");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      mutants.push({
        id,
        input: tc.input,
        prompt: tc.prompt,
        output: outRel,
        assertions,
      });
    }
  }
  const mutated: Suite = {
    name: suite.name + "-mutants",
    version: suite.version || "2.0.0",
    cases: mutants,
  };
  const mutPath = join(suiteDir, "suite.mutants.json");
  await writeFile(mutPath, JSON.stringify(mutated, null, 2));
  console.log(`Invented ${mutants.length} adversarial cases → ${mutPath}`);
  if (args.includes("--apply")) {
    const backup = join(suiteDir, "suite.json.bak");
    try {
      await writeFile(backup, await readFile(join(suiteDir, "suite.json"), "utf8"));
    } catch {}
    await writeFile(join(suiteDir, "suite.json"), JSON.stringify(mutated, null, 2));
    console.log(`Applied mutants to suite.json (backup: suite.json.bak)`);
    console.log(`Run: desurf test --suite ${suiteDir}`);
  } else {
    console.log(`Run: desurf mutate --suite ${suiteDir} --apply   # replace suite.json with mutants`);
    console.log(`Or:  desurf test --suite ${suiteDir}  after copying suite.mutants.json → suite.json`);
  }
}



async function cmdBadge(args: string[]) {
  const suiteDir = await resolveSuiteDir(args);
  let status = "unknown";
  let color = "lightgrey";
  let exit = 0;
  try {
    const suite = await loadSuite(suiteDir);
    const result = await runSuite(suiteDir, suite, { parallel: true });
    exit = result.exitCode;
    if (result.exitCode === 0) {
      status = "passing";
      color = "brightgreen";
    } else if (result.exitCode === 1) {
      status = "regression";
      color = "orange";
    } else {
      status = "error";
      color = "red";
    }
  } catch (e: any) {
    status = "error";
    color = "red";
    exit = 2;
  }
  const label = "desurf";
  const url = `https://img.shields.io/badge/${label}-${status}-${color}`;
  console.log(`![desurf](${url})`);
  console.log(`<!-- desurf-badge status=${status} exit=${exit} -->`);
  console.log(`\nMarkdown ready. Drop into README. Contracts: ${status}.`);
  process.exit(exit);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return;
  }
  if (cmd === "version" || cmd === "--version") {
    console.log(`desurf-cli ${CLI_VERSION} (engine ${VERSION})`);
    return;
  }
  if (cmd === "test") return cmdTest(rest);
  if (cmd === "init") return cmdInit(rest);
  if (cmd === "seal") return cmdSeal(rest);
  if (cmd === "record") return cmdRecord(rest);
  if (cmd === "diff") return cmdDiff(rest);
  if (cmd === "plugins") return cmdPlugins();
  if (cmd === "dashboard") return cmdDashboard();
  if (cmd === "doctor") return cmdDoctor(rest);
  if (cmd === "mutate") return cmdMutate(rest);
  if (cmd === "badge") return cmdBadge(rest);
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(2);
}

main().catch((e) => {
  const msg = e?.message || String(e);
  if (String(msg).startsWith("Desurf:")) {
    console.error(msg);
  } else {
    console.error(`Desurf: ${msg}`);
  }
  process.exit(2);
});
