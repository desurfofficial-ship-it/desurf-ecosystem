import type { CassetteState, Fingerprint } from "./types.js";
export declare function sha256(content: string): string;
export declare function makeFingerprint(prompt: string, input: string, state: CassetteState, meta?: {
    model?: string;
    provider?: string;
    output?: string;
}): Fingerprint;
export declare function checkDrift(fp: Fingerprint | undefined | null, currentPrompt: string, currentInput: string, currentOutput?: string): {
    drifted: boolean;
    reason?: string;
};
