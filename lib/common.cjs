'use strict'
/**
 * lib/common.cjs —— 公共工具层
 *
 * 关键点：本工具包不携带任何二进制。它复用 **DeepSeek Harness 自带**的
 * sherpa-onnx 原生模块（位于 app.asar.unpacked 内），因此零依赖、零下载。
 *
 * 所有路径都可覆盖：
 *   DSH_INSTALL_DIR   DSH 安装根目录（含 resources/ 那一层）
 *   DSH_SHERPA_DIR    直接指定 sherpa-onnx 模块目录
 *   DSH_HOME          DSH 家目录（默认 ~/.dsh）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ───────────────────────────── 路径定位 ─────────────────────────────

function candidatesForDshRoot() {
  const out = []
  const env = process.env.DSH_INSTALL_DIR
  if (env) out.push(env)
  const home = os.homedir()
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'))
    if (process.env.PROGRAMFILES) out.push(path.join(process.env.PROGRAMFILES, 'DeepSeek Harness'))
    if (process.env['PROGRAMFILES(X86)']) out.push(path.join(process.env['PROGRAMFILES(X86)'], 'DeepSeek Harness'))
  } else if (process.platform === 'darwin') {
    out.push('/Applications/DeepSeek Harness.app/Contents/Resources')
    out.push(path.join(home, 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources'))
  } else {
    out.push('/opt/DeepSeek Harness/resources')
    out.push('/usr/lib/deepseek-harness/resources')
    out.push(path.join(home, '.local', 'share', 'deepseek-harness', 'resources'))
  }
  return out.filter(Boolean)
}

/** 在某个根目录下找 unpacked 的 node_modules */
function unpackedNodeModules(root) {
  const probes = [root, path.join(root, 'resources'), path.join(root, 'Contents', 'Resources')]
  for (const p of probes) {
    const nm = path.join(p, 'app.asar.unpacked', 'dsh', 'node_modules')
    if (fs.existsSync(nm)) return nm
  }
  return null
}

/** 找到 sherpa-onnx 原生模块目录（含 .node 与配套 dll/so/dylib） */
function findSherpaDir() {
  if (process.env.DSH_SHERPA_DIR && fs.existsSync(process.env.DSH_SHERPA_DIR)) return process.env.DSH_SHERPA_DIR
  const roots = []
  for (const c of candidatesForDshRoot()) {
    const nm = unpackedNodeModules(c)
    if (nm) roots.push(nm)
  }
  // 也允许用户直接给 unpacked node_modules
  if (process.env.DSH_UNPACKED_NODE_MODULES) roots.push(process.env.DSH_UNPACKED_NODE_MODULES)

  for (const nm of roots) {
    let entries = []
    try { entries = fs.readdirSync(nm) } catch { continue }
    for (const d of entries) {
      if (!/^sherpa-onnx/.test(d)) continue
      const dir = path.join(nm, d)
      if (!fs.statSync(dir).isDirectory()) continue
      const hasAddon = fs.readdirSync(dir).some((f) => f.endsWith('.node'))
      if (hasAddon) return dir
    }
  }
  return null
}

