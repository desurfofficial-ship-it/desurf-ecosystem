/** Normalize suite-relative paths to portable forward slashes. */
export declare function normalizeRel(rel: string): string;
/** Resolve rel under root; throw if escape. Returns absolute path. */
export declare function containPath(rootDir: string, rel: string, label?: string): string;
