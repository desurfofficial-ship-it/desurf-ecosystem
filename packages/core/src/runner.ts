import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import type {
  Suite,
  TestCase,
  CaseResult,
  SuiteResult,
  Cassette,
  CassetteState,
  Reliability,
} from "./types.js";
import { evaluateAll } from "./assertions.js";
import { checkDrift } from "./fingerprint.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_CASES = 2000;

async function safeJoin(suiteDir: string, rel: string, label: string): Promise<string> {
  if (!rel || typeof rel !== "string") {
    throw new Error(`Desurf: invalid ${label} path`);
  }
  if (isAbsolute(rel) || rel.includes("\0")) {
    throw new Error(`Desurf: ${label} path must be relative and non-null: ${rel}`);
  }
  const root = resolve(suiteDir);
  const full = resolve(root, rel);
  const relToRoot = relative(root, full);
  if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new Error(`Desurf: ${label} path escapes suite directory: ${rel}`);
  }
  try {
    const rootReal = await realpath(root);
    try {
      const fileReal = await realpath(full);
      const rel2 = relative(rootReal, fileReal);
      if (rel2.startsWith("..") || isAbsolute(rel2)) {
        throw new Error(`Desurf: ${label} resolves outside suite (symlink?): ${rel}`);
      }
    } catch (e: any) {
      if (e?.message?.startsWith("Desurf:")) throw e;
    }
  } catch (e: any) {
    if (e?.message?.startsWith("Desurf:")) throw e;
  }
  return full;
}

function validateCaseId(id: string): void {
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) {
    throw new Error(
      `Desurf: invalid case id "${id}" (use alphanumeric, . _ - ; max 128; no path segments)`
    );
  }
}

async function loadText(suiteDir: string, rel: string, label: string): Promise<string> {
  const path = await safeJoin(suiteDir, rel, label);
  try {
    return await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`Desurf: missing ${label} file: ${rel}`);
    }
    throw new Error(`Desurf: cannot read ${label} (${e?.code || e?.message || e})`);
  }
}

async function loadCassette(
  suiteDir: string,
  tc: TestCase
): Promise<{ cassette: Cassette; state: CassetteState }> {
  const outPath = await safeJoin(suiteDir, tc.output, "output");
  let output = "";
  try {
    const st = await stat(outPath);
    if (st.size > MAX_OUTPUT_BYTES) {
      throw new Error(
        `Desurf: output exceeds ${MAX_OUTPUT_BYTES} bytes (${st.size}) — refuse to load`
      );
    }
    output = await readFile(outPath, "utf8");
  } catch (e: any) {
    if (e?.message?.startsWith("Desurf:")) throw e;
    return { cassette: { output: "" }, state: "UNSEALED" };
  }
  const side = outPath + ".desurf";
  try {
    const raw = await readFile(side, "utf8");
    const fp = JSON.parse(raw);
    const state: CassetteState = fp.state || "SEALED";
    return { cassette: { output, fingerprint: fp, trajectory: fp.trajectory }, state };
  } catch {
    return { cassette: { output }, state: "UNSEALED" };
  }
}

export async function runCase(
  suiteDir: string,
  tc: TestCase,
  opts: { liveOutput?: string } = {}
): Promise<CaseResult> {
  const t0 = performance.now();
  try {
    validateCaseId(tc.id);
    const prompt = await loadText(suiteDir, tc.prompt, "prompt");
    const input = await loadText(suiteDir, tc.input, "input");
    const { cassette, state } = await loadCassette(suiteDir, tc);

    const output = opts.liveOutput ?? cassette.output;
    if (!output) {
      return {
        id: tc.id,
        reliability: "ERROR",
        cassetteState: state,
        assertions: [],
        durationMs: performance.now() - t0,
        error: "no output available (offline requires cassette)",
      };
    }

    const driftCheck = checkDrift(cassette.fingerprint, prompt, input);
    if (state === "SEALED" && driftCheck.drifted) {
      return {
        id: tc.id,
        reliability: "ERROR",
        cassetteState: state,
        assertions: [],
        durationMs: performance.now() - t0,
        error: `stale provenance: ${driftCheck.reason}`,
        drift: true,
      };
    }

    const results = evaluateAll(output, tc.assertions, cassette.trajectory);
    // Unknown assertion types → ERROR not REGRESSION
    const unknown = results.filter((r) =>
      String(r.message || "").startsWith("unknown assertion type")
    );
    if (unknown.length > 0) {
      return {
        id: tc.id,
        reliability: "ERROR",
        cassetteState: state,
        assertions: results,
        durationMs: performance.now() - t0,
        error: unknown[0].message,
        drift: driftCheck.drifted,
      };
    }

    const allPass = results.every((r) => r.passed);
    const reliability: Reliability = allPass ? "PASS" : "REGRESSION";

    return {
      id: tc.id,
      reliability,
      cassetteState: state,
      assertions: results,
      durationMs: performance.now() - t0,
      drift: driftCheck.drifted,
    };
  } catch (e: any) {
    return {
      id: tc.id,
      reliability: "ERROR",
      cassetteState: "UNSEALED",
      assertions: [],
      durationMs: performance.now() - t0,
      error: e?.message || String(e),
    };
  }
}

export async function runSuite(
  suiteDir: string,
  suite: Suite,
  opts: { parallel?: boolean; caseFilter?: string } = {}
): Promise<SuiteResult> {
  const t0 = performance.now();
  if (!suite?.cases || !Array.isArray(suite.cases)) {
    throw new Error("Desurf: suite.cases must be an array");
  }
  if (suite.cases.length > MAX_CASES) {
    throw new Error(`Desurf: suite has ${suite.cases.length} cases (max ${MAX_CASES})`);
  }

  // Duplicate case ids
  const seen = new Set<string>();
  for (const c of suite.cases) {
    if (seen.has(c.id)) {
      throw new Error(`Desurf: duplicate case id "${c.id}"`);
    }
    seen.add(c.id);
  }

  let cases = suite.cases;
  if (opts.caseFilter) {
    cases = suite.cases.filter((c) => c.id === opts.caseFilter);
    if (cases.length === 0) {
      throw new Error(
        `Desurf: case not found: "${opts.caseFilter}" (suite has ${suite.cases.length} case(s))`
      );
    }
  }

  let results: CaseResult[];
  if (opts.parallel !== false && cases.length > 1) {
    results = await Promise.all(cases.map((c) => runCase(suiteDir, c)));
  } else {
    results = [];
    for (const c of cases) results.push(await runCase(suiteDir, c));
  }

  const passed = results.filter((r) => r.reliability === "PASS").length;
  const flaky = results.filter((r) => r.reliability === "FLAKY").length;
  const regression = results.filter((r) => r.reliability === "REGRESSION").length;
  const error = results.filter((r) => r.reliability === "ERROR").length;

  let exitCode: 0 | 1 | 2 = 0;
  if (error > 0) exitCode = 2;
  else if (regression > 0 || flaky > 0) exitCode = 1;

  return {
    name: suite.name,
    results,
    passed,
    flaky,
    regression,
    error,
    totalMs: performance.now() - t0,
    exitCode,
  };
}
