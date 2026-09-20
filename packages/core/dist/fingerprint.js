import { createHash } from "node:crypto";
export function sha256(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
export function makeFingerprint(prompt, input, state, meta = {}) {
    return {
        promptHash: sha256(prompt),
        inputHash: sha256(input),
        model: meta.model,
        provider: meta.provider,
        createdAt: new Date().toISOString(),
        state,
    };
}
export function checkDrift(fp, currentPrompt, currentInput) {
    if (!fp)
        return { drifted: false };
    const p = sha256(currentPrompt);
    const i = sha256(currentInput);
    if (p !== fp.promptHash)
        return { drifted: true, reason: "prompt changed" };
    if (i !== fp.inputHash)
        return { drifted: true, reason: "input changed" };
    return { drifted: false };
}
