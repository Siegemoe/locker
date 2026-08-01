import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(".env.compose");
if (existsSync(target)) {
  console.log("Local Compose secrets already configured.");
} else {
  writeFileSync(target, `SPORE_DB_PASSWORD=${randomBytes(32).toString("base64url")}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  console.log("Created gitignored local Compose secrets.");
}
