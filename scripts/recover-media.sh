#!/usr/bin/env bash
# Recover the still-reachable archived media from the nv-pu-sa dataset.
#
# WHY: 324 of the 332 records store only a dead R2 pointer
# (/api/media?key=avatars%2F<handle>_400x400.jpg) — the origin twimg URL was
# discarded on migration, and the R2-backed endpoint is no longer deployed, so
# those images are gone. Only 8 records never migrated and still carry a raw
# twimg URL. Those are recoverable *right now*; verified live on 2026-09-01.
#
# Of those 8, one (@Limokkii) is suspended: its avatar still returns 200 but its
# banner 403s. Suspension appears to purge banners while leaving avatars on the
# CDN — so the avatar is the part worth grabbing before it rots.
#
# NOT RUN AUTOMATICALLY. Review, then: bash scripts/recover-media.sh

set -uo pipefail

SRC="${SRC:-/home/fcs/x-vault/_reference/nvpusa/data_archive.json}"
OUT="${OUT:-/home/fcs/x-vault/recovered-media}"

mkdir -p "$OUT/avatars" "$OUT/covers"

python3 - "$SRC" <<'PY' > /tmp/recover_list.tsv
import json, sys
records = json.load(open(sys.argv[1]))
for r in records:
    # Only records whose pointer is still an origin URL are recoverable.
    if 'twimg' not in (r.get('avatar_url') or ''):
        continue
    print('\t'.join([
        r['screen_name'],
        r.get('avatar_url') or '',
        r.get('cover_url') or '',
        str(r.get('is_suspended', 0)),
    ]))
PY

total=0 ok=0 failed=0

while IFS=$'\t' read -r handle avatar cover suspended; do
  [ -z "$handle" ] && continue
  tag=""
  [ "$suspended" != "0" ] && tag=" [tombstoned]"
  echo "== @${handle}${tag}"

  if [ -n "$avatar" ]; then
    total=$((total + 1))
    dest="$OUT/avatars/${handle}_400x400.jpg"
    code=$(curl -sSL -m 30 --retry 2 -o "$dest" -w '%{http_code}' "$avatar" || echo 000)
    if [ "$code" = "200" ] && [ -s "$dest" ]; then
      echo "   avatar  OK   $(wc -c < "$dest") bytes"
      ok=$((ok + 1))
    else
      echo "   avatar  FAIL HTTP $code"
      rm -f "$dest"
      failed=$((failed + 1))
    fi
  fi

  if [ -n "$cover" ]; then
    total=$((total + 1))
    dest="$OUT/covers/${handle}_banner.jpg"
    code=$(curl -sSL -m 30 --retry 2 -o "$dest" -w '%{http_code}' "$cover" || echo 000)
    if [ "$code" = "200" ] && [ -s "$dest" ]; then
      echo "   banner  OK   $(wc -c < "$dest") bytes"
      ok=$((ok + 1))
    else
      # Expected for suspended accounts — banners get purged, avatars do not.
      echo "   banner  FAIL HTTP $code"
      rm -f "$dest"
      failed=$((failed + 1))
    fi
  fi
done < /tmp/recover_list.tsv

rm -f /tmp/recover_list.tsv

echo
echo "recovered $ok/$total assets ($failed failed) -> $OUT"
echo
echo "Reminder: this only rescues the 8 unmigrated records. The other 324"
echo "records' archived images are unrecoverable without the original R2 bucket."
echo "In the replica, store BOTH the R2 key and the origin URL so a dead bucket"
echo "is never a total loss."
