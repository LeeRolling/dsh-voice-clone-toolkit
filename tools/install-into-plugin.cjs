#!/usr/bin/env node
'use strict'
/**
 * install-into-plugin —— 把成品音频装进 dsh-startup-screen 插件（自动备份）
 *
 * 用法:
 *   node tools/install-into-plugin.cjs --src=out --profile=desktop [--plugin=dsh-startup-screen]
 *                                     [--names=line-1,line-2,...] [--dry]
 *
 * 说明：
 *   · 源目录里的 line-1.wav … 会被复制为插件的 line-1.mp3
 *     （文件名必须是 line-N；扩展名写 .mp3 是刻意的 —— 插件的素材路由只服务 *.mp3，
 *       而浏览器解码是按**内容**嗅探的，所以 WAV 内容放进 .mp3 完全没问题）
 *   · 每个被覆盖的原文件备份为 <名字>.pre-install.bak（只备份一次）
 *   · --dry 只做检查不写盘
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { opt } = C.parseArgs()
const srcDir = path.resolve(opt.src || path.join(C.repoRoot(), 'out'))
const profile = opt.profile
const plugin = opt.plugin || 'dsh-startup-screen'
if (!profile) C.die('必须指定 --profile（如 --profile=desktop）。可用 profile 见 ~/.dsh/profiles/')
if (!fs.existsSync(srcDir)) C.die('源目录不存在: ' + srcDir)

const assets = C.pluginAssetsDir(profile, plugin)
if (!fs.existsSync(assets)) {
  const root = path.join(C.profileDir(profile), 'node_modules')
  const hint = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /startup|screen/i.test(d)) : []
  C.die(`插件素材目录不存在: ${assets}\n  profile "${profile}" 里是否装了 ${plugin}？${hint.length ? '\n  看起来像的有: ' + hint.join(', ') : ''}`)
}

const only = opt.names ? String(opt.names).split(',').map((s) => s.trim()) : null
const files = fs.readdirSync(srcDir).filter((f) => /^(line-\d+)\.(wav|mp3)$/i.test(f))
  .filter((f) => !only || only.includes(path.basename(f).replace(/\.(wav|mp3)$/i, '')))
  .sort()

if (!files.length) C.die(`在 ${srcDir} 里没找到 line-N.wav / line-N.mp3`)

console.log(`\n源:   ${srcDir}`)
console.log(`目标: ${assets}`)
console.log(`模式: ${opt.dry ? 'DRY RUN（不写盘）' : '实际写入'}\n`)

C.hr('待安装')
const jobs = []
for (const f of files) {
  const id = path.basename(f).replace(/\.(wav|mp3)$/i, '')
  const info = C.readWav(path.join(srcDir, f))
  const dur = info.samples.length / info.sr
  const edges = C.silenceEdges(info.samples, info.sr)
  jobs.push({ id, src: path.join(srcDir, f), dest: path.join(assets, id + '.mp3'), dur, edges })
  console.log(`  ${id.padEnd(8)} ← ${f.padEnd(14)} ${dur.toFixed(2)}s  ${info.sr}Hz  前留白 ${edges.lead.toFixed(2)}s / 后留白 ${edges.tail.toFixed(2)}s`)
}

if (opt.dry) { console.log('\nDRY RUN 结束，未写盘。\n'); process.exit(0) }

C.hr('写入')
for (const j of jobs) {
  const bak = j.dest + '.pre-install.bak'
  if (fs.existsSync(j.dest) && !fs.existsSync(bak)) fs.copyFileSync(j.dest, bak)
  fs.copyFileSync(j.src, j.dest)
  console.log(`  ok  ${path.basename(j.dest)}${fs.existsSync(bak) ? '   （原件已备份 ' + path.basename(bak) + '）' : ''}`)
}

console.log(`
装好了。现在：
  1. 页面按 Ctrl+Shift+R 硬刷新
     —— 插件的素材响应带 Cache-Control: max-age=86400，普通刷新会一直用旧副本
  2. 控制台执行 window.__DSH_STARTUP_API__.replay() 重播

回退：把 lib/assets 里的 *.pre-install.bak 改回原名即可。
`)
