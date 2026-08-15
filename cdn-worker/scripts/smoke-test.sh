#!/usr/bin/env bash
# Ověří všechny endpointy proti běžícímu `wrangler dev` (výchozí port 8787).
# Použití:  ./smoke-test.sh [base_url]
set -u

BASE="${1:-http://127.0.0.1:8787}"
TOKEN="test-token"
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

echo "== Auth =="
check "upload bez tokenu → 401" 401 "$(code -X POST "$BASE/api/upload")"
# Neplatný token dostane stejnou odpověď jako chybějící — rozdíl by prozrazoval,
# že token existuje, jen nemá práva.
check "upload se špatným tokenem → 401" 401 \
  "$(code -X POST -H 'Authorization: Bearer wrong' "$BASE/api/upload")"

echo "== Manifest =="
check "manifest zápis" 200 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"gallery","data":{"albums":[],"updatedAt":1}}' "$BASE/api/manifest")"
check "manifest čtení" 200 "$(code "$BASE/gallery.json")"
check "neplatný typ manifestu → 400" 400 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"type":"hacked","data":{}}' "$BASE/api/manifest")"

echo "== Upload =="
printf '\xff\xd8\xff\xe0 fake jpeg' > /tmp/cdn-test.jpg
check "upload jpg" 200 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -F 'path=gallery/landscape' -F 'files=@/tmp/cdn-test.jpg' "$BASE/api/upload")"
check "nahraný soubor je dostupný" 200 "$(code "$BASE/gallery/landscape/cdn-test.jpg")"
check "HEAD na nahraný soubor" 200 "$(code -I "$BASE/gallery/landscape/cdn-test.jpg")"

printf 'not allowed' > /tmp/cdn-test.exe
UPLOAD_EXE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -F 'path=gallery/landscape' -F 'files=@/tmp/cdn-test.exe' "$BASE/api/upload")
case "$UPLOAD_EXE" in
  *'not allowed'*) echo "  OK   .exe odmítnut"; pass=$((pass+1)) ;;
  *) echo "  FAIL .exe nebyl odmítnut — $UPLOAD_EXE"; fail=$((fail+1)) ;;
esac

echo "== Path traversal =="
check "upload do ../ → 400" 400 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -F 'path=../../etc' -F 'files=@/tmp/cdn-test.jpg' "$BASE/api/upload")"
check "upload do api/ → 400" 400 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -F 'path=api' -F 'files=@/tmp/cdn-test.jpg' "$BASE/api/upload")"

echo "== Delete =="
check "smazání manifestu zakázáno → 403" 403 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"path":"gallery.json"}' "$BASE/api/delete")"
check "smazání souboru" 200 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"path":"gallery/landscape/cdn-test.jpg"}' "$BASE/api/delete")"
check "smazaný soubor → 404" 404 "$(code "$BASE/gallery/landscape/cdn-test.jpg")"
check "smazání neexistujícího → 404" 404 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"path":"gallery/nope.jpg"}' "$BASE/api/delete")"

echo "== Users =="
# users.json nese hashe hesel — ven se nesmí dostat ani s platným tokenem.
# Přihlašování a správu účtů pokrývá auth-test.sh.
check "users.json není veřejný → 404" 404 "$(code "$BASE/users.json")"
check "zrušený save-users → 404" 404 "$(code -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"users":[]}' "$BASE/api/save-users")"

echo "== Contact (validace, bez odeslání) =="
check "prázdná pole → 400" 400 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"name":"","email":"","message":""}' "$BASE/api/contact")"
check "neplatný e-mail → 400" 400 "$(code -X POST -H 'Content-Type: application/json' \
  -d '{"name":"A","email":"nope","message":"hi"}' "$BASE/api/contact")"

echo "== Ostatní =="
check "CORS preflight" 204 "$(code -X OPTIONS "$BASE/api/upload")"
check "kompatibilita /api/upload.php" 401 "$(code -X POST "$BASE/api/upload.php")"
check "GET na /api/ → 405" 405 "$(code "$BASE/api/upload")"
check "neexistující soubor → 404" 404 "$(code "$BASE/nic/tady.jpg")"

rm -f /tmp/cdn-test.jpg /tmp/cdn-test.exe
echo
echo "Prošlo: $pass, selhalo: $fail"
[ "$fail" -eq 0 ]
