#!/usr/bin/env bash
# ============================================================
# CyberKnight — Encode video gốc thành bộ stream tối ưu cho mạng yếu
#
#   video-src/<level>/<ten goc>.mp4   (nguồn, KHÔNG commit — gitignored)
#        └─> video/<level>/<name>.mp4             720p H.264 ~1.3 Mbps, faststart (fallback)
#        └─> video/<level>/hls/<name>/master.m3u8 HLS ABR: 720p / 480p / 360p / 240p, segment 2s
#
# Cách dùng:
#   bash scripts/encode-videos.sh              # encode tất cả (bỏ qua file đã có)
#   FORCE=1 bash scripts/encode-videos.sh      # encode lại toàn bộ
#   JOBS=2 bash scripts/encode-videos.sh       # số file encode song song (mặc định 3)
#   bash scripts/encode-videos.sh level2/intro # chỉ các file có key chứa chuỗi này
#
# Yêu cầu: ffmpeg + ffprobe (brew install ffmpeg / apt install ffmpeg)
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ROOT="${SRC_ROOT:-$ROOT/video-src}"
OUT_ROOT="${OUT_ROOT:-$ROOT/video}"
JOBS="${JOBS:-3}"
FORCE="${FORCE:-0}"
PRESET="${PRESET:-medium}"

# Danh sách: "<level>/<name-dau-ra>|<file nguồn tương đối trong video-src/>"
# Tên đầu ra luôn ASCII, không dấu, không khoảng trắng (URL an toàn, nginx/CDN friendly).
MANIFEST=(
  "level0/intro|level0/intro.mp4"
  "level0/bad|level0/bad.mp4"
  "level0/good|level0/good.mp4"
  "level1/intro|level1/intro.mp4"
  "level1/bad|level1/bad.mp4"
  "level1/middle|level1/middle.mp4"
  "level1/good|level1/good.mp4"
  "level2/intro|level2/gioi thieu.mp4"
  "level2/bad|level2/hau qua xau.mp4"
  "level2/good|level2/hau qua tot.mp4"
  "level3/scene1|level3/scene1.mp4"
  "level3/scene2|level3/scene2.mp4"
  "level3/scene3|level3/scene3.mp4"
  "level3/scene4|level3/scene4.mp4"
  "level3/scene5|level3/scene5.mp4"
  "level4/scene1|level4/scene1.mp4"
  "level4/scene2|level4/scene2.mp4"
  "level4/scene3|level4/scene3.mp4"
  "level4/scene4|level4/scene4.mp4"
  "level4/scene5|level4/scene5.mp4"
  "level4/scene6|level4/scene6.mp4"
)

# Bậc chất lượng: height:crf:maxrate:bufsize:audio
# maxrate/bufsize khống chế đỉnh bitrate để không bị "nghẽn" trên mạng yếu.
RENDITIONS=(
  "720:23:1400k:2800k:96k"
  "480:24:750k:1500k:64k"
  "360:25:420k:840k:48k"
  "240:28:200k:400k:32k"
)
# Độ dài segment HLS (giây). 2s = bắt đầu phát sau ~1 segment nhỏ (~60 KB ở 240p) — tối ưu mạng yếu.
HLS_TIME="${HLS_TIME:-2}"

command -v ffmpeg >/dev/null || { echo "❌ Thiếu ffmpeg"; exit 1; }
command -v ffprobe >/dev/null || { echo "❌ Thiếu ffprobe"; exit 1; }

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

