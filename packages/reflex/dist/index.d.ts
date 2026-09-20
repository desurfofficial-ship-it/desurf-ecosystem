export type ReflexMode = "record" | "replay" | "auto" | "off";
export interface ReflexOptions {
    dir?: string;
    mode?: ReflexMode;
    /** Only intercept URLs matching this (default: openrouter|openai|anthropic|localhost) */
    match?: RegExp;
}
/**
 * Install global fetch interceptor. Call once at process start.
 * Returns uninstall function.
 */
export declare function installReflex(opts?: ReflexOptions): () => void;
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
    trajectory?: Array<{
        type: string;
        name?: string;
        args?: unknown;
    }>;
}
export declare function makeContractCard(partial: Omit<ContractCard, "version">): ContractCard;
export declare function writeContractCard(path: string, card: ContractCard): Promise<void>;
export declare function readContractCard(path: string): Promise<ContractCard>;
export declare const REFLEX_VERSION = "2.0.0";
