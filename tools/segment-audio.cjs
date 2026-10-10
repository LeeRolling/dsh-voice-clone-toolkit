#!/usr/bin/env node
'use strict'
/**
 * segment-audio —— 把一整段干音按静音间隔切成单句
 *
 * 用法:
 *   node tools/segment-audio.cjs <input.wav> [选项]
 *
 * 选项:
 *   --out=DIR        输出目录（默认 work/segments）
 *   --use=MS         用这个静音间隔导出；不填则只做对比表
 *   --min=MS         最短片段（默认 250）
 *
 * 为什么需要它：
 *   一整段连续录音里，"句内换气"（0.3~0.6s）和"句间停顿"（通常 >1s）
 *   差别可能很小。这个工具会把多个阈值跑一遍，把段数列出来 ——
 *   如果已知台词条数，直接挑对得上的那个阈值。
 *   切完务必用 asr-align.cjs 复核，别靠段数猜（段数吻合也可能是巧合）。
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { pos, opt } = C.parseArgs()
const input = pos[0]
if (!input) C.die('用法: node tools/segment-audio.cjs <input.wav> [--out=DIR] [--use=MS] [--min=MS]')
if (!fs.existsSync(input)) C.die('文件不存在: ' + input)

const outDir = path.resolve(opt.out || path.join(C.repoRoot(), 'work', 'segments'))
const minLen = Number(opt.min || 250)

const { sr, samples, bits, ch } = C.readWav(input)
const dur = samples.length / sr
console.log(`\n输入: ${path.basename(input)}`)
console.log(`  ${sr} Hz / ${bits} bit / ${ch}ch   时长 ${dur.toFixed(2)}s   峰值 ${C.peakOf(samples).toFixed(3)}`)

// ── 阈值对比表 ──
C.hr('静音间隔阈值对比')
const gaps = [200, 300, 400, 500, 600, 800, 1000, 1150, 1300]
for (const g of gaps) {
  const segs = C.segment(samples, sr, { minGapMs: g, minLenMs: minLen })
  console.log(`  ${String(g).padStart(5)} ms  →  ${String(segs.length).padStart(3)} 段`)
}

const useGap = Number(opt.use || 0)
if (!useGap) {
  console.log('\n  只做了对比，没有导出。加 --use=<ms> 指定阈值再跑一次即可导出。')
  console.log('  建议：挑"段数 == 已知台词条数"的那个阈值，然后务必用 asr-align 复核。\n')
  process.exit(0)
}

// ── 导出 ──
C.hr(`用 ${useGap}ms 导出`)
fs.mkdirSync(outDir, { recursive: true })
const segs = C.segment(samples, sr, { minGapMs: useGap, minLenMs: minLen })
segs.forEach((s, i) => {
  const a = Math.round(s.a * sr), b = Math.round(s.b * sr)
  const clip = samples.subarray(a, b)
  const file = path.join(outDir, `seg-${String(i + 1).padStart(2, '0')}.wav`)
  C.writeWav(file, clip, sr)
  const inner = C.innerPauses(clip, sr, { minGapMs: 150 })
  const innerStr = inner.length ? inner.map((g) => `${g.at.toFixed(2)}s处${g.len.toFixed(2)}s`).join(' ') : '—'
  console.log(`  seg-${String(i + 1).padStart(2, '0')}  ${s.a.toFixed(2)}→${s.b.toFixed(2)}s  ${s.dur.toFixed(2)}s  峰值 ${C.peakOf(clip).toFixed(2)}  句内停顿: ${innerStr}`)
})
console.log(`\n  已导出 ${segs.length} 个片段 → ${outDir}`)
console.log('  下一步：node tools/asr-align.cjs <该目录> <台词文本文件>\n')
