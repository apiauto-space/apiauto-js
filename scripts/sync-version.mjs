// Runs from `npm version`: writes the new package.json version into src/version.ts.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const file = new URL("../src/version.ts", import.meta.url);
const source = readFileSync(file, "utf8").replace(/VERSION = "[^"]*"/, `VERSION = "${version}"`);
writeFileSync(file, source);
console.log(`src/version.ts -> ${version}`);
