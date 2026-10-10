# 踩坑表

**中文** | [English](PITFALLS.en.md)

> 这一页是整个工具包最值钱的部分。下面每一条都是**真实撞过**的坑，
> 包含原始报错、根因、以及最后怎么解决的。
>
> 这些东西不写下来，下一个人还要重新花几天。

---

## 速查表（症状 → 病因）

| # | 症状 / 报错 | 真正的原因 | 解法 |
|---|---|---|---|
| 1 | `reference_sample_rate 0 is invalid` | `referenceAudio` 等参数放在了**顶层**，没嵌进 `generationConfig` | 嵌进去；放错是**静默忽略** |
| 2 | `Expect only 2 arguments. Given: 3` | 这个原生插件全部用**对象式参数** | `decodeOfflineStream(rec, stream)`、`acceptWaveformOffline(stream, {samples,sampleRate})` |
| 3 | 换完音频没变化 | 素材响应带 `max-age=86400` | **Ctrl+Shift+R 硬刷新** |
| 4 | 改了 CSS/JS 没生效 | 静态文件按 mtime 缓存 | 普通刷新即可（不用重启） |
| 5 | 音量滑杆拖到 0.8 / 0.9 / 1.0 没区别 | 增益公式 `min(1, 0.85×v×1.6)`，>0.735 全夹到 1.0 | 只在 0 ~ 0.735 区间调 |
| 6 | 淡出像是"瞬间静音" | `AudioParam.value` **不返回插值结果**，返回最后一次设定值 | 用 `cancelAndHoldAtTime`，或自己按曲线算 |
| 7 | 淡入听起来"突然出现" | 用了 `exponentialRamp`，前 90% 时间在听阈以下 | **淡入用线性**；指数只适合淡出 |
| 8 | 段数吻合但克隆音色跑偏 | 某段其实是**两句并成一段**，参考文本整体错位一格 | 必须 ASR 逐段复核，别靠段数猜 |
| 9 | 句间"干等语音" | 前留白太长 | **把前留白挪到后面**（总长不变），别直接砍 |
| 10 | 安静时底噪"突然没了"很出戏 | 底噪写在各个音频文件里，幕间是数字静音 | 做**全局底噪床**贯穿整段 |
| 11 | 手工加了 patch 行后启动失败 | 插件被注册两次，同一路径重复注册 | 删掉手工行，用 `dsh plugin add` |
| 12 | `dsh --profile desktop --dump-config` 被拒 | desktop profile **由 Electron 进程独占管理** | CLI 只能 `plugin add/remove`，不能 boot |
| 13 | 用 `rg` / `readdir` 读 `app.asar` 报路径不存在 | asar 是压缩包，不是目录 | 用 `ELECTRON_RUN_AS_NODE=1` 跑 app 的 exe |
| 14 | `.ps1` 里中文变乱码、语法报错 | PowerShell 5.1 按 ANSI 读无 BOM 的 .ps1 | 脚本保持纯 ASCII，或加 UTF-8 BOM |
| 15 | `codeload.github.com` 超时、git 连不上 | 直连 GitHub 被墙 | gh-proxy 代理 release 资产；模型走 hf-mirror / ModelScope |
| 16 | 内嵌预览里音频停在 `0:00 / 0:00` | DSH 的应用内预览是沙箱，本地相对路径与 `data:` 都会被拦 | 给文件路径，让对方用系统浏览器打开 |

---

## 详细条目

### A. 找到并使用 DSH 自带的 sherpa-onnx

**A1 — DSH 里藏着一套完整的本地语音工具链。**

```
<install>/resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-<平台>/
    sherpa-onnx.node        ← N-API 插件，普通 Node 直接 require
    sherpa-onnx-c-api.dll
    onnxruntime.dll
```

实测版本 **sherpa-onnx 1.13.8 / onnxruntime 1.28.2**，导出 **104 个能力**：
离线/在线 ASR、TTS、**ZipVoice 零样本克隆**、说话人识别与相似度、语音降噪、VAD、
标点、关键词唤醒、语种识别、说话人分离。

因为它是 **N-API**（ABI 稳定），用系统 Node 就能加载，不需要 Electron 运行时。

**A2 — 但 `app.asar` 本身不是目录。**

