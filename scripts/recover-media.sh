#!/usr/bin/env bash
# 从一份导出的归档 JSON 里，把仍然可达的原始媒体抢救到本地。
#
# 适用场景：某份导出数据里的记录只剩一个失效的 R2 指针
# (/api/media?key=avatars%2F<handle>_400x400.jpg)，原始 twimg URL 在迁移时被丢弃，
# 而那个 R2 端点也已不再部署 —— 这些图就彻底没了。只有少数记录还带着原始
# twimg URL，那些是**当下**还能抢救的，越早跑越好。
#
# 注意：已封号的账号，头像通常还在 CDN 上（返回 200），banner 往往已被清除（403）。
# 所以头像是更值得优先抓的部分。
#
# 不会自动运行。先 review，然后：
#   SRC=/path/to/data_archive.json bash scripts/recover-media.sh

set -uo pipefail

# 必须显式指定输入文件 —— 没有默认值，避免指向一个不存在的路径静默失败
SRC="${SRC:?请用 SRC=/path/to/data_archive.json 指定导出的归档 JSON}"
OUT="${OUT:-./recovered-media}"

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
