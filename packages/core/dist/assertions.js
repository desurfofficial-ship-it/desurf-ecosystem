/** Deterministic local "confidence" heuristic (Jev-inspired). */
function localConfidence(text, options) {
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
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        score = Math.min(0.95, score + 0.2);
    }
    return { choice: best, confidence: Math.round(score * 100) / 100 };
}
/** Reject patterns that are likely catastrophic backtracking (ReDoS). */
function isDangerousRegex(pattern) {
    if (pattern.length > 200)
        return "pattern too long (max 200)";
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
        return "nested quantifiers rejected (ReDoS risk)";
    }
    if (/(\.\*){2,}|(\.\+){2,}/.test(pattern)) {
        return "stacked wildcards rejected (ReDoS risk)";
    }
    return null;
}
function safeRegexTest(pattern, flags, text) {
    const danger = isDangerousRegex(pattern);
    if (danger)
        return { ok: false, error: danger };
    let re;
    try {
        re = new RegExp(pattern, flags);
    }
    catch (e) {
        return { ok: false, error: `invalid regex: ${e?.message || e}` };
    }
    const sample = text.length > 50_000 ? text.slice(0, 50_000) : text;
    try {
        return { ok: re.test(sample) };
    }
    catch (e) {
        return { ok: false, error: `regex execution failed: ${e?.message || e}` };
    }
}
export function evaluateAssertion(output, assertion, trajectory) {
    const a = assertion;
    try {
        switch (a.type) {
            case "required": {
                const val = String(a.value ?? "");
                if (!val) {
                    return { assertion: a, passed: false, message: "required assertion needs non-empty value" };
                }
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
                if (!val)
                    return { assertion: a, passed: true };
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
                const pattern = a.pattern || String(a.value || "");
                if (!pattern) {
                    return { assertion: a, passed: false, message: "regex assertion needs pattern" };
                }
                const flags = a.caseSensitive === false ? "i" : "";
                const result = safeRegexTest(pattern, flags, output);
                if (result.error) {
                    return { assertion: a, passed: false, message: result.error };
                }
                return {
                    assertion: a,
                    passed: result.ok,
                    message: result.ok ? undefined : `regex failed: /${pattern}/${flags}`,
                };
            }
            case "json_schema": {
                let parsed;
                try {
                    parsed = JSON.parse(output);
                }
                catch {
                    const m = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                    if (m) {
                        try {
                            parsed = JSON.parse(m[0]);
                        }
                        catch {
                            return { assertion: a, passed: false, message: "output is not valid JSON" };
                        }
                    }
                    else {
                        return { assertion: a, passed: false, message: "output is not valid JSON" };
                    }
                }
                const schema = (a.value || {});
                if (schema.type === "object" &&
                    typeof parsed === "object" &&
                    parsed !== null &&
                    !Array.isArray(parsed)) {
                    const props = schema.properties || {};
                    const req = schema.required || Object.keys(props);
                    for (const k of req) {
                        if (!(k in parsed)) {
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
                const expected = a.value || [];
                const actual = (trajectory || [])
                    .filter((t) => t.type === "tool")
                    .map((t) => t.name || "");
                const ok = expected.length === actual.length && expected.every((e, i) => actual[i] === e);
                return {
                    assertion: a,
                    passed: ok,
                    message: ok
                        ? undefined
                        : `trajectory mismatch. expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
                };
            }
            case "confidence":
            case "choice": {
                const opts = a.options || (Array.isArray(a.value) ? a.value : ["pass", "fail"]);
                const { choice, confidence } = localConfidence(output, opts);
                const threshold = a.threshold ?? 0.7;
                const target = typeof a.value === "string" ? a.value : opts[0];
                const passed = a.type === "confidence"
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
                return {
                    assertion: a,
                    passed: false,
                    message: `unknown assertion type: ${a.type}`,
                };
        }
    }
    catch (e) {
        return { assertion: a, passed: false, message: e?.message || String(e) };
    }
}
export function evaluateAll(output, assertions, trajectory) {
    return assertions.map((a) => evaluateAssertion(output, a, trajectory));
}