`rg` / `fs.readdirSync('.../app.asar/dsh')` 都会报 `系统找不到指定的路径`。
想在 asar 里翻文件，用 Electron 的 node 模式（Electron 的 fs 打了 asar 补丁）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& "C:\...\DeepSeek Harness.exe" your-script.js "C:\...\app.asar\dsh\node_modules\..."
```

（这个方式不太稳，同一命令时好时坏。要稳定访问，`npx @electron/asar extract` 更靠谱。）

**A3 — CLI 不能 boot desktop profile。**

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

`dsh plugin --profile desktop add/remove` 是允许的，**boot 是不允许的**。
这也解释了为什么有些市场插件明确写着「官方桌面端不要走命令行改 profile」。

---

### B. 原生插件的 API 形态

**B1 — 全部是对象式参数，且报错会告诉你差几个。**

```js
// ✗ 位置参数
addon.acceptWaveformOffline(stream, sampleRate, samples)   // Expect only 2 arguments. Given: 3
addon.decodeOfflineStream(stream)                          // Expect only 2 arguments. Given: 1
addon.writeWave(file, samples, sampleRate)                 // Expect only 2 arguments. Given: 3

// ✓ 对象式
addon.acceptWaveformOffline(stream, { samples, sampleRate })
addon.decodeOfflineStream(recognizer, stream)
addon.writeWave(file, { samples, sampleRate })
addon.offlineTtsGenerateWithConfig(tts, { text, generationConfig })
```

**最快的学习途径**：装官方 JS 包装包，读它的映射层 —— 它就是把对象原样透传给原生插件的。

```bash
npm i sherpa-onnx-node
# node_modules/sherpa-onnx-node/non-streaming-tts.js / non-streaming-asr.js / types.js
```

**B2 — ZipVoice 的参考音参数必须嵌在 `generationConfig` 里。**（最耗时的一个坑）

```js
// ✗ 顶层 —— 被静默忽略，只报一个看似无关的错
addon.offlineTtsGenerateWithConfig(tts, {
  text, referenceAudio, referenceSampleRate, referenceText,   // 全都没用
})
// → TTS generation failed
//   offline-tts-zipvoice-impl.h:Generate:79 reference_sample_rate 0 is invalid.

// ✓ 正确
addon.offlineTtsGenerateWithConfig(tts, {
  text,
  generationConfig: {
    referenceAudio: Float32Array,     // 参考音样本
    referenceSampleRate: 24000,       // 参考音采样率
    referenceText: '参考音说的原文',    // ← 必填！靠它把音色对齐到音素
    numSteps: 4,
    extra: { minCharInSentence: '5' }, // 短台词必须调小，默认按 30 字符断句
  },
})
```

**B3 — 别想"探针式"判断某个模型类型是否被支持。**

看起来可行的办法：给一个不存在的假路径，从报错里看有没有那个模型类型的字样。

```js
addon.createOfflineTts({ model: { zipvoice: { tokens: 'X:/nope.txt', ... } }, ... })
// 期望拿到: offline-tts-zipvoice-model-config.cc:Validate --zipvoice-tokens: 'X:/nope.txt' does not exist
```

**实际拿到**：只有一句

```
Please check your config!
```

因为那段带细节的 C++ 报错是原生库**直接打到 stderr** 的，根本不进 JS 异常对象。

**正确做法**：拿**真模型**试加载。能建成 TTS 实例就是支持：

```js
const t = addon.createOfflineTts({ model: { zipvoice: { tokens: <真路径>, encoder, decoder, dataDir, vocoder } }, ... })
addon.getOfflineTtsSampleRate(t)   // → 24000
```

（`tools/check-env.cjs` 就是这么做的。另外注意：如果 `zipvoice` 那组键给得不全，
校验器会先报 `Please provide exactly one tts model.` —— 一个会误导人的错。）

**B4 — `readWave` 只吃 WAV。** mp3 / m4a 请先转 WAV 再用。

---

### C. 音频切分与文本对齐

**C1 — 句内换气和句间停顿可能只差 200ms。**

实测一次真实录音：

```
句内停顿（句号处换气）: 0.38 / 0.41 / 0.46 / 0.48 / 0.52 / 0.55 / 0.82 / 0.96 / 1.04 s
句间停顿（两条之间的换气）: 1.23 ~ 1.33 s
```

用 250ms 阈值 → 一句被切成三段；用 1150ms → 正好 14 段。
**做法**：把 200 / 300 / … / 1300ms 都跑一遍，挑「段数 == 已知台词条数」的那个，然后**必须复核**。

**C2 — 段数吻合 ≠ 对齐正确。** ⚠️ 最危险的一个

我们曾遇到：切出 **26 段**，台词清单正好 **26 句**，看起来完美。
实际上其中一段是**两句话被合并**了，导致从第 7 段开始整体错位一格。

后果：参考文本与音频不匹配 → 克隆出来的音色莫名其妙地跑偏 → **而且不会报任何错**。

**所以：`asr-align.cjs` 这一步不能省。** 它按**内容**匹配（不按位置），
并额外输出一张"顺序对齐检查表"，直接告诉你有没有错位。

**C3 — ASR 的两个局限，别误用。**

- 对**专有名词**会听错（`DeepSeek Harness` → `Deepsea Carnus`）→ 它适合做**对齐**，不适合做**内容验证**
- 在**极端音效处理**下可能"复读"或多吐字（我们遇到过一档听成 `Access permission required. Acce`）
  → 可懂度分数在两端都不可靠，**最终判断还得靠耳朵**

**C4 — 别信 TTS 的停顿声明，要量。**

MiniMax 的 `Welcome to Deep<#0.15#>Seek<#0.25#> Harness.` 实测：

