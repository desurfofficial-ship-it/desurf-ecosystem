import { createHash } from "node:crypto";
import type { CassetteState, Fingerprint } from "./types.js";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function makeFingerprint(
  prompt: string,
  input: string,
  state: CassetteState,
  meta: { model?: string; provider?: string; output?: string } = {}
): Fingerprint {
  const fp: Fingerprint = {
    promptHash: sha256(prompt),
    inputHash: sha256(input),
    model: meta.model,
    provider: meta.provider,
    createdAt: new Date().toISOString(),
    state,
  };
  if (meta.output != null) {
    fp.outputHash = sha256(meta.output);
  }
  return fp;
}

export function checkDrift(
  fp: Fingerprint | undefined | null,
  currentPrompt: string,
  currentInput: string,
  currentOutput?: string
): { drifted: boolean; reason?: string } {
  if (!fp) return { drifted: false };
  if (fp.promptHash && fp.promptHash !== sha256(currentPrompt)) {
    return { drifted: true, reason: "prompt changed" };
  }
  if (fp.inputHash && fp.inputHash !== sha256(currentInput)) {
    return { drifted: true, reason: "input changed" };
  }
  if (
    fp.outputHash &&
    currentOutput != null &&
    fp.outputHash !== sha256(currentOutput)
  ) {
    return { drifted: true, reason: "output changed (sealed cassette tampered)" };
  }
  return { drifted: false };
}
