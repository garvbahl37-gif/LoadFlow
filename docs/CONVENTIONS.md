# CONVENTIONS — read before writing a single line

**This stack is NOT the one in your training data.** Next.js **16.2.10**, React **19.2.4**, Prisma **7.8.0**, Tailwind **v4.3.2**, Zod **4.4.3**.
Every rule below was verified empirically (compiled, typechecked, or executed) against *this* repo — not recalled. If you write the API you remember from Next 14 / Prisma 5 / Tailwind 3, **it will break**.

---

##  The five that will bite you hardest

1. **Prisma has no built-in SQLite driver.** You MUST pass a driver adapter.
2. **`params`, `searchParams`, `cookies()`, `headers()` are all Promises.** `await` them. The Next 15 sync shim is gone.
3. **It's `proxy.ts`, not `middleware.ts`.**
4. **Never `import { PrismaClient } from "@prisma/client"`.** That package exports no models here.
5. **`shadow-sm` in Tailwind v4 is v3's `shadow`** (one step bigger than you think), and `bg-opacity-*` compiles to *nothing*.

---

## Prisma 7

```ts
// the only correct import
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import type { Load, User } from "@/generated/prisma/models";
import { LoadStatus } from "@/generated/prisma/enums";

//  import { PrismaClient } from "@prisma/client"   ← exports no models. Will not work.
```

**Client construction requires an adapter** (`PrismaClientOptions` is a union demanding `adapter` or `accelerateUrl`):

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";  // note lowercase "qlite"
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }),
});
```

Use the singleton in `src/lib/db.ts` — never construct `PrismaClient` anywhere else.

* `datasource` in `schema.prisma` has **no `url`**. The URL lives in `prisma.config.ts` (CLI) and is passed to the adapter at runtime (app). `DATABASE_URL` resolves **relative to the project root**, so it must be `file:./prisma/dev.db`.
* **`prisma migrate dev` no longer runs `generate`.** Always run `npx prisma generate` after a schema edit. (`postinstall` does it too.)
* **Seeding does NOT use `package.json` `"prisma": { "seed" }`.** It lives in `prisma.config.ts` → `migrations.seed: "tsx prisma/seed.ts"`. Run `npx prisma db seed`.
* SQLite on Prisma 7 **does support `enum` and `Json`**. It does **not** support scalar lists (`String[]` → error P1012). Use a `Json` column or a child table.
* Do **not** add `serverExternalPackages` — Next already lists `@prisma/client`, `prisma`, `better-sqlite3`.

## Next.js 16 — request APIs

```ts
// Route handler — params is a PROMISE
import { NextResponse, type NextRequest } from "next/server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;              // ← await is mandatory
  const body = await req.json();
  const q = req.nextUrl.searchParams.get("status");
  return NextResponse.json({ id }, { status: 200 });
}
```

> The global `RouteContext<'/api/loads/[id]'>` helper also works, but only after `next typegen` and only for routes that exist on disk. **Prefer the explicit `{ params: Promise<{...}> }` annotation** — it never goes stale and never blocks a build.

```tsx
// Page — params AND searchParams are Promises
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
}
```

**Cookies:**

```ts
import { cookies } from "next/headers";
const store = await cookies();                    // Promise!
const sid = store.get("lf_session")?.value;
```
* **Read:** anywhere on the server.
* **Set / delete:** ONLY inside a Server Action or a Route Handler. Setting a cookie while rendering a Server Component is unsupported and throws.

**Other hard rules:**
* `redirect()` **throws** — call it *outside* `try/catch`, never `return redirect(...)`.
* Route Handler `GET` is **dynamic by default**. Do not write `export const dynamic = "force-dynamic"` — it's noise.
* `fetch` is **not** cached by default.
* `'use cache'` / `cacheLife` / `cacheTag` **do nothing** — `cacheComponents` is off in `next.config.ts`. Don't use them.
* Never use `forbidden()` / `unauthorized()` — experimental, disabled, and they render HTML. Return `NextResponse.json({ error }, { status: 403 })`.
* `NextRequest.ip` / `.geo` **do not exist**. Read `x-forwarded-for` from headers.
* Client Components can **never** be `async`.
* Turbopack is the default. Do **not** add `--turbopack` to scripts or a webpack config.

## Server Actions

* `useActionState` comes from **`react`** (not `useFormState` from `react-dom`) and returns a **3-tuple**: `const [state, formAction, isPending] = useActionState(action, initialState)`.
* After a DB mutation in a Server Action, call **`updateTag(...)`** or `revalidatePath(...)` — otherwise the page will not reflect your own write.
* `revalidateTag` now takes **two** args (`revalidateTag('loads', 'max')`). One arg is a TS error. In Server Actions prefer `updateTag`.
* In this codebase, mutations go through **Route Handlers** (`/api/**`) called from client components, so the API layer is the single enforcement boundary and is curl-able. Use `router.refresh()` after a successful mutation to re-render server components. Server Actions are used only for login/logout/signup (which need to set cookies).

## Zod 4

```ts
z.email()                     //   not z.string().email()
z.string().min(1, { error: "Required" })   //   not { message: ... } / invalid_type_error
z.flattenError(err).fieldErrors            //   not err.flatten()
```

## Tailwind v4

No `tailwind.config.js` — **do not create one.** Theme is CSS-first in `src/app/globals.css` via `@theme`. Dark mode is class-based via `@custom-variant dark (&:where(.dark, .dark *));`.

| Don't write (v3 habit) | Because | Write instead |
|---|---|---|
| `shadow-sm` | = v3's `shadow` — one step too big | `shadow-xs` for a hairline shadow |
| `rounded-sm` | = v3's `rounded` (0.25rem) | `rounded-xs` for 0.125rem |
| `outline-none` | now removes the outline entirely | `outline-hidden` |
| `ring` | is **1px** and defaults to **currentColor** | `ring-2 ring-brand-500` — always name the color |
| `bg-opacity-50` | **compiles to nothing** | `bg-black/50` |
| `border` alone | default border color is `currentColor`, not gray | `border border-line` |
| `bg-gradient-to-r` | legacy alias | `bg-linear-to-r` |
| `flex-shrink-0` | legacy alias | `shrink-0` |
| `@apply` in a CSS module | hard build error | just use utility classes |

Only `clsx` is installed — there is **no** `tailwind-merge`, no `cva`. Don't import a `cn` helper that doesn't exist; use `clsx`.

## House style

* Path alias is `@/*` → `./src/*`.
* All DB access goes through `src/lib/db.ts`.
* All authorization goes through `src/lib/authz/*`. **Never** compare a role *name* in a conditional — check a permission. A grep for role names in `if` statements must come back empty; there is a test that enforces this.
* Every API mutation writes an `AuditLog` row. Every denial writes one with `outcome: "DENIED"`.
* Errors from the API are always `{ error: string, ...detail }` with a correct status code: `401` unauthenticated, `403` permission denied, `404` out of scope (we never confirm the existence of a record you may not see), `409` illegal state transition, `422` validation.
