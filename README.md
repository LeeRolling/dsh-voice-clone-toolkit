# DSH Voice Clone Toolkit

**中文** | [English](README.en.md)

> 用 **DeepSeek Harness 自带**的 `sherpa-onnx`，在本机零成本完成
> 音色克隆 + 机械音效 + 分幕配音装配 —— 全离线，不花钱，不上传声音。
>
> **本仓库不含任何音频。** 它是一个纯工具链。

> ### 🙏 先说清楚：这个工具包是「为别人的作品而做」的
>
> 它产出的音频，是装配进 **[`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen)**
> —— 由 **[沈宏宏](https://github.com/6shenhonghong9)** 开发的 DSH 启动动画插件
> （MIT 许可，`Copyright (c) 2026 沈宏宏`）。
>
> **那个插件不在本仓库里，版权归原作者。** 本工具包只与它对接、从不修改它的代码。
> 完整第三方署名与许可状态见 **[NOTICE](NOTICE)**。
> 如果你觉得本工具有用，请顺路也给那个插件点个 star。

---

## 起因：DSH 里藏着一整套语音工具链，但没人用

翻 DSH 的安装目录时会看到一个不起眼的模块：

```
<install>/resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-<平台>/
    sherpa-onnx.node          ← N-API 插件，普通 Node 直接 require
    sherpa-onnx-c-api.dll
    onnxruntime.dll
```

实测版本 **sherpa-onnx 1.13.8 / onnxruntime 1.28.2**，导出 **104 项能力**：

| 能力 | 用它能做什么 |
|---|---|
| `createOfflineTts` + **ZipVoice** | **零样本音色克隆** —— 给 3~10 秒参考音，让它说任意新台词 |
| `createOfflineRecognizer` (whisper) | 本地语音识别 —— 用来**逐段校验**切分对不对 |
| `createSpeakerEmbedding*` | 说话人相似度打分 —— 客观量化"像不像" |
| `createOfflineSpeechDenoiser` | 降噪 —— 顺便能去掉参考音里多余的效果 |
| `createVoiceActivityDetector` | VAD 切分 |

因为它是 **N-API**（ABI 稳定），用系统 Node 就能加载，**不需要 Electron 运行时、不需要 Python、不需要 PyTorch、不需要显卡**。

实测：**6 句短台词的克隆，纯 CPU 总共约 10 秒**（RTF 0.4~1.3）。

---

## 能做什么

1. **把一段干净干音做成"类副官机械播报音"**
   纯数学 DSP 链：环形调制 + 梳状金属共振 + 电话带通 + 位深压缩 + 采样率减半 + 交流声
2. **零样本克隆**：用几十秒参考音，让它说任意新台词
3. **自动逐段校验**：ASR 转写 + 内容匹配，防止"段数吻合但整体错位"
4. **参数搜索**：按「频谱贴近目标 + ASR 仍能听懂」双约束，自动找音效参数
5. **分幕装配**：按幕设置前后留白、算出每幕实际停留，一键装进 `dsh-startup-screen`

---

## 快速开始

```bash
# 0) 环境自检（会告诉你缺什么）
node tools/check-env.cjs

# 1) 下模型（约 270 MB，走 gh-proxy；国内实测 2.7s 可达）
powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1
#   macOS/Linux:  bash scripts/download-models.sh

# 2) 把一整段干音切成单句（会先跑一遍阈值对比表）
node tools/segment-audio.cjs my-voice.wav --use=1150

# 3) ⚠️ 必做：逐段核对，防止整体错位
node tools/asr-align.cjs work/segments configs/lines.example.txt

# 4) 找一组"够机器 + 还听得清"的音效参数
node tools/fx-lab.cjs --src=work/segments/seg-01.wav --text="Access permission required." --target=reference.wav

# 5) 批量应用 + 分幕气口 + 装配
node tools/fx-apply.cjs configs/dsh-startup.example.json

# 6) 装进插件（自动备份）
node tools/install-into-plugin.cjs --src=out --profile=desktop
```

装完：**Ctrl+Shift+R 硬刷新** → 控制台执行 `window.__DSH_STARTUP_API__.replay()`。

---

## 完整流水线

```
                     ┌─────────────────────────────────────┐
   你有权使用的干音 ──▶│ ① segment-audio   按静音切句         │
                     └─────────────────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────────────┐
                     │ ② asr-align       逐段转写 + 内容匹配 │  ← 不能省！
                     │                   检测"错位一格"      │
                     └─────────────────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
 ┌──────────────────────────┐              ┌──────────────────────────┐
 │ ③ fx-lab   参数搜索       │              │ ③' generate-clone        │
 │   频谱贴近 + 可懂度        │              │   零样本克隆说新台词      │
 └──────────────────────────┘              └──────────────────────────┘
              │                                           │
              └─────────────────────┬─────────────────────┘
                                    ▼
                     ┌─────────────────────────────────────┐
                     │ ④ fx-apply        加音效 + 分幕气口   │
                     │                   算出每幕停留时间     │
                     └─────────────────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────────────┐
                     │ ⑤ install-into-plugin  装进插件      │
                     │   自动备份 + 硬刷新提示               │
                     └─────────────────────────────────────┘
```

---

## 工具清单

| 工具 | 作用 |
|---|---|
| `tools/check-env.cjs` | 环境自检：找 DSH / 原生模块 / 模型 / 插件 |
| `tools/segment-audio.cjs` | 按静音切句；先输出多阈值对比表，再按指定阈值导出 |
| `tools/asr-align.cjs` | **逐段转写 + 内容匹配**；输出错位检测表与最佳 take |
| `tools/fx-lab.cjs` | 随机搜索音效参数（频谱距离 55% + 可懂度 45%） |
| `tools/fx-apply.cjs` | 按会话配置批量加音效、加气口、算幕时长 |
| `tools/generate-clone.cjs` | ZipVoice 零样本克隆，生成任意新台词 |
| `tools/install-into-plugin.cjs` | 装进 `dsh-startup-screen`（自动备份、可 dry-run） |
| `lib/common.cjs` | 公共层：WAV 读写、静音分段、FFT 频谱、ASR、音效链、文本相似度 |
| `scripts/download-models.*` | 模型下载（内置 gh-proxy 与镜像覆盖） |

---

## 我们实测出来的客观数据

用一套 14 句、50.29 秒的商用授权干音（32kHz / mono）走完整条流水线：

**切分与对齐**

```
静音间隔 200ms → 29 段     句内停顿 0.38 ~ 1.04 s
静音间隔 250ms → 26 段     句间停顿 1.23 ~ 1.33 s
静音间隔 1150ms → 14 段  ✓ 与 14 句台词一一对应（ASR 逐段复核通过）
```

**音效参数搜索**（目标画像：谱重心 3024 Hz，频带 51/34/9/3/2 %）

| 档 | 环形调制 | 频带 | 位深 | 频谱距 | ASR 可懂度 | 谱重心 |
|---|---|---|---|---|---|---|
| 轻 | 55Hz×0.20 | 5200 | 11 | 0.133 | **100%** | **3025 Hz** ← 几乎正中 |
| 中（最终采用） | 48Hz×0.42 | 3800 | 10 | 0.134 | **100%** | 3193 Hz |
| 重 | 40Hz×0.60 | 3200 | 9 | 0.166 | 49% ⚠ | 2745 Hz |

**克隆性能**（纯 CPU，6 句短台词）

```
生成耗时合计 ≈ 10 秒    RTF 0.4 ~ 1.3    输出 24 kHz
```

**分幕装配**（六幕合计停留 17.9 秒）

| 幕 | 前留白 | 语音 | 后留白 | 该幕停留 |
|---|---|---|---|---|
| 1 | 0.5s | 1.47s | 1.7s | 3.91s |
| 2 | 0.0s | 1.35s | 1.9s | 3.49s |
| 3 | 0 | 1.44s | 0 | 1.68s |
| 4 | 0 | 1.09s | 0 | 1.33s |
| 5 | 0 | 2.75s | 0 | 2.99s |
| 6 | 0.8s | 3.00s | 0.5s | 4.54s |

> 3→4→5 是连播（首尾留白全 0，靠插件自带 240ms 衔接）；
> 第 5 句结束到第 6 句开口 = 240ms + 0.8s ≈ **1.04 秒**。

---

## 踩坑表（精华）

完整版见 **[docs/PITFALLS.md](docs/PITFALLS.md)**（中文）· **[docs/PITFALLS.en.md](docs/PITFALLS.en.md)**（English）
—— 30 条真实踩过的坑，含原始报错。

几条最容易翻车的：

| 症状 | 真正的原因 |
|---|---|
| `reference_sample_rate 0 is invalid` | 参考音参数放在了顶层，必须嵌进 `generationConfig`；放错是**静默忽略** |
| 段数吻合，但克隆音色跑偏 | 某段其实是**两句并成一段** → 参考文本整体错位一格，**不报错** |
| 淡出像"瞬间静音" | `AudioParam.value` **不返回插值结果** → 淡出实际从 0 淡到 0 |
| 淡入像"突然出现" | 用了 `exponentialRamp` → 前 90% 时间都在听阈以下 |
| 音量滑杆拖到 0.9 没反应 | 增益公式 `min(1, 0.85×v×1.6)` → **>0.735 是死区** |
| 换完音频没变化 | 素材响应带 `Cache-Control: max-age=86400` → 必须硬刷新 |
| 安静时底噪"突然没了"很出戏 | 底噪写在文件里 → 幕间是数字静音；要改成**全局底噪床** |
| 手工加了 patch 行后启动失败 | 插件被注册两次，同一路径重复注册 |

---

## 自定义动画的文字与语言

**你不需要本工具包、也不需要任何音频**，就能改掉开机动画的屏幕文字和播报语言。
下面把「能改什么、在哪改」列清楚。

### 1. 设置页就能改（不用写代码）

存在 `~/.dsh/dsh-startup.json`，也可以在插件设置页里改：

```jsonc
{
  "identity":   "JOYCE MOORE",   // 屏幕上显示的身份名称
  "identityId": "0087",          // 编号牌
  "accessLevel": "3",            // 权限等级
  "brand1": "DEEPSEEK",
  "brand2": "SYNTHESIZE INTELLIGENCE",
  "brand3a": "HARNESS",
  "brand3b": "OS",
  "orgZh":  "深度求索",           // ← 默认配置里唯一的中文，老外要改的就是它
  "orgEn":  "DEEPSEEK",
  "orgSub": "DEEPSEEK HARNESS",
  "welcomeBox": "DEEPSEEK HARNESS",
  "footer": "POWERED BY DEEPSEEK",
  "accent": "#ff7500", "glitchA": "#ff3b30", "glitchB": "#2971b8"
}
```

### 2. 那 5 句大标题的中文，要改一行代码

动画是**双语**设计：每一幕同时显示「中文大标题」+「英文小标题」。它们在插件里：

```
<profile>/node_modules/dsh-startup-screen/lib/splash.js
    var STEPS = [
      { zh: '需要访问许可', en: 'ACCESS PERMISSION REQUIRED',
        say: 'Access permission required.', log: '等待用户授权…', logEn: 'AWAITING OPERATOR CONSENT', ... },
      ...
```

| 字段 | 作用 |
|---|---|
| `zh` | 大标题（默认中文）|
| `en` | 大写英文标题 |
| `say` | **念出来的那句** |
| `log` / `logEn` | 底部小字 |

要做纯非中文界面，把 5 个 `zh` 换掉或清空即可。
（设置页不暴露这几个，是因为插件把它们当作固定的分镜编排。）

### 3. 不用录音也能换播报语言

```jsonc
{
  "voiceSource": "tts",     // asset = 用 lib/assets/line-*.mp3 ; tts = 用系统语音合成
  "voiceLang":   "en",      // en | zh | both
  "voiceRate":   0.88,      // 比正常朗读慢 —— 字与字之间才有重量
  "voicePitch":  0.85,      // 压低音调，深沉的 AI 女声
  "voiceName":   ""         // '' = 自动挑；也可以指定系统里的某个音色
}
```

`voiceSource` 设成 `"tts"` 时，插件走 **Web Speech API**，用你系统里现有的音色、
按你设的语言念。**完全不需要任何音频素材** —— 所以老外不用克隆任何东西，
就能把这个插件换成自己的语言。

### 4. 配色与节奏

```jsonc
{ "speed": 0.9, "soundVolume": 0.5, "voiceVolume": 0.6,
  "accent": "#ff7500", "glitchA": "#ff3b30", "glitchB": "#2971b8" }
```

注意 `voiceVolume` 在 `0.735` 以上是死区（见踩坑表），有效范围是 0 ~ 0.735。

---

## 版权与伦理（请认真读）

**这个工具包不含音频，也不替你决定该用它做什么。**

技术能力不等于法律许可：

- ✅ **干净干音 + 本工具包的 DSP 链** → 完全干净，可以发布
- ✅ 你自己的声音、或已获**商用授权**的合成音色 → 可以用
- ⚠️ 用几十秒参考音克隆任意角色音色 → **技术上做得到，但那是别人的声音**
- ❌ 拿游戏 / 影视 / 真人配音去克隆并公开分发 → 别做

我们验证过那条路能走通（音色可以克隆得非常像）。**验证的目的是知道边界在哪，不是鼓励越界。**
如果你只是想自己玩，那是你的事；一旦涉及公开发布，风险与后果都由你承担。

---

## 环境要求

| 项 | 要求 |
|---|---|
| DeepSeek Harness | 提供 `sherpa-onnx` 原生模块（实测 1.13.8） |
| Node | ≥ 20（系统 Node 或 DSH 自带的都行） |
| Python / PyTorch / 显卡 | **都不需要** |
| 磁盘 | 模型约 270 MB |
| 网络 | 只在**下模型**时需要；之后全程离线 |

路径全部可覆盖：`DSH_INSTALL_DIR` / `DSH_SHERPA_DIR` / `DSH_HOME`。
非默认路径的安装也能用（`check-env` 会列出它扫过哪些位置）。

---

## 已验证环境

本工具包每个脚本都跑过冒烟测试，下面是实测通过的组合：

| 项 | 实测 |
|---|---|
| OS | Windows 11 |
| Node | v24.15.0 |
| DeepSeek Harness | `C:\Users\<用户>\AppData\Local\Programs\DeepSeek Harness` |
| sherpa-onnx | **1.13.8**（git `11afbd00`, 2026-09-10） |
| onnxruntime | **1.28.2** |
| `check-env` | 8 项通过 / 0 缺失 |
| `segment-audio` | 50.29s 干音 → 阈值表 → 1150ms 切出 14 段 |
| `asr-align` | 14 段 × 14 句全部匹配，位置与内容一致 |
| `fx-apply` | 6 幕装配，幕时长计算正确 |
| `install-into-plugin --dry` | 目标路径与留白检查正确 |
| `generate-clone` | ZipVoice 加载成功，输出 24 kHz |

**macOS / Linux 未经实测**（路径探测逻辑已按平台写了分支，但没在真机上跑过）。
如果你在别的平台跑通了、或踩到新坑，欢迎提 issue / PR —— 这份踩坑表就是靠一个个真实撞坑攒出来的。

---

## 致谢

本工具包**站在别人的作品上**。没有下面这些，它只是一堆数学函数。

### [`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen) —— 作者 [沈宏宏](https://github.com/6shenhonghong9)

**这个工具包是为它而做的。** 我们所有的音频成品，最终都是装进这个插件里播的。

它是本项目存在的前提：它定义了 6 幕的分镜结构、每幕的停留时长公式
（`max(step.hold, audioMs + 240)`）、素材路由的约定、以及整套"交互式访问授权序列"的设计。
我们做的事情只有一件 —— **把声音做好然后塞进去**。

- 许可：MIT（`Copyright (c) 2026 沈宏宏`）
- 本仓库**不包含**它的任何源码；`tools/install-into-plugin.cjs` 只往它的 `lib/assets/` 里复制音频，从不改它的代码
- `docs/` 里为说明互操作性，引用了它的**少量代码片段**（素材路由白名单、停留时长公式等），这些片段版权仍归原作者

> ⚠️ **如果你修改了它的代码并打算再分发**，MIT 要求你保留原作者的版权声明和许可证全文。
> 更好的做法是**把改动贡献回上游**（提 PR）—— 本工具包当初的 `ID CONFIRMED` 位置修正就是这类改动。

### [`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) —— 作者 k2-fsa

本项目全部的语音能力都来自它：离线 ASR、TTS、**ZipVoice 零样本克隆**、说话人识别、降噪、VAD。

- 许可：Apache-2.0
- 本仓库**不分发**它 —— 它就在 DeepSeek Harness 的安装目录里（`app.asar.unpacked`）。
  我们做的事只是"发现它原来一直在那儿"

### 模型文件

| 模型 | 用途 | 上游项目 |
|---|---|---|
| `sherpa-onnx-whisper-tiny.en` | ASR 逐段校验 | Whisper（MIT）|
| `sherpa-onnx-zipvoice-distill-int8-zh-en-emilia` | 零样本克隆 | ZipVoice（Apache-2.0）|
| `vocos_24khz.onnx` | 声码器 | Vocos（MIT）|

由 `scripts/download-models.*` 从官方发布页下载，**不入库**。

### DeepSeek Harness

本工具包面向它编写。**与 DeepSeek 官方无隶属关系，也未被其背书。**

---

## 许可

MIT。见 [LICENSE](LICENSE) —— 第三方署名与许可状态见 [NOTICE](NOTICE)。

---

*本工具包里的每一条坑，都是先撞上去、再爬出来的。希望能帮你少撞几个。*
