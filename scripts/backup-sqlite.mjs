import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const sourcePath = resolve(
  process.argv[2] ?? process.env.XGUARD_DATABASE_PATH ?? "./xguard.db",
);
const backupDirectory = resolve(process.argv[3] ?? "./backups");
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = resolve(
  backupDirectory,
  `${basename(sourcePath)}.${stamp}.sqlite`,
);
if (dirname(destination) !== backupDirectory)
  throw new Error(
    "Resolved backup destination escaped the requested directory",
  );
const database = new DatabaseSync(sourcePath, { readOnly: true });
try {
  const pages = await backup(database, destination);
  const verified = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = verified.prepare("PRAGMA integrity_check").get();
    if (result?.integrity_check !== "ok")
      throw new Error("Backup integrity check failed");
  } finally {
    verified.close();
  }
  console.log(
    JSON.stringify({
      event: "backup_completed",
      destination,
      pages,
      verified: true,
    }),
  );
} finally {
  database.close();
}
