#!/usr/bin/env node
'use strict'
/**
 * check-env —— 环境自检
 *
 * 用法:  node tools/check-env.cjs
 *
 * 检查项：
 *   1. DSH 安装位置与自带的 sherpa-onnx 原生模块
 *   2. 原生模块版本 / onnxruntime 版本
 *   3. 是否支持 ZipVoice（零样本克隆）
 *   4. ASR 模型 / ZipVoice 模型 / 声码器是否就位
 *   5. dsh-startup-screen 插件是否装在某个 profile 里
 */
const fs = require('node:fs')
const path = require('node:path')
const C = require('../lib/common.cjs')

console.log('\n=== DSH Voice Clone Toolkit · 环境自检 ===\n')

let ok = 0, fail = 0
const mark = (good, label, extra) => {
  console.log(`  ${good ? '✓' : '✗'} ${label}${extra ? '   ' + extra : ''}`)
  good ? ok++ : fail++
}

// 1) DSH 安装位置
const roots = C.candidatesForDshRoot().filter((p) => fs.existsSync(p))
mark(roots.length > 0, 'DSH 安装目录', roots[0] || '（未找到，可设 DSH_INSTALL_DIR）')
for (const r of roots.slice(1)) console.log(`     候选: ${r}`)

// 2) sherpa-onnx
let sherpa = null
try {
  sherpa = C.loadSherpa()
  mark(true, 'sherpa-onnx 原生模块', sherpa.dir)
  console.log(`     文件: ${sherpa.file}`)
} catch (e) {
  mark(false, 'sherpa-onnx 原生模块', e.message.split('\n')[0])
}

const addon = sherpa && sherpa.addon
if (addon) {
  mark(true, '版本信息', `sherpa-onnx ${addon.version} / onnxruntime ${addon.onnxruntimeVersion}`)
  console.log(`     git: ${addon.gitSha1}  ${addon.gitDate}`)

  // 3) ZipVoice 支持：**必须拿真模型实测**
  //    踩坑：给假路径时，`--zipvoice-tokens: ... does not exist` 这类细节是原生库打到
  //    **stderr** 的，JS 侧只能拿到一句 "Please check your config!" —— 没法从异常消息判断。
  const zvProbe = path.join(C.modelsDir(), 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia')
  const vocProbe = path.join(C.modelsDir(), 'vocos_24khz.onnx')
  const zvReady = fs.existsSync(path.join(zvProbe, 'tokens.txt')) &&
    fs.existsSync(path.join(zvProbe, 'encoder.int8.onnx')) &&
    fs.existsSync(path.join(zvProbe, 'decoder.int8.onnx')) &&
    fs.existsSync(path.join(zvProbe, 'espeak-ng-data')) && fs.existsSync(vocProbe)
  if (zvReady) {
    try {
      const t = addon.createOfflineTts({
        model: {
          zipvoice: {
            tokens: path.join(zvProbe, 'tokens.txt'),
            encoder: path.join(zvProbe, 'encoder.int8.onnx'),
            decoder: path.join(zvProbe, 'decoder.int8.onnx'),
            dataDir: path.join(zvProbe, 'espeak-ng-data'),
            lexicon: path.join(zvProbe, 'lexicon.txt'),
            vocoder: vocProbe,
          },
          numThreads: 2, provider: 'cpu', debug: false,
        },
        maxNumSentences: 1,
      })
      mark(true, 'ZipVoice 实际加载成功', `输出采样率 ${addon.getOfflineTtsSampleRate(t)} Hz`)
    } catch (e) {
      mark(false, 'ZipVoice 实际加载', String(e.message || e).split('\n')[0])
    }
  } else {
    console.log('  · ZipVoice 支持：模型未下载，无法实测（下完模型会自动试加载）')
  }
}

// 4) 模型
C.hr('模型')
const asr = C.findAsrModel()
mark(!!asr, 'ASR 模型（用于逐段校验）', asr ? asr.dir : '未找到 → 跑 scripts/download-models.ps1')
const zvDir = path.join(C.modelsDir(), 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia')
const vocoder = path.join(C.modelsDir(), 'vocos_24khz.onnx')
const zvOk = fs.existsSync(path.join(zvDir, 'tokens.txt')) && fs.existsSync(path.join(zvDir, 'encoder.int8.onnx')) &&
  fs.existsSync(path.join(zvDir, 'decoder.int8.onnx')) && fs.existsSync(path.join(zvDir, 'espeak-ng-data'))
mark(zvOk, 'ZipVoice 模型（用于克隆）', zvOk ? zvDir : '未找到 → 跑 scripts/download-models.ps1')
mark(fs.existsSync(vocoder), 'vocos_24khz 声码器', fs.existsSync(vocoder) ? vocoder : '未找到')

// 5) 插件
C.hr('插件')
const profilesRoot = path.join(C.dshHome(), 'profiles')
let found = []
if (fs.existsSync(profilesRoot)) {
  for (const p of fs.readdirSync(profilesRoot)) {
    const a = C.pluginAssetsDir(p)
    if (fs.existsSync(a)) found.push({ profile: p, assets: a })
  }
}
if (found.length) {
  for (const f of found) {
    const n = fs.readdirSync(f.assets).filter((x) => /^line-\d.*\.(mp3|wav)$/i.test(x)).length
    mark(true, `dsh-startup-screen @ profile "${f.profile}"`, `${n} 个语音素材  ${f.assets}`)
  }
} else {
  mark(false, 'dsh-startup-screen 插件', '未在 ~/.dsh/profiles/*/node_modules 找到 → 先装插件')
}

C.hr()
console.log(`  ${ok} 项通过 / ${fail} 项缺失\n`)
if (fail) {
  console.log('  下一步：')
  console.log('    1. 装模型：  powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1')
  console.log('    2. 装插件：  dsh plugin --profile <profile> add github:<owner>/dsh-startup-screen')
  console.log('    3. 再跑一次：node tools/check-env.cjs\n')
} else {
  console.log('  环境就绪，可以开始：见 README 的「快速开始」\n')
}
