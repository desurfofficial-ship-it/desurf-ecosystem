import { resolve, relative, isAbsolute } from "node:path";
/** Resolve rel under root; throw if escape. Returns absolute path. */
export function containPath(rootDir, rel, label = "path") {
    if (!rel || typeof rel !== "string") {
        throw new Error(`Desurf: invalid ${label}`);
    }
    if (isAbsolute(rel) || rel.includes("\0")) {
        throw new Error(`Desurf: ${label} must be relative and non-null: ${rel}`);
    }
    // Force portable suite paths (forward slashes only)
    if (rel.includes("\\")) {
        throw new Error(`Desurf: ${label} must use forward slashes only: ${rel}`);
    }
    const root = resolve(rootDir);
    const full = resolve(root, rel);
    const relToRoot = relative(root, full);
    if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
        throw new Error(`Desurf: ${label} escapes suite directory: ${rel}`);
    }
    return full;
}
