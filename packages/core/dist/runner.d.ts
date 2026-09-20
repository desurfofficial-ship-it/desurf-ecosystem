import type { Suite, TestCase, CaseResult, SuiteResult } from "./types.js";
export declare function runCase(suiteDir: string, tc: TestCase, opts?: {
    liveOutput?: string;
}): Promise<CaseResult>;
export declare function runSuite(suiteDir: string, suite: Suite, opts?: {
    parallel?: boolean;
    caseFilter?: string;
}): Promise<SuiteResult>;
