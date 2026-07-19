#!/usr/bin/env bash
# ============================================================================
# fetch-embedding-model.sh — vendor the dense-embedding runtime + model + pdf.js
# for FULLY OFFLINE operation (air-gapped VM).
#
# Run this ONCE on a machine WITH internet. It downloads the transformers.js
# runtime, the onnxruntime-web WASM backends, the quantized Xenova/all-MiniLM-L6-v2
# model, and pdf.js into csi-nora-v2/public/ so they ship in the Angular dist and
# are served from the SAME origin by nginx. After this, the app embeds documents
# and parses PDFs with NO internet access instead of falling back to "BM25 only".
#
# Usage:  ./scripts/fetch-embedding-model.sh
# ============================================================================
set -euo pipefail

TF_VERSION="${TF_VERSION:-2.17.1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
PUBLIC_DIR="${PUBLIC_DIR:-$REPO_ROOT/csi-nora-v2/public}"

MODEL_DIR="$PUBLIC_DIR/models/Xenova/all-MiniLM-L6-v2"
ONNX_DIR="$MODEL_DIR/onnx"
VENDOR_DIR="$PUBLIC_DIR/vendor/transformers"
PDFJS_DIR="$PUBLIC_DIR/vendor/pdfjs"
mkdir -p "$ONNX_DIR" "$VENDOR_DIR" "$PDFJS_DIR"

CDN="https://cdn.jsdelivr.net/npm/@xenova/transformers@${TF_VERSION}/dist"
HF="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main"
PDFB="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174"

dl() { # url out
  if curl -fsSL "$1" -o "$2"; then
    printf '  OK  %8s  %s\n' "$(du -h "$2" | cut -f1)" "$(basename "$2")"
  else
    printf '  FAIL  %s\n' "$1"
  fi
}

echo "==> Runtime (transformers.js + ORT WASM) -> $VENDOR_DIR"
dl "$CDN/transformers.min.js" "$VENDOR_DIR/transformers.min.js"
if [ ! -s "$VENDOR_DIR/transformers.min.js" ]; then dl "$CDN/transformers.js" "$VENDOR_DIR/transformers.min.js"; fi
# Only the non-threaded WASM are needed (no cross-origin isolation / SharedArrayBuffer).
dl "$CDN/ort-wasm.wasm"      "$VENDOR_DIR/ort-wasm.wasm"
dl "$CDN/ort-wasm-simd.wasm" "$VENDOR_DIR/ort-wasm-simd.wasm"

echo "==> Model (quantized Xenova/all-MiniLM-L6-v2) -> $MODEL_DIR"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  dl "$HF/$f" "$MODEL_DIR/$f"
done
dl "$HF/onnx/model_quantized.onnx" "$ONNX_DIR/model_quantized.onnx"

echo "==> pdf.js (offline PDF text extraction for KB uploads) -> $PDFJS_DIR"
dl "$PDFB/pdf.min.js"        "$PDFJS_DIR/pdf.min.js"
dl "$PDFB/pdf.worker.min.js" "$PDFJS_DIR/pdf.worker.min.js"

echo ""
echo "Done. Rebuild the UI (npm run build) so these ship in dist/csi-nora/browser."
