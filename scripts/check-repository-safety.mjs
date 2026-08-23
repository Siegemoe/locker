import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const listed = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }
);
if (listed.status !== 0) {
  process.stderr.write(listed.stderr || "Unable to list tracked files.\n");
  process.exit(1);
}

const trackedFiles = listed.stdout.split("\0").filter(Boolean);
const allowedEnvironmentFiles = new Set([".env.example"]);
const problems = [];

for (const file of trackedFiles) {
  if (/^\.env(?:\.|$)/.test(file) && !allowedEnvironmentFiles.has(file)) {
    problems.push(`${file}: tracked environment file`);
  }

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;

  const checks = [
    ["private key marker", new RegExp(["BEGIN ", "PRIVATE KEY"].join(""))],
    ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/],
    ["OpenAI-style secret key", /sk-[A-Za-z0-9_-]{20,}/],
    ["AWS access key", /AKIA[0-9A-Z]{16}/],
    ["machine-specific Windows user path", /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/i]
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(content)) problems.push(`${file}: ${label}`);
  }
}

if (problems.length) {
  console.error("Repository safety check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Repository safety check passed for ${trackedFiles.length} tracked files.`);
