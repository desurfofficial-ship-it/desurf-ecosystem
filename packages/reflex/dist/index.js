/**
 * Desurf Reflex — zero-config behavioral cassette for any Node LLM call.
 *
 * One idea people will love: drop this in, set DESURF_REFLEX=record|replay,
 * and every OpenAI-compatible fetch becomes a sealed contract automatically.
 *
 * Mode:
 *   record  — call live, write cassette under .desurf-reflex/
 *   replay  — never hit network; return cassette or throw if missing
 *   auto    — replay if cassette exists, else record
 *   off     — passthrough
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
function sha(s) {
    return createHash("sha256").update(s).digest("hex").slice(0, 24);
}
function modeFromEnv() {
    const m = (process.env.DESURF_REFLEX || "off").toLowerCase();
    if (m === "record" || m === "replay" || m === "auto" || m === "off")
        return m;
    return "off";
}
function keyFromBody(body) {
    try {
        const j = JSON.parse(body);
        // stable key: model + messages content
        const model = j.model || "unknown";
        const msgs = JSON.stringify(j.messages || j.input || j.prompt || body);
        return sha(model + "::" + msgs);
    }
    catch {
        return sha(body);
    }
}
let installed = false;
/**
 * Install global fetch interceptor. Call once at process start.
 * Returns uninstall function.
 */
export function installReflex(opts = {}) {
    if (installed)
        return () => { };
    installed = true;
    const dir = opts.dir || process.env.DESURF_REFLEX_DIR || join(process.cwd(), ".desurf-reflex");
    const mode = opts.mode || modeFromEnv();
    const match = opts.match ||
        /openrouter\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|localhost|127\.0\.0\.1/;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (mode === "off" || !match.test(url)) {
            return original(input, init);
        }
        const method = (init?.method || "GET").toUpperCase();
        if (method !== "POST")
            return original(input, init);
        const body = typeof init?.body === "string" ? init.body : init?.body ? await new Response(init.body).text() : "";
        const id = keyFromBody(body);
        const cassettePath = join(dir, id + ".json");
        const readCassette = async () => {
            const raw = await readFile(cassettePath, "utf8");
            return JSON.parse(raw);
        };
        const writeCassette = async (res, text) => {
            await mkdir(dir, { recursive: true });
            const headers = {};
            res.headers.forEach((v, k) => {
                headers[k] = v;
            });
            await writeFile(cassettePath, JSON.stringify({
                url,
                status: res.status,
                headers,
                body: text,
                recordedAt: new Date().toISOString(),
                requestBodyHash: id,
            }, null, 2));
        };
        if (mode === "replay" || mode === "auto") {
            try {
                const c = await readCassette();
                return new Response(c.body, { status: c.status, headers: c.headers });
            }
            catch {
                if (mode === "replay") {
                    throw new Error(`[desurf-reflex] missing cassette ${id} — run with DESURF_REFLEX=record first`);
                }
                // auto → fall through to record
            }
        }
        // record (or auto miss)
        const res = await original(input, init);
        const clone = res.clone();
        const text = await clone.text();
        if (mode === "record" || mode === "auto") {
            await writeCassette(res, text);
        }
        return new Response(text, { status: res.status, headers: res.headers });
    };
    return () => {
        globalThis.fetch = original;
        installed = false;
    };
}
export function makeContractCard(partial) {
    return { version: "2.0", ...partial };
}
export async function writeContractCard(path, card) {
    await writeFile(path, JSON.stringify(card, null, 2));
}
export async function readContractCard(path) {
    return JSON.parse(await readFile(path, "utf8"));
}
export const REFLEX_VERSION = "2.0.0";
