// Fails if the app version differs between tauri.conf.json (source of truth), Cargo.toml,
// package.json files, or the release tag (optional first argument, e.g. "v1.2.3").
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const expected = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const found = {
  "Cargo.toml [workspace.package]": read("Cargo.toml").match(/\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/s)?.[1],
  "package.json": JSON.parse(read("package.json")).version,
  "web/package.json": JSON.parse(read("web/package.json")).version,
};
const tag = process.argv[2];
if (tag) found[`git tag ${tag}`] = tag.replace(/^refs\/tags\//, "").replace(/^v/, "");

let ok = /^\d+\.\d+\.\d+$/.test(expected);
if (!ok) console.error(`tauri.conf.json version "${expected}" is not MAJOR.MINOR.PATCH`);
for (const [where, v] of Object.entries(found)) {
  if (v !== expected) {
    console.error(`Version mismatch: ${where} = ${v}, tauri.conf.json = ${expected}`);
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log(`All versions = ${expected}`);