/** 加载 sherpa-onnx 原生模块（普通 Node 即可，N-API 插件） */
function loadSherpa() {
  const dir = findSherpaDir()
  if (!dir) {
    throw new Error(
      '找不到 DSH 自带的 sherpa-onnx 原生模块。\n' +
      '  · 请确认已安装 DeepSeek Harness\n' +
      '  · 或设置环境变量 DSH_INSTALL_DIR 指向安装目录\n' +
      '  · 或设置 DSH_SHERPA_DIR 直接指向 sherpa-onnx-* 模块目录'
    )
  }
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.node'))
  return { addon: require(path.join(dir, file)), dir, file }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
function profileDir(profile) {
  return path.join(dshHome(), 'profiles', profile)
}
/** dsh-startup-screen 的素材目录 */
function pluginAssetsDir(profile, plugin) {
  return path.join(profileDir(profile), 'node_modules', plugin || 'dsh-startup-screen', 'lib', 'assets')
}
function pluginLibDir(profile, plugin) {
  return path.join(profileDir(profile), 'node_modules', plugin || 'dsh-startup-screen', 'lib')
}
function repoRoot() {
  return path.resolve(__dirname, '..')
}
function modelsDir(sub) {
  return path.join(repoRoot(), 'models', sub || '')
}
function workDir(sub) {
  const d = path.join(repoRoot(), 'work', sub || '')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// ───────────────────────────── WAV 读写 ─────────────────────────────

/**
 * 读 WAV → { sr, samples: Float32Array(mono) }
 * 支持 PCM 8/16/24/32bit 与 IEEE float32；多声道自动下混为单声道。
 */
function readWav(p) {
  const b = fs.readFileSync(p)
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error(`不是 RIFF/WAVE：${p}（sherpa-onnx 的 readWave 也只吃 WAV；mp3/m4a 请先转成 WAV）`)
  }
  let off = 12, fmt = null, dataOff = -1, dataLen = 0
  while (off + 8 <= b.length) {
    const id = b.toString('latin1', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = {
        tag: b.readUInt16LE(off + 8),
        ch: b.readUInt16LE(off + 10),
        rate: b.readUInt32LE(off + 12),
        bits: b.readUInt16LE(off + 22),
      }
      if (fmt.tag === 0xfffe && size >= 40) fmt.tag = b.readUInt16LE(off + 8 + 24) // WAVE_FORMAT_EXTENSIBLE → 子格式
    }
    if (id === 'data') { dataOff = off + 8; dataLen = size; break }
    off += 8 + size + (size % 2)
  }
  if (!fmt || dataOff < 0) throw new Error('WAV 缺少 fmt/data 块：' + p)
  const bp = Math.ceil(fmt.bits / 8)
  const frames = Math.floor(dataLen / (bp * fmt.ch))
  const s = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let acc = 0
    for (let c = 0; c < fmt.ch; c++) {
      const o = dataOff + (i * fmt.ch + c) * bp
      let v = 0
      if (fmt.tag === 3) v = b.readFloatLE(o)
      else if (fmt.bits === 8) v = (b.readUInt8(o) - 128) / 128
      else if (fmt.bits === 16) v = b.readInt16LE(o) / 32768
      else if (fmt.bits === 24) { const x = b.readUIntLE(o, 3); v = ((x << 8) >> 8) / 8388608 }
      else if (fmt.bits === 32) v = (fmt.tag === 3 ? b.readFloatLE(o) : b.readInt32LE(o) / 2147483648)
      acc += v
    }
    s[i] = acc / fmt.ch
  }
  return { sr: fmt.rate, samples: s, bits: fmt.bits, ch: fmt.ch }
}

/** 写 16bit 单声道 WAV */
function writeWav(p, samples, sr) {
  const n = samples.length
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'latin1')
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  fs.writeFileSync(p, b)
}

// ───────────────────────── 静音分段 / 基础度量 ─────────────────────────

/**
 * 按静音间隔切分。返回 [{ a, b, dur }]（秒）
 * minGapMs: 判定为"句子边界"的最短静音；句内换气通常 0.3~0.6s，句间停顿通常 >1s
 */
function segment(samples, sr, { minGapMs = 600, minLenMs = 250, thRatio = 0.02 } = {}) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const th = Math.max(0.004, peak * thRatio)
  const win = Math.round(0.01 * sr)
  const loud = []
  for (let a = 0; a + win <= samples.length; a += win) {
    let m = 0
    for (let i = a; i < a + win; i++) m = Math.max(m, Math.abs(samples[i]))
    loud.push(m > th)
  }
  const frames = Math.round(minGapMs / 10)
  const out = []
  let start = -1, lastLoud = -1
  for (let i = 0; i < loud.length; i++) {
    if (loud[i]) { if (start < 0) start = i; lastLoud = i }
    else if (start >= 0 && i - lastLoud > frames) { out.push({ a: start * 0.01, b: (lastLoud + 1) * 0.01 }); start = -1 }
  }
  if (start >= 0) out.push({ a: start * 0.01, b: (lastLoud + 1) * 0.01 })
  return out.filter((s) => (s.b - s.a) * 1000 >= minLenMs).map((s) => ({ ...s, dur: s.b - s.a }))
}

/** 句内停顿（用于检查 TTS 是否偷偷插了长停顿） */
function innerPauses(samples, sr, { minGapMs = 150, thRatio = 0.02 } = {}) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const th = Math.max(0.004, peak * thRatio)
  const win = Math.round(0.01 * sr)
  const loud = []
  for (let a = 0; a + win <= samples.length; a += win) {
    let m = 0
    for (let i = a; i < a + win; i++) m = Math.max(m, Math.abs(samples[i]))
    loud.push(m > th)
  }
  const frames = Math.round(minGapMs / 10)
  const out = []
  let lastLoud = -1
  for (let i = 0; i < loud.length; i++) {
    if (!loud[i]) continue
    if (lastLoud >= 0 && i - lastLoud >= frames) out.push({ at: lastLoud * 0.01, len: (i - lastLoud) * 0.01 })
    lastLoud = i
  }
  return out
}

/** 首尾静音长度（秒） */
function silenceEdges(samples, sr, th = 0.006) {
  let a = 0
  while (a < samples.length && Math.abs(samples[a]) < th) a++
  let b = samples.length - 1
  while (b > a && Math.abs(samples[b]) < th) b--
  return { lead: a / sr, tail: (samples.length - 1 - b) / sr, onset: a / sr, end: b / sr }
}

