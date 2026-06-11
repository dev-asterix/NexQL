#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXQL_THEMES_DIR =
  process.env.NEXQL_THEMES_DIR ?? join(ROOT, "..", "NexQL-Themes");
const SRC = join(NEXQL_THEMES_DIR, "src", "site", "parse-theme-summary.mjs");
const DEST_DIR = join(ROOT, "docs", "js", "vendor");
const DEST = join(DEST_DIR, "parse-theme-summary.mjs");
const FALLBACK = join(ROOT, "docs", "js", "vendor", "parse-theme-summary.mjs");

if (existsSync(SRC)) {
  mkdirSync(DEST_DIR, { recursive: true });
  copyFileSync(SRC, DEST);
  console.log(`sync-theme-parser: copied from ${SRC}`);
} else if (existsSync(FALLBACK)) {
  console.warn(
    `sync-theme-parser: ${SRC} not found — keeping committed fallback at ${FALLBACK}`,
  );
} else {
  console.error(
    `sync-theme-parser: no parser at ${SRC} and no fallback at ${FALLBACK}`,
  );
  process.exit(1);
}