```
声明 0.15 + 0.25 = 0.40s
实测 0.96 + 1.04 = 2.00s   ← 放大 5 倍
句间 <#0.5#> 实测 1.23~1.33s ← 放大 2.6 倍
```

听感上就是 "Welcome to Deep…（停 1 秒）…Seek…（停 1 秒）…Harness"，
而且那一幕会白白多等 2 秒。`tools/segment-audio.cjs` 会打印每段的句内停顿，一眼就能看到。

---

### D. 时序直觉 vs 剪辑软件逻辑

**D1 — "文字出来了语音还没跟上"，该挪不该砍。**

用户原话很准：「按照剪辑软件逻辑，保持整体音频长度不变，把音频往前挪对应的时间就好了。」

```
砍： 缩短总长 → 整个动画变快（节奏变了）
挪： lead 减少多少，tail 就增加多少 → 总长一帧不变，节奏不变
```

而且**"独立成幕"的呼吸感本来就该在说完之后**，不在"字出来了干等语音"。
所以：**能挪就挪**。

**D2 — 前留白上限是物理事实。**
某句前留白只有 1.2s，用户想砍 1.8s —— 做不到，最多挪光 1.2s。想再多只能动总长。

**D3 — 插件里每幕停留的公式。**

```js
// splash.js
var target = Math.max(ms(step.hold), (spoken || 0) + ms(240));
//                                                            ↑ 硬编码的收尾留白
```

所以：
- **幕间最小间隔就是 240ms**，做不到真正无缝
- 想让 3→4→5 连播：把这几幕的首尾留白都设 0，剩下 240ms 就是插件自带过渡
- 加长音频会直接加长该幕

---

### E. 底噪：必须贯穿全局

**E1 — 底噪写在文件里一定会断。**

插件是**6 个独立音频文件**逐幕播放，幕与幕之间还有 240ms 过渡。
底噪若只存在于文件内，留白和幕间就是数字静音 —— 安静环境下立刻"出戏"。

**正确做法：做一条全局底噪床**（Web Audio 现场合成循环噪声），
开机起床 → 揭幕才收，中间全程不断。也就是影视混音里的"通道常开"。

**E2 — 电平与曲线建议。**

- 底噪里那个**稳态单音**（如 120Hz 交流声）比宽频嘶声更容易被听成"噪音源"，
  所以它应该比嘶声压得更狠
- **淡入用线性**，淡出可以线性也可以指数
- 淡入时长 ≥2.5s 才不会显得"突然出现"

---

### F. Web Audio 的两个陷阱

**F1 — `AudioParam.value` 不返回插值结果。** ⚠️ 静默失效

```js
// ✗ 想从"当前增益"开始淡出
gain.cancelScheduledValues(t)
gain.setValueAtTime(gain.value, t)        // gain.value === 最后一次"显式设定值"
gain.linearRampToValueAtTime(0, t + 2)    // 若之前设过 setValueAtTime(0)，这里就是从 0 到 0
// 结果：增益瞬间掉到 0，等于瞬断；而且不报错、不报警
```

**解法**：用 `cancelAndHoldAtTime(t)`（它会固化当前插值），或**自己按曲线算当前值**：

```js
var elapsed = t - fadeStartTime
var current = targetLevel * Math.max(0, Math.min(1, elapsed / fadeInDuration))
```

**F2 — 淡入不能用 `exponentialRamp`。**

指数曲线是 dB 线性的，听起来"均匀" —— 但那是对**淡出**而言。
**淡入**时从接近 0 指数爬升，前面绝大部分时间都在听阈以下，最后才窜到目标值：

```
3 秒淡入到一半：
  线性  → 振幅 50%  = −6 dB   （耳朵觉得"快满了"）
  指数  → 振幅 −42 dB          （还几乎听不见，然后突然出现）
```

**差 36 dB。** 所以：**淡入线性，淡出随意。**

**F3 — 浏览器要求先有用户手势才准出声。**

AudioContext 初始是 suspended 的。所以开机最前面那段"完全没声音"是平台限制，改不了。

---

### G. 插件与缓存

**G1 — 素材响应带 24 小时缓存。**

```
Content-Type: audio/mpeg
Cache-Control: public, max-age=86400
```

换完音频**必须 Ctrl+Shift+R 硬刷新**，普通 F5 会一直用旧副本，
表现为"我换了但听起来没变"。

**G2 — 静态文件（css/js）按 mtime 缓存** → 改代码只需刷新页面，不用重启。

