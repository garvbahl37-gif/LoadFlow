#!/usr/bin/env bash
#
# Rotate the production database password.
#
# Run this AFTER resetting the password in the Supabase dashboard
# (Project Settings -> Database -> Reset database password).
#
# It reads the new password from a prompt that does not echo, so the secret never lands
# in your shell history, in this repo, or in a chat transcript. It preserves the existing
# user/host/port/query of both connection strings and swaps only the password — so it
# cannot mangle the pooler hostnames, which is the easiest way to break this by hand.
#
#   ./scripts/rotate-db-password.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .vercel ]; then
  echo "No .vercel directory — run 'npx vercel link' first." >&2
  exit 1
fi

printf 'New Supabase database password (input hidden): '
read -rs NEW_PASSWORD
printf '\n'

if [ -z "$NEW_PASSWORD" ]; then
  echo "Empty password — aborting." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Reading the current connection strings from Vercel"
npx vercel env pull "$TMP/env" --environment=production >/dev/null 2>&1

# Swap ONLY the password component, percent-encoding it. A password containing '@', '#',
# '/' or ':' will silently corrupt the URL otherwise — '@' in particular makes the parser
# treat the rest of the password as part of the hostname.
rebuild() {
  python3 - "$1" "$NEW_PASSWORD" <<'PY'
import re, sys, urllib.parse
url, pw = sys.argv[1], sys.argv[2]
m = re.match(r'^(?P<scheme>\w+://)(?P<user>[^:]+):(?P<pw>[^@]*)@(?P<rest>.+)$', url)
if not m:
    sys.exit(f"Could not parse connection string: {url[:40]}...")
print(f"{m['scheme']}{m['user']}:{urllib.parse.quote(pw, safe='')}@{m['rest']}")
PY
}

CUR_DB="$(grep -E '^DATABASE_URL=' "$TMP/env" | cut -d= -f2- | sed 's/^"//;s/"$//')"
CUR_DIRECT="$(grep -E '^DIRECT_URL=' "$TMP/env" | cut -d= -f2- | sed 's/^"//;s/"$//')"

NEW_DB="$(rebuild "$CUR_DB")"
NEW_DIRECT="$(rebuild "$CUR_DIRECT")"

echo "==> Verifying the new password actually works before changing anything"
DIRECT_URL="$NEW_DIRECT" npx tsx -e '
import { Client } from "pg";
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  try { await c.connect(); await c.query("select 1"); await c.end(); console.log("    connection OK"); }
  catch (e) { console.error("    FAILED:", (e as Error).message); process.exit(1); }
})();
'

echo "==> Updating the Vercel environment variables"
for ENV in production preview; do
  for VAR in DATABASE_URL DIRECT_URL; do
    npx vercel env rm "$VAR" "$ENV" --yes >/dev/null 2>&1 || true
  done
  printf '%s' "$NEW_DB"     | npx vercel env add DATABASE_URL "$ENV" >/dev/null 2>&1
  printf '%s' "$NEW_DIRECT" | npx vercel env add DIRECT_URL   "$ENV" >/dev/null 2>&1
  echo "    $ENV updated"
done

echo "==> Redeploying (env changes only take effect on a new deployment)"
npx vercel deploy --prod --yes >/dev/null 2>&1

echo "==> Verifying the live deployment still works"
BASE="$(npx vercel inspect --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("url",""))' 2>/dev/null || true)"
BASE="${BASE:-https://loadflow-garvbahl37-gifs-projects.vercel.app}"
[[ "$BASE" == http* ]] || BASE="https://$BASE"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@meridian.com","password":"loadflow"}')"

if [ "$CODE" = "200" ]; then
  echo "    live login OK ($BASE)"
  echo
  echo "Done. Old password is dead; nothing in git or in this repo ever held it."
else
  echo "    live login returned HTTP $CODE — check 'npx vercel logs'." >&2
  exit 1
fi
