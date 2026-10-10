#!/usr/bin/env bash
# download-models.sh -- macOS / Linux counterpart of download-models.ps1
#
# Usage:
#   bash scripts/download-models.sh              # via gh-proxy
#   MIRROR= bash scripts/download-models.sh      # direct GitHub
#   ASR_ONLY=1 bash scripts/download-models.sh
set -euo pipefail

MIRROR="${MIRROR-https://gh-proxy.com/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/models"
ASR_DIR="$MODELS/asr"
mkdir -p "$MODELS" "$ASR_DIR"

fetch() { # label url dest
  if [ -f "$3" ]; then
    echo "[skip] $1 already present ($(du -h "$3" | cut -f1))"
    return
  fi
  echo "[get ] $1"
  curl -sSL --max-time 3600 -o "$3" "${MIRROR}$2"
  [ -s "$3" ] || { rm -f "$3"; echo "download failed: $2" >&2; exit 1; }
  echo "       -> $(du -h "$3" | cut -f1)"
}

ASR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2"
ZV_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2"
VOC_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx"

if [ "${ZIPVOICE_ONLY:-0}" != "1" ]; then
  fetch "ASR model (whisper-tiny.en, ~113 MB)" "$ASR_URL" "$ASR_DIR/whisper-tiny.en.tar.bz2"
  [ -d "$ASR_DIR/sherpa-onnx-whisper-tiny.en" ] || { echo "[tar ] extracting ASR model"; tar -xjf "$ASR_DIR/whisper-tiny.en.tar.bz2" -C "$ASR_DIR"; }
fi

if [ "${ASR_ONLY:-0}" != "1" ]; then
  fetch "ZipVoice model (~104 MB)" "$ZV_URL" "$MODELS/zipvoice.tar.bz2"
  [ -d "$MODELS/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia" ] || { echo "[tar ] extracting ZipVoice model"; tar -xjf "$MODELS/zipvoice.tar.bz2" -C "$MODELS"; }
  fetch "vocos 24kHz vocoder (~52 MB)" "$VOC_URL" "$MODELS/vocos_24khz.onnx"
fi

echo
echo "Done. Now run:  node tools/check-env.cjs"
