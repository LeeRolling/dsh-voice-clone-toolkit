#!/usr/bin/env node
'use strict'
/**
 * generate-clone —— 用 ZipVoice 做零样本音色克隆，让它说任意新台词
 *
 * 用法:
 *   node tools/generate-clone.cjs --ref=<参考音.wav> --ref-text="参考音说的原文" \
 *        --lines=<台词文件.txt> [--out=DIR] [--speed=1.0] [--steps=4]
 *
 * 台词文件：一行一句。
 *
 * 关键点（踩过的坑，全在这一行里）：
 *   referenceAudio / referenceSampleRate / referenceText **必须嵌在 generationConfig 里**。
 *   放顶层会被静默忽略，只报一个看似无关的错："reference_sample_rate 0 is invalid"。
 *
 * 参考音要求：
 *   · 3~10 秒、单人、干净、无背景音乐
 *   · **必须知道它说的原文**（ZipVoice 靠这段文字把音色对齐到音素）
 *   · 参考音越长越稳，但超过 ~15 秒收益递减
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

const { opt } = C.parseArgs()
const ref = opt.ref
const refText = opt['ref-text']
const linesFile = opt.lines
if (!ref || !refText || !linesFile) {
  C.die('用法: node tools/generate-clone.cjs --ref=<参考音.wav> --ref-text="原文" --lines=<台词.txt> [--out=DIR]')
}
for (const [k, v] of [['参考音', ref], ['台词文件', linesFile]]) if (!fs.existsSync(v)) C.die(`${k}不存在: ${v}`)

const M = path.join(C.modelsDir(), 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia')
const vocoder = path.join(C.modelsDir(), 'vocos_24khz.onnx')
for (const f of ['tokens.txt', 'encoder.int8.onnx', 'decoder.int8.onnx', 'espeak-ng-data', 'lexicon.txt']) {
  if (!fs.existsSync(path.join(M, f))) C.die(`ZipVoice 模型不完整（缺 ${f}）。先跑 scripts/download-models.ps1`)
}
if (!fs.existsSync(vocoder)) C.die('缺声码器 vocos_24khz.onnx。先跑 scripts/download-models.ps1')

const outDir = path.resolve(opt.out || path.join(C.repoRoot(), 'out', 'cloned'))
fs.mkdirSync(outDir, { recursive: true })

const { addon } = C.loadSherpa()
const tts = addon.createOfflineTts({
  model: {
    zipvoice: {
      tokens: path.join(M, 'tokens.txt'),
      encoder: path.join(M, 'encoder.int8.onnx'),
      decoder: path.join(M, 'decoder.int8.onnx'),
      dataDir: path.join(M, 'espeak-ng-data'),
      lexicon: path.join(M, 'lexicon.txt'),
      vocoder,
    },
    numThreads: Number(opt.threads || 6),
    provider: 'cpu',
    debug: false,
  },
  maxNumSentences: 1,
})
console.log(`\nZipVoice 已加载 · 输出采样率 ${addon.getOfflineTtsSampleRate(tts)}`)

const rw = addon.readWave(ref)
console.log(`参考音: ${path.basename(ref)}  ${(rw.samples.length / rw.sampleRate).toFixed(2)}s @${rw.sampleRate}Hz`)
console.log(`参考文字: ${JSON.stringify(refText.slice(0, 80))}`)

const lines = fs.readFileSync(linesFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
console.log(`待生成 ${lines.length} 句\n`)

const speed = Number(opt.speed || 1.0)
const numSteps = Number(opt.steps || 4)

C.hr('生成')
const rows = []
lines.forEach((text, i) => {
  const t0 = Date.now()
  try {
    const audio = addon.offlineTtsGenerateWithConfig(tts, {
      text,
      generationConfig: {
        referenceAudio: rw.samples,
        referenceSampleRate: rw.sampleRate,
        referenceText: refText,
        numSteps,
        speed,
        // 短句很重要：不设这个，ZipVoice 会按"最少 30 字符"去断句，短台词容易出问题
        extra: { minCharInSentence: '5' },
      },
    })
    const secs = (Date.now() - t0) / 1000
    const y = C.normalize(audio.samples, 0.7)
    const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}.wav`)
    C.writeWav(file, y, audio.sampleRate)
    const dur = y.length / audio.sampleRate
    console.log(`  ${String(i + 1).padStart(2)}  ${JSON.stringify(text.slice(0, 42)).padEnd(46)} ${dur.toFixed(2)}s  (生成 ${secs.toFixed(1)}s)`)
    rows.push({ i: i + 1, text, file, dur })
  } catch (e) {
    console.log(`  ${String(i + 1).padStart(2)}  ✗ ${String(e.message || e).split('\n')[0].slice(0, 90)}`)
  }
})

fs.writeFileSync(path.join(outDir, 'lines.json'), JSON.stringify(rows, null, 2))
console.log(`\n已生成 ${rows.length} 句 → ${outDir}`)
console.log('下一步：用 fx-apply 加音效与气口，再 install-into-plugin 装机。\n')
