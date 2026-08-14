import { readFile } from "node:fs/promises";
import fg from "fast-glob";

const files = await fg(
  [
    "packages/**/src/**/*.{ts,js}",
    "apps/**/src/**/*.{ts,js}",
    "scripts/**/*.{js,mjs}",
  ],
  { ignore: ["scripts/check-no-todos.mjs"] },
);
const offenders = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (/\b(?:TODO|FIXME|HACK)\b/.test(text)) offenders.push(file);
}
if (offenders.length > 0) {
  console.error(`Unfinished markers found in: ${offenders.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("No TODO/FIXME/HACK markers found in executable source.");
}
