import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = process.cwd();
const collectMarkdown = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectMarkdown(path);
    return extname(entry.name) === ".md" ? [path] : [];
  });

const markdownFiles = [
  resolve(root, "README.md"),
  resolve(root, "SECURITY.md"),
  ...collectMarkdown(resolve(root, "docs")),
];
const failures = [];

for (const absoluteFile of markdownFiles) {
  const relativeFile = absoluteFile.slice(root.length + 1);
  const contents = readFileSync(absoluteFile, "utf8");
  for (const [, rawTarget] of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = rawTarget.replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [encodedPath, fragment] = target.split("#");
    const localPath = decodeURIComponent(encodedPath);
    const resolvedTarget = resolve(dirname(absoluteFile), localPath);
    if (!existsSync(resolvedTarget)) {
      failures.push(`${relativeFile}: missing local link target ${target}`);
      continue;
    }
    const lineMatch = /^L(\d+)$/.exec(fragment ?? "");
    if (lineMatch) {
      const line = Number(lineMatch[1]);
      const lineCount = readFileSync(resolvedTarget, "utf8").split("\n").length;
      if (line > lineCount)
        failures.push(`${relativeFile}: ${target} exceeds ${lineCount} lines`);
    }
  }
}

const compatibility = readFileSync(
  resolve(root, "docs/DEMETER_README_COMPATIBILITY.md"),
  "utf8",
);
for (const staleClaim of [
  "performs four gates",
  "| ADA fee estimation | **Live proven**",
]) {
  if (compatibility.includes(staleClaim)) {
    failures.push(
      `docs/DEMETER_README_COMPATIBILITY.md: stale claim '${staleClaim}'`,
    );
  }
}

const lockfile = readFileSync(resolve(root, "package-lock.json"), "utf8");
if (lockfile.includes("git+ssh://git@github.com/verbotenj/cardano-raw-sdk")) {
  failures.push(
    "package-lock.json: public SDK dependency must use HTTPS so CI needs no SSH key",
  );
}
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const dependency = manifest.dependencies["cardano-raw-sdk"];
const lock = JSON.parse(lockfile);
if (!/^https:\/\/github\.com\/verbotenj\/cardano-raw-sdk\/archive\/[0-9a-f]{40}\.tar\.gz$/.test(dependency) ||
    lock.packages[""].dependencies["cardano-raw-sdk"] !== dependency ||
    lock.packages["node_modules/cardano-raw-sdk"].resolved !== dependency ||
    !lock.packages["node_modules/cardano-raw-sdk"].integrity) {
  failures.push(
    "package-lock.json: SDK dependency is not pinned to the reviewed HTTPS archive",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Documentation verification passed (${markdownFiles.length} files).`,
);
