# download-models.ps1 -- fetch the two model sets this toolkit needs.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the file
# carries a UTF-8 BOM, which mangles any non-ASCII string literal.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1 -Mirror ""      # direct GitHub
#   powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1 -AsrOnly
#
# Why a mirror by default: codeload.github.com is frequently unreachable from
# mainland China (git and release downloads time out). gh-proxy works.
param(
  [string]$Mirror = 'https://gh-proxy.com/',
  [switch]$AsrOnly,
  [switch]$ZipVoiceOnly
)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$models = Join-Path $root 'models'
$asrDir = Join-Path $models 'asr'
New-Item -ItemType Directory -Force -Path $models, $asrDir | Out-Null

function Fetch($label, $url, $dest) {
  if (Test-Path $dest) {
    $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "[skip] $label already present ($mb MB)"
    return
  }
  Write-Host "[get ] $label"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & curl.exe -sSL --max-time 3600 -o $dest "$Mirror$url"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1MB) {
    if (Test-Path $dest) { Remove-Item $dest -Force }
    throw "download failed: $url`n  try a different -Mirror, or -Mirror `"`" for direct GitHub"
  }
  $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
  Write-Host "       -> $mb MB in $([math]::Round($sw.Elapsed.TotalSeconds))s"
}

$asrUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2'
$zvUrl  = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2'
$vocUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx'

if (-not $ZipVoiceOnly) {
  $asrTar = Join-Path $asrDir 'whisper-tiny.en.tar.bz2'
  Fetch 'ASR model (whisper-tiny.en, ~113 MB)' $asrUrl $asrTar
  if (-not (Test-Path (Join-Path $asrDir 'sherpa-onnx-whisper-tiny.en'))) {
    Write-Host '[tar ] extracting ASR model'
    & tar -xjf $asrTar -C $asrDir
  }
}

if (-not $AsrOnly) {
  $zvTar = Join-Path $models 'zipvoice.tar.bz2'
  Fetch 'ZipVoice model (~104 MB)' $zvUrl $zvTar
  if (-not (Test-Path (Join-Path $models 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia'))) {
    Write-Host '[tar ] extracting ZipVoice model'
    & tar -xjf $zvTar -C $models
  }
  Fetch 'vocos 24kHz vocoder (~52 MB)' $vocUrl (Join-Path $models 'vocos_24khz.onnx')
}

Write-Host ''
Write-Host 'Done. Now run:  node tools/check-env.cjs'
