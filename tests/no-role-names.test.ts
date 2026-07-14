/**
 * The brief: "code checks permissions, never role names."
 *
 * That is easy to claim and easy to violate six weeks later, so it is enforced
 * mechanically here rather than left as a promise in a README. This test greps the
 * source for any conditional that branches on a role's *name*, and fails the build
 * if it finds one.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

/** Files that are ALLOWED to mention role names: the seed-facing catalog and the
    bootstrap module, which must *create* the admin role by name exactly once. */
const ALLOWLIST = ["lib/auth/bootstrap.ts"];

/** The seeded role names, plus the shapes a lazy authorization check would take. */
const ROLE_NAMES = [
  "Organization Administrator",
  "Dispatcher",
  "Ops Lead",
  "Billing Clerk",
  "Carrier Dispatch",
  "Driver",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "generated" || entry === "node_modules") continue;
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

describe("authorization never branches on a role name", () => {
  const files = walk(SRC).filter(
    (f) => !ALLOWLIST.some((a) => relative(SRC, f).replaceAll("\\", "/") === a),
  );

  it("finds no comparison against a role name anywhere in src/", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      lines.forEach((line, i) => {
        for (const roleName of ROLE_NAMES) {
          // A comparison — `=== "Dispatcher"`, `!== 'Ops Lead'`, `.includes("Driver")`,
          // `case "Driver":` — is an authorization decision made on a name. That is the bug.
          const compared = new RegExp(
            `(===|!==|==|!=|\\.includes\\(|\\.startsWith\\(|case\\s+)\\s*["'\`]${roleName}["'\`]`,
          );
          if (compared.test(line)) {
            offenders.push(
              `${relative(SRC, file)}:${i + 1} — branches on the role name "${roleName}"\n      ${line.trim()}`,
            );
          }
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `\nAuthorization must check a PERMISSION, not a role name.\nRoles are user-authored bundles; their names mean nothing to the code.\n\n  ${offenders.join("\n  ")}\n`,
    );
  });

  it("checks that the guard is the only thing consulting session.permissions", () => {
    // `can()` and `effectivePermissions()` in guard.ts are the sanctioned readers.
    // Anything else reading `.permissions.includes(` is bypassing the org-type lock.
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel === "lib/authz/guard.ts" || rel === "lib/auth/session.ts") continue;

      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\.permissions\s*\.\s*includes\s*\(/.test(line)) {
            offenders.push(`${rel}:${i + 1} — use can(session, …) instead\n      ${line.trim()}`);
          }
        });
    }

    assert.deepEqual(
      offenders,
      [],
      `\nRead permissions through can(session, key) — it also enforces the org-type lock,\nwhich a raw .permissions.includes() silently skips.\n\n  ${offenders.join("\n  ")}\n`,
    );
  });
});
