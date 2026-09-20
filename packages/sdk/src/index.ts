export * from "@desurf/core";
export async function evaluateSuiteDir(suiteDir: string, opts: any = {}) {
  const { runSuite } = await import("@desurf/core");
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const suite = JSON.parse(await readFile(join(suiteDir, "suite.json"), "utf8"));
  return runSuite(suiteDir, suite, opts);
}
const plugins: any[] = [];
export function registerPlugin(p: any) { plugins.push(p); }
export function listPlugins() { return [...plugins]; }
