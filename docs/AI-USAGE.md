# How this was built with an AI coding tool

Built with **Claude Code (Opus 4.8)**, using a deliberate process rather than a conversation. The commit history is the honest record — each commit message says what was built and, where it matters, what was found broken and fixed.

The summary: **I never let the model write application code from memory, I made it prove things instead of assert them, and I treated its output as a pull request from a fast junior engineer rather than as an answer.**

---

## 1. Establish ground truth before writing a line of code

`create-next-app` scaffolded **Next.js 16**, and installing Prisma gave me **Prisma 7** — both of which post-date most of the model's fluency. A model writing confidently from Next 14 / Prisma 5 muscle memory would have produced code that looks perfect and does not run.

So the first thing I did was not write code. It was to send parallel agents into `node_modules/next/dist/docs` (423 bundled doc files) and the installed Prisma typings with one instruction: **do not answer from memory; read the source and cite the file.** A sixth agent then cross-examined their five reports for contradictions and re-verified the disputed claims by compiling code.

That found a **project-ending bug before it existed**:

> **Prisma 7 has no built-in SQLite driver.** `PrismaClientOptions` is a union requiring an explicit `adapter`. `@prisma/adapter-better-sqlite3` wasn't installed — the app could not have connected to its own database.

It also caught that `middleware.ts` is now `proxy.ts`, that `params` and `cookies()` are Promises that must be awaited, that Prisma 7 moved seed config out of `package.json`, and that Tailwind v4 silently redefines `shadow-sm` (it's v3's `shadow` — one step too big) while `bg-opacity-*` compiles to *nothing at all*.

The output became **[docs/CONVENTIONS.md](CONVENTIONS.md)**, which every later agent was required to read first. Roughly 20 minutes of research that saved a day of debugging code that compiled and misbehaved.

**The habit:** when the stack is newer than the model, make it *read* before it writes, and make it cite what it read.

## 2. Write the contract first, then parallelise against it

I wrote the load-bearing pieces myself — the Prisma schema, the permission catalog, the authorization guard, the state machine, the compliance evaluator, the audit logger — because they're the part where a subtle mistake is a *security* bug, not a rendering bug. Then I froze them and wrote two documents:

* **[docs/ARCHITECTURE.md](ARCHITECTURE.md)** — the domain contract.
* **[docs/API.md](API.md)** — the REST contract, endpoint by endpoint, with the exact status code each failure must return.

Only then did I fan out **13 agents in parallel** — six building API modules, seven building UI — each with **strictly disjoint file ownership** and the same frozen contract. Because the interface was pinned in advance, the API and the UI could be built *simultaneously* by agents that never spoke to each other, and they fit together on the first typecheck.

**The habit:** the model is very good at filling in a well-specified box and unreliable at deciding what the box should be. So I decide the box.

## 3. Prompt for the failure mode, not just the feature

Generic prompts get generic code. Every agent brief named the specific way that module could be got *wrong*:

> "Out-of-scope loads **404, never 403** — a 403 confirms the record exists, and a carrier fishing for a competitor's load IDs must learn nothing."

> "**Never accept a permission from the client.** Look it up in the `TRANSITIONS` table."

> "Filter the shipper's timeline by an **allowlist** of actions, not a denylist. Getting this wrong is an information leak between counterparties."

> "Do **not** silently hide a disabled button — render it disabled *with the reason*. Showing a locked door is how you prove the lock exists."

That last one is why the UI tells a Dispatcher *"Overriding a compliance flag requires the `load.override_compliance_flag` permission"* instead of just not rendering the button. The instruction produced the feature.

## 4. Make it prove the claim, not assert it

The brief says *"code checks permissions, never role names."* That's easy to write in a README and easy to violate three weeks later. So instead of trusting it, [`tests/no-role-names.test.ts`](../tests/no-role-names.test.ts) **greps the entire source tree and fails the build** if any conditional branches on a role name, or reads `session.permissions` without going through `can()` (which would skip the org-type lock).

