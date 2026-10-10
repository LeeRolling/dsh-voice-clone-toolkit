#!/usr/bin/env node
'use strict'
/**
 * fx-apply —— 按"会话配置"批量加音效 + 分幕气口 + 装配
 *
 * 用法:
 *   node tools/fx-apply.cjs <config.json> [--out=DIR]
 *
 * 配置文件格式见 configs/dsh-startup.example.json：
 *   {
 *     "preset": { ...音效参数... },
 *     "sceneHold": { "line-1": 900, ... },     // 可选：插件里每幕的视觉基准(ms)
 *     "builtinTail": 240,                       // 可选：插件自带的收尾留白(ms)
 *     "lines": [
 *       { "id": "line-1", "src": "work/segments/seg-01.wav", "text": "...", "lead": 0.5, "tail": 1.7 }
 *     ]
 *   }
 *
 * 输出会同时给出：每条音频时长、以及按插件公式算出的"该幕实际停留时间"
 *   sceneMs = max(sceneHold, audioMs + builtinTail)
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { pos, opt } = C.parseArgs()
const cfgPath = pos[0]
if (!cfgPath) C.die('用法: node tools/fx-apply.cjs <config.json> [--out=DIR]')
if (!fs.existsSync(cfgPath)) C.die('配置不存在: ' + cfgPath)

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const baseDir = path.dirname(path.resolve(cfgPath))
const outDir = path.isAbsolute(opt.out || cfg.out || '')
  ? (opt.out || cfg.out)
  : path.resolve(C.repoRoot(), opt.out || cfg.out || 'out')
fs.mkdirSync(outDir, { recursive: true })

/**
 * 源路径解析：相对路径依次尝试「配置文件所在目录 → 仓库根 → 当前目录」，
 * 取第一个真实存在的。这样配置文件放在 configs/ 或 work/ 里都不会错。
 */
function resolveSrc(s) {
  if (path.isAbsolute(s)) return s
  for (const b of [baseDir, C.repoRoot(), process.cwd()]) {
    const p = path.resolve(b, s)
    if (fs.existsSync(p)) return p
  }
  return path.resolve(baseDir, s)   // 全都不存在时按配置文件目录报，便于排查
}

const preset = cfg.preset || {}
const hold = cfg.sceneHold || {}
const builtinTail = cfg.builtinTail == null ? 240 : Number(cfg.builtinTail)
const lines = cfg.lines || []
if (!lines.length) C.die('配置里没有 lines')

if (!Object.keys(preset).length) console.log('⚠ preset 为空 —— 只做气口装配，不加任何音效')

console.log(`\n会话: ${cfg.name || path.basename(cfgPath)}`)
console.log(`音效: ${Object.keys(preset).length ? JSON.stringify(preset) : '（无）'}`)
console.log(`输出: ${outDir}\n`)

C.hr('逐条处理')
let totalMs = 0
const rows = []
for (const line of lines) {
  const src = resolveSrc(line.src)
  if (!fs.existsSync(src)) { console.log(`  ✗ ${line.id}: 源文件不存在 ${src}`); continue }
  const { sr, samples } = C.readWav(src)
  let y = Object.keys(preset).length ? C.mechanicalFx(samples, sr, preset) : samples
  const lead = Number(line.lead || 0), tail = Number(line.tail || 0)
  const withPad = C.pad(y, sr, lead, tail)
  const file = path.join(outDir, `${line.id}.wav`)
  C.writeWav(file, withPad, sr)

  const durMs = (withPad.length / sr) * 1000
  const sceneMs = Math.max(hold[line.id] || 0, durMs + builtinTail)
  totalMs += sceneMs
  rows.push({ id: line.id, dur: withPad.length / sr, lead, tail, sceneMs, file })
  console.log(`  ${line.id.padEnd(8)} 前${lead}s + 语音${(samples.length / sr).toFixed(2)}s + 后${tail}s = ${(withPad.length / sr).toFixed(2)}s   该幕停留 ${(sceneMs / 1000).toFixed(2)}s`)
}
console.log(`\n  六幕合计停留 ${(totalMs / 1000).toFixed(1)}s`)

C.hr('产物')
for (const r of rows) console.log(`  ${path.relative(process.cwd(), r.file)}`)

// 装机命令提示
console.log(`\n下一步：node tools/install-into-plugin.cjs --src=${path.relative(process.cwd(), outDir)} --profile=<profile>\n`)
