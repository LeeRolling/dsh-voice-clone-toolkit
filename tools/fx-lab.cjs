#!/usr/bin/env node
'use strict'
/**
 * fx-lab —— 机械音效参数搜索
 *
 * 用法:
 *   node tools/fx-lab.cjs --src=<干音.wav> --text="这句的原文" [--target=<参考音.wav>] [--iters=80]
 *
 * 打分 = 频谱贴近目标画像 55% + ASR 仍能听懂 45%
 *
 * 为什么要有 ASR 这一半：
 *   只优化"频谱像不像"很容易把语音糊成一团 —— 频谱对了，但人听不懂。
 *   加上 ASR 可懂度做约束，才能在"机器味"和"听得清"之间找到平衡点。
 *
 * 不给 --target 时，只按"可懂度 + 机械强度"打分。
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { opt } = C.parseArgs()
const src = opt.src
if (!src) C.die('用法: node tools/fx-lab.cjs --src=<干音.wav> --text="原文" [--target=参考音.wav] [--iters=80]')
if (!fs.existsSync(src)) C.die('文件不存在: ' + src)
const truth = opt.text || ''
const iters = Number(opt.iters || 80)

const dry = C.readWav(src)
const dryPeak = C.peakOf(dry.samples)
console.log(`\n干音: ${path.basename(src)}  ${dry.sr}Hz  ${(dry.samples.length / dry.sr).toFixed(2)}s  峰值 ${dryPeak.toFixed(3)}`)

let targetProfile = null
if (opt.target) {
  if (!fs.existsSync(opt.target)) C.die('参考音不存在: ' + opt.target)
  const t = C.readWav(opt.target)
  targetProfile = C.profile(t.samples, t.sr)
  console.log(`参考画像: 谱重心 ${targetProfile.centroid.toFixed(0)} Hz  频带 ${targetProfile.bands.map((x) => (x * 100).toFixed(0)).join('/')} %`)
} else {
  console.log('未给 --target，只按 可懂度 + 机械强度 打分')
}

// ASR（有 --text 才需要）
let addon = null, rec = null
if (truth) {
  const model = C.findAsrModel()
  if (!model) C.die('未找到 ASR 模型（--text 需要它做可懂度评分）。先跑 scripts/download-models.ps1')
  addon = C.loadSherpa().addon
  rec = C.makeRecognizer(addon, model)
}

// ── 随机搜索 ──
let seed = Number(opt.seed || 20261010)
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a) => a[Math.floor(rnd() * a.length)]

function sample() {
  const heavy = rnd()
  return {
    hp: pick([150, 200, 250, 300, 330]),
    ring: { f: pick([35, 42, 48, 55, 65]), mix: +(0.08 + heavy * 0.6 * rnd() + 0.08).toFixed(2) },
    comb: { ms: pick([1.0, 1.2, 1.5, 1.8, 2.2]), g: +(0.10 + heavy * 0.45 * rnd()).toFixed(2) },
    lp: pick([2800, 3300, 3800, 4500, 5200]),
    drive: pick([1.2, 1.6, 2.2, 3.0, 3.6]),
    hold: pick([1, 1, 1, 2]),
    bits: pick([14, 12, 11, 10, 9]),
    targetPeak: 0.7,
  }
}

/** 机械强度代理：环形调制深度 + 频带收窄 + 位深压缩 的加权 */
function heaviness(o) {
  return o.ring.mix / 0.7 * 0.5 + (1 - (o.lp - 2800) / 2400) * 0.3 + (14 - o.bits) / 6 * 0.2
}

C.hr(`随机搜索 ${iters} 组`)
const out = []
for (let i = 0; i < iters; i++) {
  const o = sample()
  const y = C.mechanicalFx(dry.samples, dry.sr, o)
  const d = targetProfile ? C.specDistance(C.profile(y, dry.sr), targetProfile) : 0
  let intel = 1
  let heard = ''
  if (truth) {
    heard = C.asrText(addon, rec, y, dry.sr)
    intel = C.textSim(heard, truth)
  }
  const score = targetProfile
    ? 0.55 * (1 / (1 + d)) + 0.45 * intel
    : 0.6 * intel + 0.4 * heaviness(o)
  out.push({ o, d, intel, heard, score, heavy: heaviness(o) })
  if ((i + 1) % 20 === 0) console.log(`  ...已试 ${i + 1} 组`)
}
out.sort((a, b) => b.score - a.score)

C.hr('前 6 名')
for (const r of out.slice(0, 6)) {
  console.log(`  分 ${(r.score * 100).toFixed(1)}  频谱距 ${targetProfile ? r.d.toFixed(3) : '-'}  可懂度 ${(r.intel * 100).toFixed(0)}%  机械度 ${(r.heavy * 100).toFixed(0)}%`)
  console.log(`     ${JSON.stringify(r.o)}`)
  if (r.heard) console.log(`     听到: ${JSON.stringify(r.heard.slice(0, 70))}`)
}

// 导出前 3 名做试听
const dir = C.workDir('fx-lab')
out.slice(0, 3).forEach((r, i) => {
  C.writeWav(path.join(dir, `preset${i + 1}.wav`), C.mechanicalFx(dry.samples, dry.sr, r.o), dry.sr)
})
fs.writeFileSync(path.join(dir, 'params.json'), JSON.stringify(out.slice(0, 3).map((r) => r.o), null, 2))
console.log(`\n前 3 名已导出到 ${dir}`)
console.log('把中意的参数写进 tools/fx-apply.cjs 的 PRESETS 里即可批量应用。\n')