encode_one() {
  local key="$1" src="$2"
  local level="${key%%/*}" name="${key##*/}"
  local out_dir="$OUT_ROOT/$level"
  local hls_dir="$out_dir/hls/$name"
  local tmp_dir
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ckenc.XXXXXX")"

  if [ ! -f "$src" ]; then
    log "⚠️  [$key] không tìm thấy nguồn: $src — bỏ qua"
    rm -rf "$tmp_dir"; return 0
  fi
  if [ "$FORCE" != "1" ] && [ -f "$out_dir/$name.mp4" ] && [ -f "$hls_dir/master.m3u8" ]; then
    log "⏭  [$key] đã có, bỏ qua (FORCE=1 để encode lại)"
    rm -rf "$tmp_dir"; return 0
  fi

  mkdir -p "$out_dir" "$hls_dir"
  rm -f "$hls_dir"/*.m3u8 "$hls_dir"/*.ts

  printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n' > "$tmp_dir/master.m3u8"

  local r h crf maxrate bufsize abr
  for r in "${RENDITIONS[@]}"; do
    IFS=: read -r h crf maxrate bufsize abr <<< "$r"
    local mp4="$tmp_dir/${name}_${h}p.mp4"
    log "🎬 [$key] encode ${h}p (crf $crf, max $maxrate)"
    ffmpeg -hide_banner -loglevel error -nostdin -y -i "$src" \
      -map 0:v:0 -map '0:a:0?' \
      -vf "scale=-2:${h}:flags=lanczos,fps=30,format=yuv420p" \
      -c:v libx264 -preset "$PRESET" -crf "$crf" -maxrate "$maxrate" -bufsize "$bufsize" \
      -profile:v main -level 3.1 \
      -x264-params "keyint=60:min-keyint=60:scenecut=0" \
      -force_key_frames "expr:gte(t,n_forced*2)" \
      -c:a aac -b:a "$abr" -ac 2 -ar 44100 \
      -movflags +faststart \
      "$mp4"

    # Remux MP4 -> HLS (không encode lại, cắt đúng keyframe 2s => segment HLS_TIME giây)
    ffmpeg -hide_banner -loglevel error -nostdin -y -i "$mp4" \
      -c copy -map 0 \
      -f hls -hls_time "$HLS_TIME" -hls_playlist_type vod \
      -hls_flags independent_segments -hls_segment_type mpegts \
      -hls_segment_filename "$hls_dir/${h}p_%03d.ts" \
      "$hls_dir/${h}p.m3u8"

    local br w peak
    br="$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$mp4")"
    w="$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$mp4")"
    # BANDWIDTH = đỉnh (maxrate + audio), AVERAGE-BANDWIDTH = thực tế đo được
    peak=$(( ${maxrate%k} * 1000 + ${abr%k} * 1000 ))
    printf '#EXT-X-STREAM-INF:BANDWIDTH=%d,AVERAGE-BANDWIDTH=%d,RESOLUTION=%sx%s,CODECS="avc1.4d401f,mp4a.40.2",FRAME-RATE=30.000\n%sp.m3u8\n' \
      "$peak" "$br" "$w" "$h" "$h" >> "$tmp_dir/master.m3u8"

    if [ "$h" = "720" ]; then
      mv "$mp4" "$out_dir/$name.mp4"
    else
      rm -f "$mp4"
    fi
  done

  mv "$tmp_dir/master.m3u8" "$hls_dir/master.m3u8"
  rm -rf "$tmp_dir"
  log "✅ [$key] xong → mp4 $(du -h "$out_dir/$name.mp4" | cut -f1), hls $(du -sh "$hls_dir" | cut -f1)"
}

run_chunk() {
  local key src
  while IFS='|' read -r key src; do
    [ -n "$key" ] || continue
    encode_one "$key" "$src"
  done
}

# Chia việc round-robin cho $JOBS tiến trình nền (tương thích bash 3.2 của macOS)
FILTER="${1:-}"
JOBDIR="$(mktemp -d "${TMPDIR:-/tmp}/ckjobs.XXXXXX")"
i=0
for entry in "${MANIFEST[@]}"; do
  key="${entry%%|*}"; rel="${entry##*|}"
  if [ -n "$FILTER" ] && [[ "$key" != *"$FILTER"* ]]; then continue; fi
  printf '%s|%s\n' "$key" "$SRC_ROOT/$rel" >> "$JOBDIR/chunk.$(( i % JOBS ))"
  i=$(( i + 1 ))
done

log "🚀 Bắt đầu encode $i file, $JOBS job song song, preset=$PRESET"
for f in "$JOBDIR"/chunk.*; do
  [ -f "$f" ] || continue
  run_chunk < "$f" &
done
wait
rm -rf "$JOBDIR"

log "🏁 Hoàn tất. Tổng dung lượng video/: $(du -sh "$OUT_ROOT" | cut -f1)"
