import { createHash } from "node:crypto";
export function sha256(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
export function makeFingerprint(prompt, input, state, meta = {}) {
    const fp = {
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
export function checkDrift(fp, currentPrompt, currentInput, currentOutput) {
    if (!fp)
        return { drifted: false };
    if (fp.promptHash && fp.promptHash !== sha256(currentPrompt)) {
        return { drifted: true, reason: "prompt changed" };
    }
    if (fp.inputHash && fp.inputHash !== sha256(currentInput)) {
        return { drifted: true, reason: "input changed" };
    }
    if (fp.outputHash &&
        currentOutput != null &&
        fp.outputHash !== sha256(currentOutput)) {
        return { drifted: true, reason: "output changed (sealed cassette tampered)" };
    }
    return { drifted: false };
}
