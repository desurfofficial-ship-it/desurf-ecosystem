import { resolve, relative, isAbsolute } from "node:path";

/** Normalize suite-relative paths to portable forward slashes. */
export function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

/** Resolve rel under root; throw if escape. Returns absolute path. */
export function containPath(rootDir: string, rel: string, label = "path"): string {
  if (!rel || typeof rel !== "string") {
    throw new Error(`Desurf: invalid ${label}`);
  }
  rel = normalizeRel(rel);
  if (isAbsolute(rel) || rel.includes("\0")) {
    throw new Error(`Desurf: ${label} must be relative and non-null: ${rel}`);
  }
  const root = resolve(rootDir);
  // resolve with OS separators
  const full = resolve(root, ...rel.split("/").filter(Boolean));
  const relToRoot = relative(root, full);
  const norm = relToRoot.replace(/\\/g, "/");
  if (norm.startsWith("..") || isAbsolute(relToRoot)) {
    throw new Error(`Desurf: ${label} escapes suite directory: ${rel}`);
  }
  return full;
}