Likewise, "the API is the enforcement boundary" is a claim — so [`scripts/rbac-proof.ts`](../scripts/rbac-proof.ts) signs in as each persona and **attacks the REST API over HTTP with no UI involved**: 24 assertions, exits non-zero on failure.

I also caught myself writing a bad test. One assertion — *"Carrier Dispatch cannot update status"* — passed with a **409**, not the **403** I wanted: the load happened to be in a state where the transition was invalid, so it failed *before* the permission was ever checked. It was green for the wrong reason. I rewrote it against a load where the move is genuinely legal, so a 403 can only mean the permission was refused, and added the paired positive control (the Driver, who *does* hold it, makes the same move on the same load and gets a 200).

**The habit:** a test that can pass without exercising the thing it claims to test is worse than no test, because it buys false confidence.

## 5. Review the output — it is confidently wrong in specific, findable ways

Every agent reported "typecheck clean." All 13 were telling the truth, and the app still had real defects. Typechecking is not verifying. So I ran it, screenshotted every page as every persona, and read the results.

What that found — none of which any agent flagged, and none of which a typechecker could:

| Found by | Defect |
|---|---|
| **Looking at a screenshot** | The audit trail on a delivered load was **completely empty**. Six state changes had happened; the seed never wrote their history. The brief explicitly requires "each change timestamped and attributed" — and the flagship screen showed *"Nothing has happened yet."* |
| **Reading the POD route** | The response set `Content-Security-Policy: … sandbox`, which stops the browser's PDF viewer rendering the document *at all*. Correct-looking security header; broken feature. |
| **Reading the seed** | No POD was seeded — so the entire upload → verify → shipper-sees-proof chain had no demo data. |
| **Cross-checking the UI against the seed** | The login page advertised two shipper orgs (*"Cascade Manufacturing", "Northgate Foods"*) that **do not exist**. Plausible, fluent, invented. |
| **Thinking about the threat model** | Every JSON endpoint is CSRF-safe by content-type — but the POD upload is `multipart/form-data`, a content type a cross-site form *can* send. A real (if low-impact) hole, which no agent mentioned. Now closed with a `Sec-Fetch-Site` check. |

The invented org names are the most instructive one. It's the model's characteristic failure: not *incoherent*, but **fluent and unverified**. It needed shipper names for a UI panel, didn't check the seed, and wrote two that sounded right. Nothing in a typecheck, a lint, or a test would ever catch it — only reading the output against the source of truth.

**The habit:** treat model output as a PR from someone fast, capable, and occasionally confidently wrong. Run it, look at it, and check its claims against the ground truth rather than against its own confidence.

## 6. Verify by driving the real thing

The last check wasn't a test — it was the actual product behaviour, exercised end to end against the running server:

```
BEFORE  LF-1043: CARRIER_ASSIGNED | blocking flags: 1
  advance attempt -> 409 "This load has an unresolved compliance flag."
RENEW insurance  -> 200 | reevaluated: 1 | unblocked: [LF-1043]
AFTER   LF-1043: CARRIER_ASSIGNED | blocking flags: 0
  advance attempt -> 409 "No rate confirmation has been agreed for this load."
```

That last line is the one I care about. After the insurance was renewed, the compliance gate **released** — and the *next* guard in the state machine correctly took over. The guards are layered and independently real, not one boolean pretending to be a system. No unit test told me that. Running it did.

---

## What I'd tell someone doing this next

1. **If the stack is newer than the model, make it read the docs first — and cite them.** It will otherwise write beautiful code for last year's API.
2. **Specify the contract; parallelise the filling-in.** Thirteen agents on a frozen interface converge. Thirteen agents on a vague one produce thirteen incompatible codebases.
3. **Name the failure mode in the prompt.** "Return 404, not 403, and here's why" produces better code than "implement the endpoint."
4. **Make it prove things.** Grep-tests and HTTP-level proofs beat prose assurances, in a README and in your own head.
5. **Look at the output.** The bugs that survive typecheck, lint and tests are the ones you can only find by running the app and reading what it actually says.