function peakOf(samples) {
  let p = 0
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]))
  return p
}

/** 归一化到指定峰值（原地返回新数组） */
function normalize(samples, target = 0.7) {
  const p = peakOf(samples)
  const out = Float32Array.from(samples)
  if (p > 0) { const g = target / p; for (let i = 0; i < out.length; i++) out[i] *= g }
  return out
}

// ───────────────────────────── FFT / 频谱 ─────────────────────────────

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
      }
    }
  }
}

const BANDS = [[0, 300], [300, 1000], [1000, 3000], [3000, 6000], [6000, 12000]]

/** 频谱画像：各频带占比 + 谱重心 */
function profile(samples, sr, { N = 2048 } = {}) {
  const acc = new Float64Array(N / 2)
  let win = 0
  for (let st = 0; st + N <= samples.length; st += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = samples[st + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))
    fft(re, im)
    for (let k = 0; k < N / 2; k++) acc[k] += Math.hypot(re[k], im[k])
    win++
  }
  if (!win) return null
  const bin = sr / N
  const v = BANDS.map(([lo, hi]) => {
    let s = 0, n = 0
    for (let k = Math.ceil(lo / bin); k < Math.min(N / 2, hi / bin); k++) { s += acc[k]; n++ }
    return n ? s / n : 0
  })
  const tot = v.reduce((a, b) => a + b, 0) || 1
  let num = 0, den = 0
  for (let k = 1; k < N / 2; k++) { num += acc[k] * k * bin; den += acc[k] }
  return { bands: v.map((x) => x / tot), centroid: den ? num / den : 0 }
}

/** 两个频谱画像的距离（越小越像） */
function specDistance(a, b) {
  if (!a || !b) return Infinity
  let d = 0
  for (let i = 0; i < a.bands.length; i++) d += Math.abs(a.bands[i] - b.bands[i])
  d += Math.abs(Math.log((a.centroid + 1) / (b.centroid + 1))) * 0.6
  return d
}

// ───────────────────────────── ASR ─────────────────────────────

/** 在 models/asr 下找一个 whisper 模型目录 */
function findAsrModel() {
  const dir = modelsDir('asr')
  if (!fs.existsSync(dir)) return null
  for (const d of fs.readdirSync(dir)) {
    const p = path.join(dir, d)
    if (!fs.statSync(p).isDirectory()) continue
    const files = fs.readdirSync(p)
    const has = (re) => files.some((f) => re.test(f))
    if (has(/encoder.*\.onnx$/i) && has(/decoder.*\.onnx$/i) && has(/tokens\.txt$/i)) {
      const pick = (prefer, fallback) => {
        // 注意：Array.prototype.find 需要**谓词函数**，不能直接传正则
        const f = files.find((x) => prefer.test(x)) || files.find((x) => fallback.test(x))
        return f ? path.join(p, f) : null
      }
      return {
        dir: p,
        encoder: pick(/encoder\.int8\.onnx$/i, /encoder.*\.onnx$/i),
        decoder: pick(/decoder\.int8\.onnx$/i, /decoder.*\.onnx$/i),
        tokens: pick(/tokens\.txt$/i, /tokens\.txt$/i),
      }
    }
  }
  return null
}

function makeRecognizer(addon, model, { numThreads = 4 } = {}) {
  return addon.createOfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: model.encoder, decoder: model.decoder, language: 'en', task: 'transcribe' },
      tokens: model.tokens,
      numThreads,
      provider: 'cpu',
      debug: false,
    },
    decodingMethod: 'greedy_search',
  })
}

/** 转写（samples 可以是任意采样率，内部会重采样） */
function asrText(addon, rec, samples, sr) {
  const st = addon.createOfflineStream(rec)
  addon.acceptWaveformOffline(st, { samples, sampleRate: sr })
  addon.decodeOfflineStream(rec, st)
  return (JSON.parse(addon.getOfflineStreamResultAsJson(st)).text || '').trim()
}

// ───────────────────────────── 文本相似度 ─────────────────────────────

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** 字符级相似度 0..1（对短句稳定） */
function charSim(a, b) {
  const A = norm(a), B = norm(b)
  return 1 - levenshtein(A, B) / (Math.max(A.length, B.length) || 1)
}

