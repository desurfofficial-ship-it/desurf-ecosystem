import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

async function loadText(suiteDir: string, rel: string): Promise<string> {
  return readFile(join(suiteDir, rel), "utf8");
}

async function loadCassette(suiteDir: string, tc: TestCase): Promise<{ cassette: Cassette; state: CassetteState }> {
  const outPath = join(suiteDir, tc.output);
  let output = "";
  try {
    output = await readFile(outPath, "utf8");
  } catch {
    return { cassette: { output: "" }, state: "UNSEALED" };
  }
  // Look for sidecar .desurf
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
    const prompt = await loadText(suiteDir, tc.prompt);
    const input = await loadText(suiteDir, tc.input);
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
    // Sealed + drift → hard ERROR (original contract)
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
  const cases = opts.caseFilter
    ? suite.cases.filter((c) => c.id === opts.caseFilter)
    : suite.cases;

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