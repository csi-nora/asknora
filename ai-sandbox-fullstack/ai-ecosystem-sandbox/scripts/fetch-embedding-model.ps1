<#
.SYNOPSIS
  Vendor the dense-embedding runtime + model for FULLY OFFLINE operation.

.DESCRIPTION
  Downloads (on a machine WITH internet) the transformers.js runtime, the
  onnxruntime-web WASM backends, and the quantized Xenova/all-MiniLM-L6-v2 model
  into csi-nora-v2/public/ so they ship in the Angular dist and are served from
  the SAME origin by nginx. After this runs once, the app embeds documents with
  NO internet access (air-gapped VM) instead of falling back to "BM25 only".

.EXAMPLE
  .\scripts\fetch-embedding-model.ps1
#>
param(
  [string]$PublicDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'csi-nora-v2\public'),
  [string]$TransformersVersion = '2.17.1'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$modelDir  = Join-Path $PublicDir 'models\Xenova\all-MiniLM-L6-v2'
$onnxDir    = Join-Path $modelDir 'onnx'
$vendorDir = Join-Path $PublicDir 'vendor\transformers'
New-Item -ItemType Directory -Force -Path $onnxDir, $vendorDir | Out-Null

function Get-File($url, $out) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 300
    "  OK  {0,8:N0} KB  {1}" -f ((Get-Item $out).Length/1KB), (Split-Path $out -Leaf)
  } catch {
    "  FAIL  $url  -> $($_.Exception.Message)"
  }
}

$cdn = "https://cdn.jsdelivr.net/npm/@xenova/transformers@$TransformersVersion/dist"
$hf  = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main'

Write-Host "==> Runtime (transformers.js + ORT WASM) -> $vendorDir"
# Library (try minified, fall back to full)
$lib = Join-Path $vendorDir 'transformers.min.js'
Get-File "$cdn/transformers.min.js" $lib
if (-not (Test-Path $lib) -or (Get-Item $lib).Length -lt 10000) {
  Get-File "$cdn/transformers.js" $lib
}
foreach ($w in 'ort-wasm.wasm','ort-wasm-simd.wasm','ort-wasm-threaded.wasm','ort-wasm-simd-threaded.wasm') {
  Get-File "$cdn/$w" (Join-Path $vendorDir $w)
}

Write-Host "==> Model (quantized Xenova/all-MiniLM-L6-v2) -> $modelDir"
foreach ($f in 'config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json') {
  Get-File "$hf/$f" (Join-Path $modelDir $f)
}
Get-File "$hf/onnx/model_quantized.onnx" (Join-Path $onnxDir 'model_quantized.onnx')

Write-Host "==> pdf.js (offline PDF text extraction for KB uploads) -> $PublicDir\vendor\pdfjs"
$pdfjsDir = Join-Path $PublicDir 'vendor\pdfjs'
New-Item -ItemType Directory -Force -Path $pdfjsDir | Out-Null
$pdfBase = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'
Get-File "$pdfBase/pdf.min.js"        (Join-Path $pdfjsDir 'pdf.min.js')
Get-File "$pdfBase/pdf.worker.min.js" (Join-Path $pdfjsDir 'pdf.worker.min.js')

Write-Host ""
Write-Host "Vendored asset tree:" -ForegroundColor Green
Get-ChildItem -Recurse $PublicDir | Where-Object { -not $_.PSIsContainer } |
  ForEach-Object { "  {0,10:N0} B  {1}" -f $_.Length, $_.FullName.Replace($PublicDir,'') }
Write-Host ""
Write-Host "Done. Rebuild the UI (npm run build) so these ship in dist/csi-nora/browser." -ForegroundColor Cyan
