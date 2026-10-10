#!/usr/bin/env node
'use strict'
/**
 * asr-align —— 逐段转写，并和"台词清单"做内容匹配
 *
 * 用法:
 *   node tools/asr-align.cjs <片段目录> <台词文本文件>
 *
 * 台词文本文件：一行一句（顺序无所谓，它会按内容匹配）。
 *   如果同一句录了多遍，会自动归组并挑出最佳 take。
 *
 * 为什么必须做这一步（血泪教训）：
 *   我们曾遇到"切出 26 段、台词正好 26 句"，看起来完美吻合 ——
 *   结果其中一段其实是**两句话并成了一段**，导致从第 7 段开始整体错位一格。
 *   参考文本错了，克隆出来的音色会莫名其妙地跑偏，而且**不会报任何错**。
 *   所以：段数吻合只是巧合的可能，必须逐段核对内容。
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { pos, opt } = C.parseArgs()
const [segDir, linesFile] = pos
if (!segDir || !linesFile) C.die('用法: node tools/asr-align.cjs <片段目录> <台词文本文件>')
if (!fs.existsSync(segDir)) C.die('目录不存在: ' + segDir)
if (!fs.existsSync(linesFile)) C.die('台词文件不存在: ' + linesFile)

const model = C.findAsrModel()
if (!model) C.die('未找到 ASR 模型。先跑：powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1')

const { addon } = C.loadSherpa()
const rec = C.makeRecognizer(addon, model)

const candidates = fs.readFileSync(linesFile, 'utf8')
  .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))

const segFiles = fs.readdirSync(segDir).filter((f) => /\.(wav)$/i.test(f)).sort()
console.log(`\n片段 ${segFiles.length} 个 · 候选台词 ${candidates.length} 句 · ASR: ${path.basename(model.dir)}\n`)

const results = []
for (const f of segFiles) {
  const { sr, samples } = C.readWav(path.join(segDir, f))
  const heard = C.asrText(addon, rec, samples, sr)
  let best = null
  candidates.forEach((txt, idx) => {
    const sc = C.textSim(heard, txt)
    if (!best || sc > best.sc) best = { idx, txt, sc }
  })
  results.push({ file: f, dur: samples.length / sr, heard, ...best })
}

// ── 内容匹配表 ──
C.hr('逐段识别 + 内容匹配')
for (const r of results) {
  const tag = r.sc >= 0.75 ? '✓' : r.sc >= 0.5 ? '~' : '✗'
  console.log(`${tag} ${r.file}  ${r.dur.toFixed(2)}s  相似 ${(r.sc * 100).toFixed(0)}%  #${r.idx + 1}`)
  console.log(`     听到: ${JSON.stringify(r.heard)}`)
  console.log(`     候选: ${JSON.stringify(r.txt)}`)
}

// ── 顺序对齐对照（看是否错位） ──
if (results.length === candidates.length) {
  C.hr('顺序对齐检查（段数 == 台词数，看是否整体错位）')
  let off = 0
  results.forEach((r, i) => {
    const positional = C.textSim(r.heard, candidates[i])
    const mark = r.idx === i ? '位置一致' : `实际是 #${r.idx + 1}（错位 ${r.idx - i > 0 ? '+' : ''}${r.idx - i}）`
    if (r.idx !== i) off++
    console.log(`  #${String(i + 1).padStart(2)}  ${mark}   位置相似度 ${(positional * 100).toFixed(0)}%`)
  })
  console.log(off ? `\n  ⚠ ${off} 处位置与内容不匹配 —— 说明有片段被合并/拆分了，别用位置对齐！` : '\n  位置与内容完全一致，顺序对齐可用。')
}

// ── 归组：每句的最佳 take ──
C.hr('按台词归组（每句挑最佳 take）')
const byIdx = new Map()
for (const r of results) {
  if (r.sc < 0.5) continue
  if (!byIdx.has(r.idx)) byIdx.set(r.idx, [])
  byIdx.get(r.idx).push(r)
}
candidates.forEach((txt, idx) => {
  const list = (byIdx.get(idx) || []).sort((a, b) => b.sc - a.sc)
  if (!list.length) { console.log(`  #${String(idx + 1).padStart(2)}  ✗ 没有匹配到   ${JSON.stringify(txt)}`); return }
  console.log(`  #${String(idx + 1).padStart(2)}  ${String(list.length)} 个 take   最佳 ${list[0].file} (${(list[0].sc * 100).toFixed(0)}%, ${list[0].dur.toFixed(2)}s)`)
})

// ── 存一份映射，供后续工具使用 ──
const mapFile = path.resolve(opt.map || path.join(C.repoRoot(), 'work', 'segment-map.json'))
fs.mkdirSync(path.dirname(mapFile), { recursive: true })
fs.writeFileSync(mapFile, JSON.stringify({
  segDir,
  linesFile,
  model: model.dir,
  mapping: results.map((r) => ({ file: r.file, dur: r.dur, bestIdx: r.idx, text: r.txt, score: r.sc, heard: r.heard })),
}, null, 2))
console.log(`\n映射已保存: ${mapFile}`)
console.log('低分项（<50%）请人工听一遍再决定，别直接采信。\n')
