import type { NextConfig } from "next";

/**
 * DuckDB's Node addon dlopens libduckdb.so from the platform bindings package.
 * Next/Turbopack traces duckdb.node but not that shared library, which is why
 * production dies with "libduckdb.so: cannot open shared object file".
 * Keep the packages external and force the Linux bindings into every server trace.
 */
const duckdbPackages = [
  "@duckdb/node-api",
  "@duckdb/node-bindings",
  "@duckdb/node-bindings-linux-x64",
  "@duckdb/node-bindings-linux-x64-musl",
  "@duckdb/node-bindings-linux-arm64",
  "@duckdb/node-bindings-linux-arm64-musl",
];

const duckdbNativeFiles = duckdbPackages.map(
  (pkg) => `./node_modules/${pkg}/**`,
);

const nextConfig: NextConfig = {
  serverExternalPackages: duckdbPackages,
  outputFileTracingIncludes: {
    "/**": duckdbNativeFiles,
  },
};

export default nextConfig;
