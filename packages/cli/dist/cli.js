#!/usr/bin/env node
/**
 * Desurf Ecosystem CLI v2.0
 * Offline-first • Parallel • Typed judges (Jev-inspired) • Agent trajectories
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runSuite, makeFingerprint, VERSION, } from "desurf-core";
const HELP = `
Desurf Ecosystem  ${VERSION}
Offline-first behavioral contracts for prompts & agents.

Usage:
  desurf test    --suite <dir> [--case <id>] [--parallel]
  desurf init    <dir>
  desurf seal    --suite <dir> [--force]
  desurf record  --suite <dir> --provider openrouter [--model <id>]
  desurf diff    --suite <dir> --case <id>
  desurf plugins
  desurf dashboard
  desurf doctor  --suite <dir>   # health + security checks
  desurf mutate  --suite <dir>   # invent adversarial sibling cases
  desurf version

Exit codes: 0=PASS  1=REGRESSION/FLAKY  2=ERROR (incl. stale sealed provenance)
`;
async function loadSuite(dir) {
    const path = join(dir, "suite.json");
    let raw;
    try {
        raw = await readFile(path, "utf8");
    }
    catch (e) {
        if (e?.code === "ENOENT") {
            throw new Error(`Desurf: suite not found. Expected suite.json at ${path}. Run: desurf init <dir>`);
        }
        throw new Error(`Desurf: cannot read suite.json (${e?.code || e?.message || e})`);
    }
    try {
        const suite = JSON.parse(raw);
        if (!suite || !Array.isArray(suite.cases)) {
            throw new Error("suite.json must include a cases array");
        }
        return suite;
    }
    catch (e) {
        if (String(e?.message || e).startsWith("suite.json"))
            throw e;
        throw new Error(`Desurf: suite.json is not valid JSON (${e?.message || e})`);
    }
}
async function cmdTest(args) {
    const suiteIdx = args.indexOf("--suite");
    if (suiteIdx === -1 || !args[suiteIdx + 1]) {
        console.error("Required: --suite <dir>");
        process.exit(2);
    }
    const suiteDir = resolve(args[suiteIdx + 1]);
    const caseIdx = args.indexOf("--case");
    const caseFilter = caseIdx >= 0 ? args[caseIdx + 1] : undefined;
    const parallel = !args.includes("--no-parallel");
    const suite = await loadSuite(suiteDir);
    const result = await runSuite(suiteDir, suite, { parallel, caseFilter });
    console.log(`\nDesurf Ecosystem  v${VERSION}`);
    console.log(`Suite: ${result.name}  (${result.results.length} cases, ${result.totalMs.toFixed(0)}ms)\n`);
    for (const r of result.results) {
        const icon = r.reliability === "PASS" ? "✓" :
            r.reliability === "REGRESSION" ? "✗" :
                r.reliability === "FLAKY" ? "~" : "!";
        console.log(`${icon} ${r.id}`);
        console.log(`  ${r.reliability}  cassette: ${r.cassetteState}${r.drift ? " (drift detected)" : ""}  ${r.durationMs.toFixed(0)}ms`);
        if (r.error)
            console.log(`  ERROR: ${r.error}`);
        for (const a of r.assertions) {
            if (!a.passed) {
                console.log(`  · fail [${a.assertion.type}]: ${a.message}${a.confidence != null ? ` (conf=${a.confidence})` : ""}`);
            }
            else if (a.confidence != null) {
                console.log(`  · ok   [${a.assertion.type}] conf=${a.confidence}`);
            }
        }
        console.log();
    }
    console.log(`Results: ${result.passed} passed, ${result.flaky} flaky, ${result.regression} regression, ${result.error} error`);
    // Ecosystem: optional results dump for dashboard / CI artifacts
    if (args.includes("--json") || process.env.DESURF_RESULTS) {
        const outPath = process.env.DESURF_RESULTS || join(suiteDir, "results.json");
        await writeFile(outPath, JSON.stringify(result, null, 2));
        console.log(`Wrote ${outPath}`);
    }
    process.exit(result.exitCode);
}
async function cmdInit(args) {
    const dir = resolve(args[0] || ".");
    await mkdir(join(dir, "prompts"), { recursive: true });
    await mkdir(join(dir, "inputs"), { recursive: true });
    await mkdir(join(dir, "outputs"), { recursive: true });
    const suite = {
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
    await writeFile(join(dir, "prompts/classify.txt"), `You are a support ticket classifier.
Return ONLY valid JSON: {"category": "...", "explanation": "..."}
Categories: billing, technical, other.
`);
    await writeFile(join(dir, "inputs/ticket.txt"), "I was charged twice for my subscription. Please refund the extra charge.");
    await writeFile(join(dir, "outputs/good.json"), JSON.stringify({
        category: "billing",
        explanation: "Duplicate charge reported; refund requested.",
    }, null, 2));
    // Seal it immediately for offline determinism
    const prompt = await readFile(join(dir, "prompts/classify.txt"), "utf8");
    const input = await readFile(join(dir, "inputs/ticket.txt"), "utf8");
    const fp = makeFingerprint(prompt, input, "SEALED");
    await writeFile(join(dir, "outputs/good.json.desurf"), JSON.stringify(fp, null, 2));
    console.log(`Initialized Desurf suite at ${dir}`);
    console.log(`Run: desurf test --suite ${dir}`);
}
async function cmdSeal(args) {
    const suiteIdx = args.indexOf("--suite");
    if (suiteIdx === -1) {
        console.error("Required: --suite <dir>");
        process.exit(2);
    }
    const suiteDir = resolve(args[suiteIdx + 1]);
    const force = args.includes("--force");
    const suite = await loadSuite(suiteDir);
    for (const tc of suite.cases) {
        const prompt = await readFile(join(suiteDir, tc.prompt), "utf8");
        const input = await readFile(join(suiteDir, tc.input), "utf8");
        const side = join(suiteDir, tc.output + ".desurf");
        if (!force) {
            try {
                await readFile(side);
                console.log(`skip ${tc.id} (already sealed, use --force)`);
                continue;
            }
            catch { }
        }
        const fp = makeFingerprint(prompt, input, "SEALED");
        await writeFile(side, JSON.stringify(fp, null, 2));
        console.log(`sealed ${tc.id}`);
    }
}
async function cmdRecord(args) {
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
        console.error("Set OPENROUTER_API_KEY");
        process.exit(2);
    }
    const suite = await loadSuite(suiteDir);
    for (const tc of suite.cases) {
        const prompt = await readFile(join(suiteDir, tc.prompt), "utf8");
        const input = await readFile(join(suiteDir, tc.input), "utf8");
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
        const data = (await res.json());
        const text = data.choices?.[0]?.message?.content ?? "";
        await writeFile(join(suiteDir, tc.output), text);
        const fp = makeFingerprint(prompt, input, "RECORDED", { model, provider });
        await writeFile(join(suiteDir, tc.output + ".desurf"), JSON.stringify(fp, null, 2));
        console.log(`recorded ${tc.id} (${text.length} chars)`);
    }
}
async function cmdDiff(args) {
    const suiteIdx = args.indexOf("--suite");
    const caseIdx = args.indexOf("--case");
    if (suiteIdx === -1 || caseIdx === -1) {
        console.error("Required: --suite <dir> --case <id>");
        process.exit(2);
    }
    const suiteDir = resolve(args[suiteIdx + 1]);
    const caseId = args[caseIdx + 1];
    const suite = await loadSuite(suiteDir);
    const tc = suite.cases.find((c) => c.id === caseId);
    if (!tc) {
        console.error(`case not found: ${caseId}`);
        process.exit(2);
    }
    const out = await readFile(join(suiteDir, tc.output), "utf8").catch(() => "(missing)");
    let fp = null;
    try {
        fp = JSON.parse(await readFile(join(suiteDir, tc.output + ".desurf"), "utf8"));
    }
    catch { }
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
    console.log("\nRegister custom plugins via @desurf/sdk registerPlugin()");
}
async function cmdDashboard() {
    const port = process.env.DESURF_DASHBOARD_PORT || "3847";
    console.log(`Desurf local dashboard`);
    console.log(`  Serve packages/web/public with any static server, e.g.:`);
    console.log(`  npx --yes serve packages/web/public -p ${port}`);
    console.log(`  Then open http://localhost:${port}`);
    console.log(`  Dashboard reads suite results you drop into public/results.json`);
}
async function cmdDoctor(args) {
    const suiteIdx = args.indexOf("--suite");
    if (suiteIdx === -1 || !args[suiteIdx + 1]) {
        console.error("Required: --suite <dir>");
        process.exit(2);
    }
    const suiteDir = resolve(args[suiteIdx + 1]);
    const issues = [];
    let suite;
    try {
        suite = await loadSuite(suiteDir);
    }
    catch (e) {
        console.error(e?.message || e);
        process.exit(2);
    }
    console.log(`Desurf doctor — ${suite.name} (${suite.cases.length} cases)\n`);
    for (const tc of suite.cases) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(tc.id)) {
            issues.push(`case id unsafe: ${tc.id}`);
        }
        for (const label of ["input", "prompt", "output"]) {
            const rel = tc[label];
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
            }
            catch {
                issues.push(`${tc.id}: output exists but UNSEALED (no .desurf) — prompt drift invisible`);
            }
        }
        catch {
            issues.push(`${tc.id}: missing output cassette`);
        }
    }
    if (issues.length === 0) {
        console.log("✓ no issues found");
        process.exit(0);
    }
    for (const i of issues)
        console.log(`! ${i}`);
    console.log(`\n${issues.length} issue(s)`);
    process.exit(issues.some((x) => x.includes("unsafe") || x.includes("ReDoS")) ? 2 : 1);
}
async function cmdMutate(args) {
    /** Invent adversarial sibling cases: empty, refusal, preamble, wrong-category */
    const suiteIdx = args.indexOf("--suite");
    if (suiteIdx === -1 || !args[suiteIdx + 1]) {
        console.error("Required: --suite <dir>");
        process.exit(2);
    }
    const suiteDir = resolve(args[suiteIdx + 1]);
    const suite = await loadSuite(suiteDir);
    const outDir = join(suiteDir, "outputs", "mutants");
    await mkdir(outDir, { recursive: true });
    const mutants = [];
    for (const tc of suite.cases.slice(0, 5)) {
        const variants = [
            { suffix: "empty", body: "" },
            { suffix: "refusal", body: "I am an AI and cannot help with that request." },
            { suffix: "preamble", body: "Sure! Here is the JSON:\n{\"category\":\"other\",\"explanation\":\"noise\"}\nHope that helps!" },
            { suffix: "wrong", body: JSON.stringify({ category: "technical", explanation: "mutated wrong bucket" }) },
        ];
        for (const v of variants) {
            const id = `${tc.id}__mut_${v.suffix}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
            const outRel = `outputs/mutants/${id}.txt`;
            await writeFile(join(suiteDir, outRel), v.body);
            mutants.push({
                id,
                input: tc.input,
                prompt: tc.prompt,
                output: outRel,
                assertions: tc.assertions,
            });
        }
    }
    const mutated = {
        name: suite.name + "-mutants",
        version: suite.version || "2.0.0",
        cases: mutants,
    };
    const mutPath = join(suiteDir, "suite.mutants.json");
    await writeFile(mutPath, JSON.stringify(mutated, null, 2));
    console.log(`Invented ${mutants.length} adversarial cases → ${mutPath}`);
    console.log(`Run: desurf test --suite ${suiteDir}  (or point suite.json at suite.mutants.json)`);
    console.log(`Tip: copy suite.mutants.json over suite.json to gate against these failures.`);
}
async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd || cmd === "help" || cmd === "--help") {
        console.log(HELP);
        return;
    }
    if (cmd === "version" || cmd === "--version") {
        console.log(VERSION);
        return;
    }
    if (cmd === "test")
        return cmdTest(rest);
    if (cmd === "init")
        return cmdInit(rest);
    if (cmd === "seal")
        return cmdSeal(rest);
    if (cmd === "record")
        return cmdRecord(rest);
    if (cmd === "diff")
        return cmdDiff(rest);
    if (cmd === "plugins")
        return cmdPlugins();
    if (cmd === "dashboard")
        return cmdDashboard();
    if (cmd === "doctor")
        return cmdDoctor(rest);
    if (cmd === "mutate")
        return cmdMutate(rest);
    console.error(`Unknown command: ${cmd}`);
    console.log(HELP);
    process.exit(2);
}
main().catch((e) => {
    const msg = e?.message || String(e);
    if (String(msg).startsWith("Desurf:")) {
        console.error(msg);
    }
    else {
        console.error(`Desurf: ${msg}`);
    }
    process.exit(2);
});