**G3 — WAV 内容可以塞进 `.mp3` 文件名，一行代码都不用改。**

素材路由：

```js
// 白名单 + 防目录穿越
if (!/^[a-z0-9._-]+\.mp3$/i.test(name) || name.includes('..')) { 404 }
// 原样吐字节
res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.length })
res.end(bytes)
```

而播放端是：

```js
fetch('/dsh-startup/asset/line-1.mp3')
  .then(r => r.arrayBuffer())
  .then(ab => audioContext.decodeAudioData(ab))   // ← 按内容嗅探，不看扩展名
```

所以把 WAV 命名成 `line-1.mp3` 完全能播。**代价**：文件体积比 MP3 大（
22kHz/16bit/mono ≈ 44 KB/s）。想要小体积就自己转成真 MP3。

**G4 — 音量滑杆有死区。**

```js
// 素材播放的增益
g.gain.value = Math.min(1, 0.85 * clamp01(C.voiceVolume, 0, 1) * 1.6)
//                         0.85 × 1.6 = 1.36
```

| 滑杆 | 实际增益 |
|---|---|
| 0.45 | 0.612 |
| 0.60 | 0.816 |
| 0.735 | 1.000 |
| 0.8 / 0.9 / 1.0 | **全是 1.000（死区）** |

**有效范围只有 0 ~ 0.735。** 在 0.8 以上拖动不会有任何变化。

**G5 — 别手工往 `cordis.patch.yml` 加插件的 insert 行。**

插件被注册两次 → `apply` 跑两遍 → `ctx.webServer.register()` 对同一路径重复注册 → **直接报错，启动失败**。
`dsh plugin add` 会自动把声明了 `dsh.bundle` 的依赖并入层堆栈，不需要手工加。

**G6 — DSH 的应用内文件预览是沙箱。**

- 相对路径的本地媒体加载不了（播放器停在 `0:00 / 0:00`）
- `data:` URI 也会被拦

给人试听时**给文件绝对路径，让对方用系统浏览器打开**，别指望内置预览。
（这也解释了为什么"自包含单文件 HTML"在外部浏览器能用、在应用内不行。）

---

### H. 网络（中国大陆）

**H1 — 直连 GitHub 基本不可用。**

实测：

| 目标 | 结果 |
|---|---|
| `codeload.github.com`（pnpm/git 拉 tarball 走这里） | ❌ 30s 超时 |
| git 协议 `github.com/.../info/refs` | ❌ 19.5s 失败 |
| `gh-proxy.com` 代理 release 资产 | ✅ 200 / **2.7s** |
| `hf-mirror.com` | ✅ 200 / 2.5s |
| `modelscope.cn` | ✅ 302 / **0.96s** |
| `huggingface.co` | ❌ 15s 超时 |

**做法**：
- GitHub Release 资产 → `https://gh-proxy.com/https://github.com/...`
- 模型 → hf-mirror 或 ModelScope
- Python 包 → 清华镜像

**H2 — 模型都在 GitHub Release 的固定标签下。**

```
tts-models      sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2   (~104 MB)
vocoder-models  vocos_24khz.onnx                                        (~52 MB)
asr-models      sherpa-onnx-whisper-tiny.en.tar.bz2                     (~113 MB)
```

（`scripts/download-models.ps1` 已内置 gh-proxy 与 `-Mirror` 覆盖。）

---

### I. 脚本环境

**I1 — PowerShell 5.1 按 ANSI(GBK) 读无 BOM 的 `.ps1`。**

后果：中文串被撕碎 → 语法报错，例如

```
字符串缺少终止符: '。
语句块或类型定义中缺少右“}”。
```

**所以工具包里的 `.ps1` 一律纯 ASCII。** 要写中文就加 UTF-8 BOM。

**I2 — Windows 默认执行策略禁止直接跑 `.ps1`。**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
# 或者
Invoke-Expression (Get-Content -Raw scripts\download-models.ps1)
```

**I3 — 别在 PowerShell 里内联多行 node 脚本**，容易被引号/换行解析炸。
写成 `.cjs` 文件再跑。

---

## 最后：一条不是技术、但更重要的

**技术做得到 ≠ 可以发布。**

我们验证过：从一段游戏配音里截几秒，就能克隆出几乎一模一样的音色，
让它说任意新台词。这不难。

**但那是别人的声音。** 公开发布这类产物，风险与后果都由你承担。

所以这个工具包**不携带任何音频**，也建议你：

- 只用**你有权使用**的声音（自己的、已获授权的、或明确商用许可的合成音色）
- 想做可发布的「机械化播报音」→ 干净干音 + 本工具包的 DSP 链，**这条路完全干净**
- 想克隆某个角色音色 → 留着自己玩可以，**别公开分发**