/** 词级重合度 0..1 */
function wordSim(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean))
  const B = new Set(norm(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / Math.max(A.size, B.size)
}

/** 综合相似度（词 50% + 字 50%） */
function textSim(a, b) {
  return 0.5 * wordSim(a, b) + 0.5 * charSim(a, b)
}

// ───────────────────────────── 机械音效链 ─────────────────────────────

/**
 * 参数化机械音效链（纯数学，无依赖）
 *   hp    高通截止(Hz)         ring  { f: 载波Hz, mix: 0~1 混合量 }
 *   comb  { ms: 延迟ms, g: 反馈 }  lp  低通截止(Hz)
 *   drive 软饱和量             hold  采样率保持倍数(1=off)
 *   bits  位深                 hum   120Hz 交流声幅度
 *   noise 白噪声幅度
 */
function mechanicalFx(x, sr, o = {}) {
  const y = Float32Array.from(x)
  const N = y.length
  if (o.hp) {
    const a = Math.exp(-2 * Math.PI * o.hp / sr)
    let pi = 0, po = 0
    for (let i = 0; i < N; i++) { const v = y[i]; po = a * (po + v - pi); pi = v; y[i] = po }
  }
  if (o.ring) {
    const { f, mix } = o.ring
    for (let i = 0; i < N; i++) y[i] *= (1 - mix) + mix * Math.sin(2 * Math.PI * f * i / sr)
  }
  if (o.comb) {
    const d = Math.max(1, Math.round(o.comb.ms * sr / 1000))
    const buf = new Float32Array(d)
    for (let i = 0; i < N; i++) {
      const dl = buf[i % d]
      const out = y[i] + o.comb.g * dl
      buf[i % d] = out
      y[i] = out
    }
  }
  if (o.lp) {
    const k = 1 - Math.exp(-2 * Math.PI * o.lp / sr)
    let p = 0
    for (let i = 0; i < N; i++) { p += k * (y[i] - p); y[i] = p }
  }
  if (o.drive) {
    const nrm = Math.tanh(o.drive)
    for (let i = 0; i < N; i++) y[i] = Math.tanh(y[i] * o.drive) / nrm
  }
  if (o.hold > 1) {
    let last = 0
    for (let i = 0; i < N; i++) { if (i % o.hold === 0) last = y[i]; y[i] = last }
  }
  if (o.bits) {
    const lv = Math.pow(2, o.bits - 1)
    for (let i = 0; i < N; i++) y[i] = Math.round(y[i] * lv) / lv
  }
  if (o.hum) for (let i = 0; i < N; i++) y[i] += o.hum * Math.sin(2 * Math.PI * 120 * i / sr)
  if (o.noise) for (let i = 0; i < N; i++) y[i] += o.noise * (Math.random() * 2 - 1)
  return o.normalize === false ? y : normalize(y, o.targetPeak || 0.7)
}

/** 把句内超长停顿压到 target 秒（常用来修 TTS 偷加的停顿） */
function compressPauses(samples, sr, { minGap = 0.6, target = 0.2 } = {}) {
  const gaps = innerPauses(samples, sr, { minGapMs: minGap * 1000 })
  if (!gaps.length) return { out: samples, report: [] }
  const parts = []
  let cursor = 0
  const report = []
  for (const g of gaps) {
    parts.push(samples.subarray(cursor, Math.round(g.at * sr)))
    parts.push(new Float32Array(Math.round(target * sr)))
    cursor = Math.round((g.at + g.len) * sr)
    report.push({ at: g.at, was: g.len })
  }
  parts.push(samples.subarray(cursor))
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0))
  let p = 0
  for (const q of parts) { out.set(q, p); p += q.length }
  return { out, report }
}

/** 前后补静音（分幕气口） */
function pad(samples, sr, leadSec, tailSec) {
  const lead = Math.round(leadSec * sr), tail = Math.round(tailSec * sr)
  const out = new Float32Array(lead + samples.length + tail)
  out.set(samples, lead)
  return out
}

// ───────────────────────────── CLI 小工具 ─────────────────────────────

/** 极简参数解析：--key=value 与位置参数 */
function parseArgs(argv = process.argv.slice(2)) {
  const pos = []
  const opt = {}
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (m) opt[m[1]] = m[2] === undefined ? true : m[2]
    else pos.push(a)
  }
  return { pos, opt }
}

function die(msg) {
  console.error('\n✗ ' + msg + '\n')
  process.exit(1)
}

function hr(title) {
  console.log('\n' + (title ? `── ${title} ` : '') + '─'.repeat(Math.max(0, 60 - (title ? title.length + 4 : 0))))
}

module.exports = {
  // 路径
  findSherpaDir, loadSherpa, dshHome, profileDir, pluginAssetsDir, pluginLibDir,
  repoRoot, modelsDir, workDir, candidatesForDshRoot, unpackedNodeModules,
  // WAV
  readWav, writeWav,
  // 度量
  segment, innerPauses, silenceEdges, peakOf, normalize,
  fft, profile, specDistance, BANDS,
  // ASR
  findAsrModel, makeRecognizer, asrText,
  // 文本
  norm, levenshtein, charSim, wordSim, textSim,
  // 音效
  mechanicalFx, compressPauses, pad,
  // CLI
  parseArgs, die, hr,
}
