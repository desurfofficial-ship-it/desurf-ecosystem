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

export type ReflexMode = "record" | "replay" | "auto" | "off";

export interface ReflexOptions {
  dir?: string;
  mode?: ReflexMode;
  /** Only intercept URLs matching this (default: openrouter|openai|anthropic|localhost) */
  match?: RegExp;
}

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function modeFromEnv(): ReflexMode {
  const m = (process.env.DESURF_REFLEX || "off").toLowerCase();
  if (m === "record" || m === "replay" || m === "auto" || m === "off") return m;
  return "off";
}

function keyFromBody(body: string): string {
  try {
    const j = JSON.parse(body);
    // stable key: model + messages content
    const model = j.model || "unknown";
    const msgs = JSON.stringify(j.messages || j.input || j.prompt || body);
    return sha(model + "::" + msgs);
  } catch {
    return sha(body);
  }
}

let installed = false;

/**
 * Install global fetch interceptor. Call once at process start.
 * Returns uninstall function.
 */
export function installReflex(opts: ReflexOptions = {}): () => void {
  if (installed) return () => {};
  installed = true;

  const dir = opts.dir || process.env.DESURF_REFLEX_DIR || join(process.cwd(), ".desurf-reflex");
  const mode = opts.mode || modeFromEnv();
  const match =
    opts.match ||
    /openrouter\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|localhost|127\.0\.0\.1/;

  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (mode === "off" || !match.test(url)) {
      return original(input, init);
    }

    const method = (init?.method || "GET").toUpperCase();
    if (method !== "POST") return original(input, init);

    const body = typeof init?.body === "string" ? init.body : init?.body ? await new Response(init.body).text() : "";
    const id = keyFromBody(body);
    const cassettePath = join(dir, id + ".json");

    const readCassette = async () => {
      const raw = await readFile(cassettePath, "utf8");
      return JSON.parse(raw) as { status: number; headers: Record<string, string>; body: string };
    };

    const writeCassette = async (res: Response, text: string) => {
      await mkdir(dir, { recursive: true });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      await writeFile(
        cassettePath,
        JSON.stringify(
          {
            url,
            status: res.status,
            headers,
            body: text,
            recordedAt: new Date().toISOString(),
            requestBodyHash: id,
          },
          null,
          2
        )
      );
    };

    if (mode === "replay" || mode === "auto") {
      try {
        const c = await readCassette();
        return new Response(c.body, { status: c.status, headers: c.headers });
      } catch {
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

/** Contract Card — single-file portable behavioral DNA */
export interface ContractCard {
  version: "2.0";
  id: string;
  name: string;
  prompt: string;
  input: string;
  output: string;
  assertions: Array<Record<string, unknown>>;
  fingerprint?: {
    promptHash: string;
    inputHash: string;
    state: string;
    createdAt: string;
  };
  trajectory?: Array<{ type: string; name?: string; args?: unknown }>;
}

export function makeContractCard(partial: Omit<ContractCard, "version">): ContractCard {
  return { version: "2.0", ...partial };
}

export async function writeContractCard(path: string, card: ContractCard): Promise<void> {
  await writeFile(path, JSON.stringify(card, null, 2));
}

export async function readContractCard(path: string): Promise<ContractCard> {
  return JSON.parse(await readFile(path, "utf8")) as ContractCard;
}

export const REFLEX_VERSION = "2.0.0";
