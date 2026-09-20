import type { Assertion, AssertionResult } from "./types.js";

/** Deterministic local "confidence" heuristic (Jev-inspired).
 *  Real Jev would be plugged via provider later; this keeps offline pure & fast.
 */
function localConfidence(text: string, options: string[]): { choice: string; confidence: number } {
  const lower = text.toLowerCase();
  let best = options[0] || "unknown";
  let score = 0.1;
  for (const opt of options) {
    const o = opt.toLowerCase();
    if (lower.includes(o)) {
      const s = 0.6 + Math.min(0.4, o.length / 40);
      if (s > score) {
        score = s;
        best = opt;
      }
    }
  }
  // Strong signal if JSON-like structured output
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) score = Math.min(0.95, score + 0.2);
  return { choice: best, confidence: Math.round(score * 100) / 100 };
}

export function evaluateAssertion(
  output: string,
  assertion: Assertion,
  trajectory?: Array<{ type: string; name?: string }>
): AssertionResult {
  const a = assertion;
  try {
    switch (a.type) {
      case "required": {
        const val = String(a.value ?? "");
        const found = a.caseSensitive === false
          ? output.toLowerCase().includes(val.toLowerCase())
          : output.includes(val);
        return {
          assertion: a,
          passed: found,
          message: found ? undefined : `missing required: "${val}"`,
        };
      }
      case "forbidden": {
        const val = String(a.value ?? "");
        const found = a.caseSensitive === false
          ? output.toLowerCase().includes(val.toLowerCase())
          : output.includes(val);
        return {
          assertion: a,
          passed: !found,
          message: found ? `forbidden content present: "${val}"` : undefined,
        };
      }
      case "regex": {
        const re = new RegExp(a.pattern || String(a.value || ""), a.caseSensitive === false ? "i" : "");
        const ok = re.test(output);
        return { assertion: a, passed: ok, message: ok ? undefined : `regex failed: ${re}` };
      }
      case "json_schema": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          return { assertion: a, passed: false, message: "output is not valid JSON" };
        }
        const schema = (a.value || {}) as Record<string, unknown>;
        if (schema.type === "object" && typeof parsed === "object" && parsed !== null) {
          const req = (schema.required as string[]) || Object.keys((schema.properties as object) || {});
          for (const k of req) {
            if (!(k in (parsed as object))) {
              return { assertion: a, passed: false, message: `json missing key: ${k}` };
            }
          }
        }
        return { assertion: a, passed: true };
      }
      case "tool_call": {
        const name = String(a.value ?? "");
        const calls = trajectory?.filter((t) => t.type === "tool") || [];
        const hit = calls.some((c) => c.name === name);
        return {
          assertion: a,
          passed: hit,
          message: hit ? undefined : `expected tool_call: ${name}`,
        };
      }
      case "trajectory": {
        const expected = (a.value as string[]) || [];
        const actual = (trajectory || [])
          .filter((t) => t.type === "tool")
          .map((t) => t.name || "");
        const ok = expected.every((e, i) => actual[i] === e);
        return {
          assertion: a,
          passed: ok,
          message: ok ? undefined : `trajectory mismatch. expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
        };
      }
      case "confidence":
      case "choice": {
        const opts = a.options || (Array.isArray(a.value) ? (a.value as string[]) : ["pass", "fail"]);
        const { choice, confidence } = localConfidence(output, opts);
        const threshold = a.threshold ?? 0.7;
        const target = typeof a.value === "string" ? a.value : opts[0];
        const passed =
          a.type === "confidence"
            ? confidence >= threshold
            : choice === target && confidence >= threshold;
        return {
          assertion: a,
          passed,
          confidence,
          message: passed
            ? undefined
            : `choice=${choice} confidence=${confidence} (need >= ${threshold}${a.type === "choice" ? ` and == ${target}` : ""})`,
        };
      }
      default:
        return { assertion: a, passed: false, message: `unknown assertion type: ${(a as any).type}` };
    }
  } catch (e: any) {
    return { assertion: a, passed: false, message: e?.message || String(e) };
  }
}

export function evaluateAll(
  output: string,
  assertions: Assertion[],
  trajectory?: Array<{ type: string; name?: string }>
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(output, a, trajectory));
}