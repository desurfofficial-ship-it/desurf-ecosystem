import type { Assertion, AssertionResult } from "./types.js";
export declare function evaluateAssertion(output: string, assertion: Assertion, trajectory?: Array<{
    type: string;
    name?: string;
}>): AssertionResult;
export declare function evaluateAll(output: string, assertions: Assertion[] | null | undefined, trajectory?: Array<{
    type: string;
    name?: string;
}>): AssertionResult[];
