#!/usr/bin/env bash
# make-loop.sh - turn any audio file into a seamless ambient loop for the app.
#
# Usage: make-loop.sh <input-audio> <output.mp3> [start-seconds] [length-seconds]
#
#   start-seconds   where in the input to start (default 0)
#   length-seconds  length of the finished loop (default 60). The input must
#                   contain at least length + 2 seconds after the start point.
#
# What it does:
#   1. cuts length+2 s from the input, mixes down to mono, resamples to 32 kHz
#   2. makes the loop seamless: the extra 2 s at the end are crossfaded
#      (equal power) into the first 2 s, so the end of the file flows straight
#      into its beginning
#   3. measures loudness and applies a gain to reach -23 LUFS integrated, with
#      a peak limiter at -6 dBFS (keeps true peak below -2 dBTP after MP3
#      encoding; run around the loop point so the seam is unaffected)
#   4. encodes MP3, mono, 32 kHz, 64 kbps CBR (about 0.5 MB per minute)
#
# Then add the file to web/public/sounds/sounds.json and CREDITS.md.
# Requires ffmpeg and ffprobe.
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 4 ]; then
  echo "usage: $0 <input-audio> <output.mp3> [start-seconds] [length-seconds]" >&2
  exit 2
fi

in=$1
out=$2
start=${3:-0}
len=${4:-60}
xf=2          # crossfade length in seconds
target=-23    # integrated loudness, LUFS
ceiling=0.5   # limiter ceiling, linear (-6 dBFS; headroom for MP3 overshoot)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 1. Cut, mono, 32 kHz, float WAV (no lossy step until the very end).
ffmpeg -nostdin -v error -y -ss "$start" -t "$(awk "BEGIN{print $len+$xf}")" -i "$in" \
  -vn -ac 1 -ar 32000 -c:a pcm_f32le "$tmp/seg.wav"

have=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/seg.wav")
if awk "BEGIN{exit !($have < $len+$xf-0.1)}"; then
  echo "error: only $have s available after start=$start; need $(awk "BEGIN{print $len+$xf}") s" >&2
  exit 1
fi

# 2. Seamless loop: [tail] fades out while the first xf seconds of [body] fade
#    in, so the file ends at seg[len] and begins with seg[len] -> seg[0].
ffmpeg -nostdin -v error -y -i "$tmp/seg.wav" -filter_complex "
  [0]atrim=0:$len,asetpts=PTS-STARTPTS,asplit=1[body];
  [0]atrim=$len:$(awk "BEGIN{print $len+$xf}"),asetpts=PTS-STARTPTS[tail];
  [tail][body]acrossfade=d=$xf:c1=qsin:c2=qsin" -c:a pcm_f32le "$tmp/loop.wav"

# 3. Loudness: measure, then apply a plain gain (no dynamic processing) + limiter.
measured=$(ffmpeg -nostdin -hide_banner -y -i "$tmp/loop.wav" -af ebur128 -f null - 2>&1 \
  | awk '/Integrated loudness:/{f=1} f&&/I:/{print $2; exit}')
gain=$(awk "BEGIN{printf \"%.2f\", $target-($measured)}")

# 4. Gain + limiter. The limiter has a 5 ms look-ahead (it delays the signal by
#    ~160 samples), so run it over three back-to-back copies of the loop and
#    keep the middle copy, shifted by the look-ahead. Any whole-length window
#    of a periodic signal is itself a seamless loop, and the limiter state at
#    its start/end is already correct. Limiting lowers loudness on peaky
#    material (typing, pages), so re-measure and top the gain up, up to 8 times.
render() { # $1 = gain in dB -> $tmp/lim.wav
  ffmpeg -nostdin -v error -y -i "$tmp/loop.wav" -filter_complex "
    [0]asplit=3[a][b][c];[a][b][c]concat=n=3:v=0:a=1,
    volume=${1}dB,
    alimiter=limit=$ceiling:attack=5:release=50:level=disabled,
    atrim=start=$(awk "BEGIN{print $len+0.005}"):duration=$len,asetpts=PTS-STARTPTS" \
    -c:a pcm_f32le "$tmp/lim.wav"
}
for _ in 1 2 3 4 5 6 7 8; do
  render "$gain"
  got=$(ffmpeg -nostdin -hide_banner -y -i "$tmp/lim.wav" -af ebur128 -f null - 2>&1 \
    | awk '/Integrated loudness:/{f=1} f&&/I:/{print $2; exit}')
  err=$(awk "BEGIN{printf \"%.2f\", $target-($got)}")
  if awk "BEGIN{exit !(($err) < 0.3 && ($err) > -0.3)}"; then break; fi
  gain=$(awk "BEGIN{printf \"%.2f\", $gain+$err}")
done

# 5. Encode.
ffmpeg -nostdin -v error -y -i "$tmp/lim.wav" \
  -ac 1 -ar 32000 -c:a libmp3lame -b:a 64k -map_metadata -1 -fflags +bitexact "$out"

echo "wrote $out (gain ${gain} dB, input ${measured} LUFS, limited loop ${got} LUFS)"
