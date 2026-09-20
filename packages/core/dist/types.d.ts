/** Desurf Ecosystem v2 — Core types */
export type CassetteState = "UNSEALED" | "SEALED" | "RECORDED";
export type Reliability = "PASS" | "REGRESSION" | "FLAKY" | "ERROR";
export interface Assertion {
    type: "required" | "forbidden" | "json_schema" | "regex" | "tool_call" | "trajectory" | "confidence" | "choice";
    value?: string | string[] | Record<string, unknown>;
    pattern?: string;
    caseSensitive?: boolean;
    /** For confidence / choice assertions */
    threshold?: number;
    options?: string[];
    instructions?: string;
}
export interface TestCase {
    id: string;
    input: string;
    prompt: string;
    output: string;
    assertions: Assertion[];
    /** Agent / multi-turn support */
    turns?: Array<{
        role: string;
        content: string;
    }>;
    tools?: string[];
    /** Cut-point / Chronicle style boundaries (future) */
    boundaries?: string[];
}
export interface Suite {
    name: string;
    cases: TestCase[];
    version?: string;
}
export interface Fingerprint {
    promptHash: string;
    inputHash: string;
    model?: string;
    provider?: string;
    createdAt: string;
    state: CassetteState;
}
export interface Cassette {
    output: string;
    fingerprint?: Fingerprint;
    /** Optional trajectory for agents */
    trajectory?: Array<{
        type: "llm" | "tool";
        name?: string;
        args?: Record<string, unknown>;
        result?: string;
    }>;
}
export interface AssertionResult {
    assertion: Assertion;
    passed: boolean;
    message?: string;
    confidence?: number;
}
export interface CaseResult {
    id: string;
    reliability: Reliability;
    cassetteState: CassetteState;
    assertions: AssertionResult[];
    durationMs: number;
    error?: string;
    drift?: boolean;
}
export interface SuiteResult {
    name: string;
    results: CaseResult[];
    passed: number;
    flaky: number;
    regression: number;
    error: number;
    totalMs: number;
    exitCode: 0 | 1 | 2;
}
