import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import fg from "fast-glob";
import ts from "typescript";

export interface MigrationChange {
  file: string;
  backup: string | null;
  existedBefore: boolean;
  beforeSha256: string;
  afterSha256: string;
  previousUrls: string[];
}

export interface MigrationManifest {
  version: 2;
  createdAt: string;
  gatewayUrl: string;
  projectRoot: string;
  changes: MigrationChange[];
  configurationChanges: MigrationChange[];
  detectedFrameworks: string[];
  tests: { command: string; passed: boolean | null };
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.xguard/**",
  "**/coverage/**",
];

export async function inspectProject(projectRoot: string): Promise<{
  packageJson: PackageJson;
  x402Packages: Record<string, string>;
  sourceFiles: string[];
  migratable: { file: string; urls: string[] }[];
  migrationBlockers: { file: string; reason: string }[];
  v1References: string[];
  frameworks: string[];
}> {
  const packagePath = join(projectRoot, "package.json");
  const packageJson = JSON.parse(
    await readFile(packagePath, "utf8"),
  ) as PackageJson;
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const x402Packages = Object.fromEntries(
    Object.entries(dependencies).filter(
      ([name]) => name === "x402" || name.startsWith("@x402/"),
    ),
  );
  const frameworkPackages = [
    "next",
    "express",
    "hono",
    "fastify",
    "@hapi/hapi",
    "koa",
    "nestjs",
    "@nestjs/core",
  ];
  const frameworks = frameworkPackages.filter(
    (name) => dependencies[name] !== undefined,
  );
  const sourceFiles = await fg(SOURCE_GLOBS, {
    cwd: projectRoot,
    ignore: IGNORE,
    absolute: false,
    onlyFiles: true,
  });
  const migratable: { file: string; urls: string[] }[] = [];
  const migrationBlockers: { file: string; reason: string }[] = [];
  const v1References: string[] = [];
  for (const file of sourceFiles) {
    const content = await readFile(join(projectRoot, file), "utf8");
    if (hasLegacyHeaderLiteral(content, file)) v1References.push(file);
    if (!/HTTPFacilitatorClient/.test(content)) continue;
    const edits = facilitatorUrlEdits(content, file);
    if (edits.length === 0) continue;
    const risks = facilitatorMigrationRisks(content, file);
    if (risks.length > 0) {
      migrationBlockers.push({ file, reason: [...new Set(risks)].join("; ") });
      continue;
    }
    const urls = edits.map((edit) => edit.oldUrl);
    migratable.push({ file, urls: [...new Set(urls)] });
  }
  return {
    packageJson,
    x402Packages,
    sourceFiles,
    migratable,
    migrationBlockers,
    v1References,
    frameworks,
  };
}

export async function applyMigration(
  projectRootInput: string,
  gatewayUrlInput: string,
  runTests = true,
): Promise<MigrationManifest> {
  const projectRoot = resolve(projectRootInput);
  const gatewayUrl = validateGatewayUrl(gatewayUrlInput);
  const inspection = await inspectProject(projectRoot);
  if (Object.keys(inspection.x402Packages).length === 0)
    throw new Error(
      "No x402 package dependency was detected; no files changed",
    );
  if (inspection.v1References.length > 0)
    throw new Error(
      `Legacy x402 v1 headers found in: ${inspection.v1References.join(", ")}. Run the official v1-to-v2 migration first.`,
    );
  if (inspection.migrationBlockers.length > 0)
    throw new Error(
      `Automatic migration refused because provider-specific authentication or opaque client configuration could be forwarded to XGuard: ${inspection.migrationBlockers
        .map((item) => item.file)
        .join(
          ", ",
        )}. Remove or replace that authentication manually before retrying; no files changed.`,
    );
  if (inspection.migratable.length === 0)
    throw new Error(
      "No conservative HTTPFacilitatorClient URL migration target was found; no files changed",
    );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = join(projectRoot, ".xguard", "backups", stamp);
  const changes: MigrationChange[] = [];
  await mkdir(backupRoot, { recursive: true });

  for (const target of inspection.migratable) {
    const absolute = join(projectRoot, target.file);
    const before = await readFile(absolute, "utf8");
    const backup = join(backupRoot, target.file);
    await mkdir(dirname(backup), { recursive: true });
    await copyFile(absolute, backup);
    const edits = facilitatorUrlEdits(before, target.file);
    let after = before;
    for (const edit of [...edits].sort(
      (left, right) => right.start - left.start,
    )) {
      after = `${after.slice(0, edit.start)}process.env.XGUARD_URL ?? ${JSON.stringify(gatewayUrl)}${after.slice(edit.end)}`;
    }
    if (after === before) continue;
    await writeFile(absolute, after, "utf8");
    changes.push({
      file: target.file,
      backup: relative(projectRoot, backup),
      existedBefore: true,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      previousUrls: [],
    });
  }

  if (changes.length === 0)
    throw new Error(
      "No safe literal URL replacement was available; no files changed",
    );
  const configurationChanges: MigrationChange[] = [];
  await writeTracked(
    projectRoot,
    backupRoot,
    ".env.example",
    addLine(
      await readOptional(join(projectRoot, ".env.example")),
      `XGUARD_URL=${gatewayUrl}`,
    ),
    configurationChanges,
  );
  await writeTracked(
    projectRoot,
    backupRoot,
    ".gitignore",
    addLine(
      await readOptional(join(projectRoot, ".gitignore")),
      ".xguard/backups/",
    ),
    configurationChanges,
  );
  const installedAt = new Date().toISOString();
  await writeTracked(
    projectRoot,
    backupRoot,
    "xguard.config.json",
    `${JSON.stringify({ gatewayUrl, protocolVersion: 2, installedAt }, null, 2)}\n`,
    configurationChanges,
  );

  const testCommand = chooseTestCommand(projectRoot, inspection.packageJson);
  const manifest: MigrationManifest = {
    version: 2,
    createdAt: installedAt,
    gatewayUrl,
    projectRoot,
    changes,
    configurationChanges,
    detectedFrameworks: inspection.frameworks,
    tests: { command: testCommand.join(" "), passed: null },
  };
  const manifestPath = join(backupRoot, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, ".xguard", "latest.json"),
    `${JSON.stringify({ manifest: relative(projectRoot, manifestPath) }, null, 2)}\n`,
    "utf8",
  );

  if (runTests && testCommand.length > 0) {
    const [command, ...args] = testCommand;
    if (command === undefined)
      throw new Error("Internal test command selection error");
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    manifest.tests.passed = result.status === 0;
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    if (!manifest.tests.passed) {
      await rollbackMigration(projectRoot, manifestPath, true);
      throw new Error(
        "Existing project tests failed; XGuard migration was rolled back automatically",
      );
    }
  }
  return manifest;
}

export async function rollbackLatest(
  projectRootInput: string,
): Promise<MigrationManifest> {
  const projectRoot = resolve(projectRootInput);
  const latest = JSON.parse(
    await readFile(join(projectRoot, ".xguard", "latest.json"), "utf8"),
  ) as { manifest?: string };
  if (latest.manifest === undefined)
    throw new Error("No XGuard migration manifest was found");
  return rollbackMigration(
    projectRoot,
    join(projectRoot, latest.manifest),
    false,
  );
}

async function rollbackMigration(
  projectRoot: string,
  manifestPath: string,
  forcedAfterFailedTests: boolean,
): Promise<MigrationManifest> {
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as MigrationManifest;
  const allChanges = [
    ...manifest.changes,
    ...(manifest.configurationChanges ?? []),
  ];
  for (const change of allChanges) {
    const target = join(projectRoot, change.file);
    const current = await readFile(target, "utf8");
    if (!forcedAfterFailedTests && sha256(current) !== change.afterSha256) {
      throw new Error(
        `Refusing to overwrite ${change.file}: it changed after XGuard migration`,
      );
    }
  }
  for (const change of allChanges) {
    const target = join(projectRoot, change.file);
    if (change.existedBefore ?? change.backup !== null) {
      if (change.backup === null)
        throw new Error(`Migration backup is missing for ${change.file}`);
      await copyFile(join(projectRoot, change.backup), target);
    } else {
      await rm(target, { force: true });
    }
  }
  await rm(join(projectRoot, ".xguard", "latest.json"), { force: true });
  await rm(dirname(manifestPath), { recursive: true, force: true });
  return manifest;
}

function chooseTestCommand(
  projectRoot: string,
  packageJson: PackageJson,
): string[] {
  if (packageJson.scripts?.test === undefined) return [];
  try {
    requireExisting(join(projectRoot, "pnpm-lock.yaml"));
    return ["pnpm", "test"];
  } catch {
    try {
      requireExisting(join(projectRoot, "yarn.lock"));
      return ["yarn", "test"];
    } catch {
      return ["npm", "test"];
    }
  }
}

function requireExisting(path: string): void {
  if (!existsSync(path)) throw new Error("not found");
}

function addLine(existing: string | null, line: string): string {
  const content = existing ?? "";
  if (content.split(/\r?\n/).includes(line)) return content;
  return `${content}${content.length > 0 && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
}

async function readOptional(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

async function writeTracked(
  projectRoot: string,
  backupRoot: string,
  file: string,
  after: string,
  changes: MigrationChange[],
): Promise<void> {
  const target = join(projectRoot, file);
  const before = await readOptional(target);
  if (before === after) return;
  let backup: string | null = null;
  if (before !== null) {
    const backupPath = join(backupRoot, file);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(target, backupPath);
    backup = relative(projectRoot, backupPath);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, after, "utf8");
  changes.push({
    file,
    backup,
    existedBefore: before !== null,
    beforeSha256: sha256(before ?? ""),
    afterSha256: sha256(after),
    previousUrls: [],
  });
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

interface FacilitatorUrlEdit {
  start: number;
  end: number;
  oldUrl: string;
}

function facilitatorUrlEdits(
  content: string,
  fileName: string,
): FacilitatorUrlEdit[] {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const bindings = officialHttpFacilitatorBindings(source);
  const edits: FacilitatorUrlEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      isOfficialHttpFacilitatorClient(node.expression, bindings)
    ) {
      const first = node.arguments?.[0];
      if (first !== undefined && ts.isObjectLiteralExpression(first)) {
        for (const property of first.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            propertyName(property.name) !== "url"
          )
            continue;
          if (
            !ts.isStringLiteralLike(property.initializer) ||
            !/^https?:\/\//.test(property.initializer.text)
          )
            continue;
          edits.push({
            start: property.initializer.getStart(source),
            end: property.initializer.getEnd(),
            oldUrl: property.initializer.text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits;
}

function facilitatorMigrationRisks(
  content: string,
  fileName: string,
): string[] {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const bindings = officialHttpFacilitatorBindings(source);
  const risks: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      isOfficialHttpFacilitatorClient(node.expression, bindings)
    ) {
      const first = node.arguments?.[0];
      if (first !== undefined && ts.isObjectLiteralExpression(first)) {
        const hasLiteralUrl = first.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            propertyName(property.name) === "url" &&
            ts.isStringLiteralLike(property.initializer) &&
            /^https?:\/\//.test(property.initializer.text),
        );
        if (hasLiteralUrl) {
          for (const property of first.properties) {
            if (ts.isSpreadAssignment(property)) {
              risks.push("spread configuration may contain authentication");
              continue;
            }
            if (!ts.isPropertyAssignment(property)) {
              risks.push("opaque client configuration cannot be audited");
              continue;
            }
            const name = propertyName(property.name);
            if (name === null) {
              risks.push("computed client configuration cannot be audited");
              continue;
            }
            if (name === "url") {
              if (ts.isStringLiteralLike(property.initializer)) {
                try {
                  const url = new URL(property.initializer.text);
                  if (
                    url.username !== "" ||
                    url.password !== "" ||
                    url.search !== "" ||
                    url.hash !== ""
                  )
                    risks.push(
                      "facilitator URL contains private URL components",
                    );
                } catch {
                  risks.push("facilitator URL is malformed");
                }
              }
              continue;
            }
            if (/(?:auth|header|token|api.?key|credential|secret)/i.test(name))
              risks.push("provider-specific authentication is configured");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return risks;
}

function hasLegacyHeaderLiteral(content: string, fileName: string): boolean {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isStringLiteralLike(node) &&
      /^(?:x-payment|x-payment-response)$/i.test(node.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".js") ||
          fileName.endsWith(".mjs") ||
          fileName.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
}

interface OfficialHttpFacilitatorBindings {
  named: Set<string>;
  namespaces: Set<string>;
}

function officialHttpFacilitatorBindings(
  source: ts.SourceFile,
): OfficialHttpFacilitatorBindings {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !["@x402/core/http", "@x402/core/server"].includes(
        statement.moduleSpecifier.text,
      )
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (
        (element.propertyName ?? element.name).text === "HTTPFacilitatorClient"
      )
        named.add(element.name.text);
    }
  }
  return { named, namespaces };
}

function isOfficialHttpFacilitatorClient(
  expression: ts.LeftHandSideExpression,
  bindings: OfficialHttpFacilitatorBindings,
): boolean {
  if (ts.isIdentifier(expression)) return bindings.named.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "HTTPFacilitatorClient" &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text)
  );
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : null;
}

export function validateGatewayUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("XGuard gateway URL is invalid; no files changed");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error(
      "XGuard gateway must use HTTPS, except for localhost loopback development; no files changed",
    );
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      "XGuard gateway URL must not contain credentials, query parameters, or a fragment; no files changed",
    );
  return url.toString().replace(/\/$/, "");
}
