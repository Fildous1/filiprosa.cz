#!/usr/bin/env bash
# Ověří přihlašování, session a vynucení oprávnění proti běžícímu `wrangler dev`.
# Používá break-glass ADMIN_TOKEN k založení testovacích účtů, pak testuje,
# co s nimi jde a nejde dělat.
#
# Použití:  ./auth-test.sh [base_url]
set -u

BASE="${1:-http://127.0.0.1:8787}"
ADMIN_TOKEN="test-token"
pass=0; fail=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  OK   $label ($actual)"; pass=$((pass+1))
  else
    echo "  FAIL $label — čekáno $expected, dostal $actual"; fail=$((fail+1))
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }

# Vytáhne hodnotu řetězcového pole z JSON bez závislosti na jq
field() { sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" <<< "$1"; }

echo "== Příprava účtů (přes break-glass token) =="
check "vytvoreni admina" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"sef","password":"tajneheslo123","role":"admin","isNew":true}' "$BASE/api/users/save")"

check "vytvoreni editora jen s galerii" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"pomocnik","password":"jineheslo123","role":"editor","isNew":true,"permissions":{"gallery":["upload","edit"],"museum":[],"rosnik":[]}}' \
  "$BASE/api/users/save")"

check "kratke heslo odmitnuto" 400 "$(code -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"slabak","password":"krat","role":"editor","isNew":true}' "$BASE/api/users/save")"

check "duplicitni jmeno odmitnuto" 409 "$(code -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"sef","password":"tajneheslo123","role":"admin","isNew":true}' "$BASE/api/users/save")"

echo "== users.json uz nesmi byt verejny =="
check "GET users.json -> 404" 404 "$(code "$BASE/users.json")"

echo "== Prihlaseni =="
check "spatne heslo -> 401" 401 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"username":"sef","password":"spatne"}' "$BASE/api/login")"
check "neexistujici uzivatel -> 401" 401 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"username":"nikdo","password":"cokoliv"}' "$BASE/api/login")"

ADMIN_BODY=$(body -X POST -H 'Content-Type: application/json' \
  -d '{"username":"sef","password":"tajneheslo123"}' "$BASE/api/login")
ADMIN_SESSION=$(field "$ADMIN_BODY" token)
if [ -n "$ADMIN_SESSION" ]; then
  echo "  OK   admin prihlasen, token vracen"; pass=$((pass+1))
else
  echo "  FAIL admin se neprihlasil — $ADMIN_BODY"; fail=$((fail+1))
fi

EDITOR_BODY=$(body -X POST -H 'Content-Type: application/json' \
  -d '{"username":"pomocnik","password":"jineheslo123"}' "$BASE/api/login")
EDITOR_SESSION=$(field "$EDITOR_BODY" token)
if [ -n "$EDITOR_SESSION" ]; then
  echo "  OK   editor prihlasen"; pass=$((pass+1))
else
  echo "  FAIL editor se neprihlasil — $EDITOR_BODY"; fail=$((fail+1))
fi

echo "== Session =="
check "platny token" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_SESSION" "$BASE/api/session")"
check "vymysleny token -> 401" 401 "$(code -X POST -H "Authorization: Bearer deadbeef" "$BASE/api/session")"

echo "== Opravneni editora =="
printf '\xff\xd8\xff\xe0 fake' > /tmp/auth-test.jpg

check "editor smi nahrat do gallery" 200 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -F 'path=gallery/landscape' -F 'files=@/tmp/auth-test.jpg' "$BASE/api/upload")"
check "editor NESMI nahrat do museum" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -F 'path=museum/1' -F 'files=@/tmp/auth-test.jpg' "$BASE/api/upload")"
check "editor NESMI mazat (nema delete)" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"path":"gallery/landscape/auth-test.jpg"}' "$BASE/api/delete")"
check "editor smi ulozit gallery manifest" 200 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' -d '{"type":"gallery","data":{"albums":[]}}' "$BASE/api/manifest")"
check "editor NESMI ulozit site manifest" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' -d '{"type":"site","data":{}}' "$BASE/api/manifest")"
check "editor NESMI cist seznam uzivatelu" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" "$BASE/api/users")"
check "editor NESMI zakladat uzivatele" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' -d '{"username":"podvod","password":"heslo12345","role":"admin","isNew":true}' "$BASE/api/users/save")"

echo "== Opravneni admina =="
check "admin smi do museum" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_SESSION" \
  -F 'path=museum/1' -F 'files=@/tmp/auth-test.jpg' "$BASE/api/upload")"
check "admin smi mazat" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_SESSION" \
  -H 'Content-Type: application/json' -d '{"path":"gallery/landscape/auth-test.jpg"}' "$BASE/api/delete")"
check "admin smi cist uzivatele" 200 "$(code -X POST -H "Authorization: Bearer $ADMIN_SESSION" "$BASE/api/users")"

USERS_JSON=$(body -X POST -H "Authorization: Bearer $ADMIN_SESSION" "$BASE/api/users")
case "$USERS_JSON" in
  *passwordHash*|*salt*) echo "  FAIL seznam uzivatelu obsahuje hash nebo sul!"; fail=$((fail+1)) ;;
  *) echo "  OK   seznam uzivatelu neobsahuje hashe ani soli"; pass=$((pass+1)) ;;
esac

echo "== Zmena hesla =="
check "spatne stavajici heslo -> 403" 403 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"blbost","newPassword":"novehesloo123"}' "$BASE/api/change-password")"
check "zmena hesla" 200 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"jineheslo123","newPassword":"novehesloo123"}' "$BASE/api/change-password")"
check "prihlaseni novym heslem" 200 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"username":"pomocnik","password":"novehesloo123"}' "$BASE/api/login")"
check "stare heslo uz neplati" 401 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"username":"pomocnik","password":"jineheslo123"}' "$BASE/api/login")"

echo "== Ochrana poslednich adminu =="
check "nelze smazat sam sebe" 409 "$(code -X POST -H "Authorization: Bearer $ADMIN_SESSION" \
  -H 'Content-Type: application/json' -d '{"username":"sef"}' "$BASE/api/users/delete")"

echo "== Odhlaseni =="
check "logout" 200 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" "$BASE/api/logout")"
check "token po odhlaseni neplati" 401 "$(code -X POST -H "Authorization: Bearer $EDITOR_SESSION" "$BASE/api/session")"

rm -f /tmp/auth-test.jpg
echo
echo "Prošlo: $pass, selhalo: $fail"
[ "$fail" -eq 0 ]
