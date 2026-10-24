import { pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const ROOT = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const base = path.join(ROOT, "src", rel);
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(cand)) {
        return nextResolve(pathToFileURL(cand).href, context);
      }
    }
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier) &&
    context.parentURL
  ) {
    const parentPath = new URL(context.parentURL);
    const parentDir = path.dirname(
      process.platform === "win32"
        ? decodeURIComponent(parentPath.pathname.replace(/^\//, ""))
        : decodeURIComponent(parentPath.pathname),
    );
    const resolvedBase = path.resolve(parentDir, specifier);
    for (const cand of [`${resolvedBase}.ts`, `${resolvedBase}.tsx`, path.join(resolvedBase, "index.ts")]) {
      if (existsSync(cand)) {
        return nextResolve(pathToFileURL(cand).href, context);
      }
    }
  }

  return nextResolve(specifier, context);
}
