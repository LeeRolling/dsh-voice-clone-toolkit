# DSH Voice Clone Toolkit

[中文](README.md) | **English**

> Local, zero-cost voice cloning and mechanical voice effects for
> **DeepSeek Harness** — built on the `sherpa-onnx` runtime that DSH already ships.
> Fully offline. No Python, no PyTorch, no GPU, no API keys.
>
> **This repository contains no audio of any kind.** It is a toolchain.

> ### 🙏 Credit where it is due — this toolkit is built *for* someone else's work
>
> The audio it produces is assembled into
> **[`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen)**,
> the DSH boot-animation plugin by **[沈宏宏](https://github.com/6shenhonghong9)**
> (MIT, `Copyright (c) 2026 沈宏宏`).
>
> **That plugin is not in this repository, and its copyright belongs to its author.**
> This toolkit only integrates with it and never modifies its code.
> Full third-party attributions and license status: **[NOTICE](NOTICE)**.
> If this toolkit helps you, please go star that plugin too.

---

## The discovery: DSH already ships a complete speech stack

Inside the DeepSeek Harness install directory there is an unremarkable folder:

```
<install>/resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-<platform>/
    sherpa-onnx.node          ← N-API addon; plain Node can require it
    sherpa-onnx-c-api.dll
    onnxruntime.dll
```

Measured version: **sherpa-onnx 1.13.8 / onnxruntime 1.28.2**, exporting **104 capabilities**:

| Capability | What it buys you |
|---|---|
| `createOfflineTts` + **ZipVoice** | **Zero-shot voice cloning** — 3–10 s of reference audio, then it says anything |
| `createOfflineRecognizer` (whisper) | Local ASR — used here to **verify segmentation** |
| `createSpeakerEmbedding*` | Objective speaker similarity scoring |
| `createOfflineSpeechDenoiser` | Denoising (also cleans up over-processed references) |
| `createVoiceActivityDetector` | VAD segmentation |

Because it is **N-API** (stable ABI), a system Node can load it directly —
**no Electron runtime, no Python, no PyTorch, no GPU.**

Measured: cloning **6 short lines takes about 10 seconds total on CPU** (RTF 0.4–1.3).

---

## What it does

1. **Turn clean dry voice into a "mechanical announcer"**
   Pure DSP: ring modulation + metallic comb resonance + telephone band-limiting
   + bit-depth reduction + sample-rate hold + AC hum
2. **Zero-shot cloning** — a few seconds of reference audio, then it says any new line
3. **Automatic alignment verification** — ASR transcription + content matching, so
   "segment count happens to match but the order is off by one" cannot slip through
4. **Parameter search** — finds FX settings under two constraints at once:
   *spectral closeness to a target* and *remaining intelligible*
5. **Per-scene assembly** — set lead/tail silence per scene, get the real scene
   duration, install into `dsh-startup-screen` in one command

---

## Quick start

```bash
# 0) Environment self-check (tells you exactly what is missing)
node tools/check-env.cjs

# 1) Download models (~270 MB; via gh-proxy by default, fast from mainland China)
powershell -ExecutionPolicy Bypass -File scripts/download-models.ps1
#   macOS/Linux:  bash scripts/download-models.sh

# 2) Split one long dry recording into single lines (prints a threshold table first)
node tools/segment-audio.cjs my-voice.wav --use=1150

# 3) MANDATORY: verify every segment, so a one-off misalignment cannot slip through
node tools/asr-align.cjs work/segments configs/lines.example.txt

# 4) Find settings that are "mechanical enough but still intelligible"
node tools/fx-lab.cjs --src=work/segments/seg-01.wav --text="Access permission required." --target=reference.wav

# 5) Apply FX + per-scene padding + assemble
node tools/fx-apply.cjs configs/dsh-startup.example.json

# 6) Install into the plugin (backs up the originals)
node tools/install-into-plugin.cjs --src=out --profile=desktop
```

Then **hard-refresh with Ctrl+Shift+R** and run `window.__DSH_STARTUP_API__.replay()` in the console.

---

## Pipeline

```
                 ┌──────────────────────────────────────┐
   your own   ──▶│ ① segment-audio   split on silence   │
   dry voice     └──────────────────────────────────────┘
                                  │
                                  ▼
                 ┌──────────────────────────────────────┐
                 │ ② asr-align   transcribe + match     │  ← do not skip
                 │               detects "off by one"   │
                 └──────────────────────────────────────┘
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
 ┌────────────────────────┐              ┌────────────────────────┐
 │ ③ fx-lab  search params│              │ ③' generate-clone      │
 │   spectrum + intelligi-│              │   zero-shot new lines  │
 │   bility               │              │                        │
 └────────────────────────┘              └────────────────────────┘
            │                                           │
            └─────────────────────┬─────────────────────┘
                                  ▼
                 ┌──────────────────────────────────────┐
                 │ ④ fx-apply   FX + per-scene padding  │
                 │              scene duration math     │
                 └──────────────────────────────────────┘
                                  ▼
                 ┌──────────────────────────────────────┐
                 │ ⑤ install-into-plugin   backup+install│
                 └──────────────────────────────────────┘
```

---

## Tools

| Tool | Purpose |
|---|---|
| `tools/check-env.cjs` | Self-check: finds DSH / native addon / models / plugin |
| `tools/segment-audio.cjs` | Multi-threshold comparison, then export at a chosen gap |
| `tools/asr-align.cjs` | **Per-segment transcription + content matching**; off-by-one detection |
| `tools/fx-lab.cjs` | Random search over FX params (spectral distance 55% + intelligibility 45%) |
| `tools/fx-apply.cjs` | Batch FX + padding + scene-duration calculation |
| `tools/generate-clone.cjs` | ZipVoice zero-shot cloning for arbitrary new lines |
| `tools/install-into-plugin.cjs` | Install into `dsh-startup-screen` (auto-backup, `--dry` supported) |
| `lib/common.cjs` | Shared layer: WAV I/O, segmentation, FFT profiling, ASR, FX chain, text similarity |
| `scripts/download-models.*` | Model download (gh-proxy built in, mirror overridable) |

---

## Measured results

One real session: 14 lines, 50.29 s of commercially-licensed dry voice (32 kHz mono).

**Segmentation and alignment**

```
silence gap 200 ms → 29 segments     intra-line pauses 0.38 – 1.04 s
silence gap 250 ms → 26 segments     inter-line pauses 1.23 – 1.33 s
silence gap 1150 ms → 14 segments ✓  exactly the 14 lines (verified by ASR)
```

**FX parameter search** (target profile: centroid 3024 Hz, bands 51/34/9/3/2 %)

| Tier | Ring mod | Band | Bits | Spectral dist | ASR intelligibility | Centroid |
|---|---|---|---|---|---|---|
| light | 55 Hz × 0.20 | 5200 | 11 | 0.133 | **100 %** | **3025 Hz** ← dead on |
| medium (shipped) | 48 Hz × 0.42 | 3800 | 10 | 0.134 | **100 %** | 3193 Hz |
| heavy | 40 Hz × 0.60 | 3200 | 9 | 0.166 | 49 % ⚠ | 2745 Hz |

**Cloning performance** (CPU only, 6 short lines)

```
~10 s total generation    RTF 0.4 – 1.3    output 24 kHz
```

**Scene assembly** (six scenes, 17.9 s of total on-screen time)

| Scene | Lead | Speech | Tail | Scene duration |
|---|---|---|---|---|
| 1 | 0.5 s | 1.47 s | 1.7 s | 3.91 s |
| 2 | 0.0 s | 1.35 s | 1.9 s | 3.49 s |
| 3 | 0 | 1.44 s | 0 | 1.68 s |
| 4 | 0 | 1.09 s | 0 | 1.33 s |
| 5 | 0 | 2.75 s | 0 | 2.99 s |
| 6 | 0.8 s | 3.00 s | 0.5 s | 4.54 s |

> Scenes 3 → 4 → 5 run back to back (zero lead/tail, joined by the plugin's built-in
> 240 ms tail). Scene 5 end → scene 6 speech onset ≈ **1.04 s**.

---

## Key pitfalls

Full list with raw error messages: **[docs/PITFALLS.en.md](docs/PITFALLS.en.md)** (30 items).

The ones that cost the most time:

| Symptom | Actual cause |
|---|---|
| `reference_sample_rate 0 is invalid` | Reference-audio fields were at the top level; they must be **nested inside `generationConfig`**. Wrong placement is **silently ignored**. |
| Segment count matches, but the cloned timbre drifts | One "segment" was actually **two sentences merged** → the reference transcript is off by one and **nothing reports an error** |
| Fade-out sounds like an instant cut | `AudioParam.value` **does not return the interpolated value** — it returns the last explicitly set value, so the fade ran 0 → 0 |
| Fade-in sounds like it "just appears" | `exponentialRamp` was used; for the first ~90 % of the time it stays below the hearing threshold |
| Volume slider does nothing above 0.8 | Gain is `min(1, 0.85 × v × 1.6)` → everything above **0.735 is a dead zone** |
| Replaced the audio, heard no change | Asset responses carry `Cache-Control: max-age=86400` → **hard refresh** required |
| Background hiss "disappears" between scenes | The noise floor lived inside each file; between files it is digital silence → needs a **global noise bed** |
| Plugin fails to start after hand-editing a patch file | The plugin gets registered twice; duplicate path registration throws |

---

## Localize / customize the animation

You do **not** need this toolkit, or any audio, to change the on-screen text or the
spoken language. Here is exactly what is editable, and where.

### 1. Editable from the settings page (no code)

Stored in `~/.dsh/dsh-startup.json`, editable through the plugin's settings UI:

```jsonc
{
  "identity":   "JOYCE MOORE",   // the operative name shown on screen
  "identityId": "0087",          // the ID badge
  "accessLevel": "3",
  "brand1": "DEEPSEEK",
  "brand2": "SYNTHESIZE INTELLIGENCE",
  "brand3a": "HARNESS",
  "brand3b": "OS",
  "orgZh":  "深度求索",           // ← the only Chinese string in the defaults
  "orgEn":  "DEEPSEEK",
  "orgSub": "DEEPSEEK HARNESS",
  "welcomeBox": "DEEPSEEK HARNESS",
  "footer": "POWERED BY DEEPSEEK",
  "accent": "#ff7500", "glitchA": "#ff3b30", "glitchB": "#2971b8"
}
```

`orgZh` is the only Chinese text exposed here — point it at your own org name,
or at anything else, and the animation is fully non-Chinese.

### 2. The five large step captions need a one-line edit

The animation is bilingual by design: each step shows a **Chinese caption** and an
**English caption** at once. Those live in the plugin:

```
<profile>/node_modules/dsh-startup-screen/lib/splash.js
    var STEPS = [
      { zh: '需要访问许可', en: 'ACCESS PERMISSION REQUIRED',
        say: 'Access permission required.', log: '等待用户授权…', logEn: 'AWAITING OPERATOR CONSENT', ... },
      ...
```

- `zh` — the large caption (Chinese by default)
- `en` — the uppercase caption
- `say` — the **spoken** line
- `log` / `logEn` — the small subtitle lines

Replace or empty the `zh` strings for a fully non-Chinese UI. (These are not exposed
in the settings page because the plugin treats them as fixed choreography.)

### 3. Change the spoken language without recording anything

```jsonc
{
  "voiceSource": "tts",     // asset = use lib/assets/line-*.mp3 ; tts = system speech synthesis
  "voiceLang":   "en",      // en | zh | both
  "voiceRate":   0.88,      // slower than normal reading — gives the words weight
  "voicePitch":  0.85,      // lowered pitch for a deeper AI voice
  "voiceName":   ""         // '' = auto-pick; or a specific system voice name
}
```

With `voiceSource: "tts"` the plugin speaks through the **Web Speech API** using
whatever voices your OS has, in whatever language you set. **No audio assets needed
at all** — so you can use this plugin in your own language without cloning anything.

### 4. Colors and pacing

```jsonc
{ "speed": 0.9, "soundVolume": 0.5, "voiceVolume": 0.6,
  "accent": "#ff7500", "glitchA": "#ff3b30", "glitchB": "#2971b8" }
```

Note `voiceVolume` has a dead zone above `0.735` (see pitfalls) — the useful range is 0–0.735.

---

## Licensing and ethics

**This toolkit ships no audio, and does not decide what you should do with it.**

Technical capability is not legal permission:

- ✅ **Clean dry voice + this toolkit's DSP chain** → completely clean, publishable
- ✅ Your own voice, or a synthetic voice you hold a **commercial license** for
- ⚠️ Cloning an arbitrary character voice from a few seconds of reference audio —
  **technically doable, but that voice belongs to someone else**
- ❌ Cloning game / film / real-person performances and redistributing them — don't

We verified that path works (a voice can be cloned convincingly). **The point of
verifying it was to know where the boundary is, not to encourage crossing it.**
If you only want it for yourself, that is your call; the moment it becomes public,
the risk and the responsibility are yours.

---

## Requirements

| Item | Requirement |
|---|---|
| DeepSeek Harness | Provides the `sherpa-onnx` native addon (tested: 1.13.8) |
| Node | ≥ 20 (system Node, or the one DSH bundles) |
| Python / PyTorch / GPU | **Not needed** |
| Disk | ~270 MB of models |
| Network | Only to **download models**; fully offline afterwards |

All paths can be overridden: `DSH_INSTALL_DIR` / `DSH_SHERPA_DIR` / `DSH_HOME`.
Non-default install locations work too (`check-env` lists everywhere it looked).

---

## Verified environment

Every script here has been smoke-tested:

| Item | Measured |
|---|---|
| OS | Windows 11 |
| Node | v24.15.0 |
| sherpa-onnx | **1.13.8** (git `11afbd00`, 2026-09-10) |
| onnxruntime | **1.28.2** |
| `check-env` | 8 passed / 0 missing |
| `segment-audio` | 50.29 s dry voice → threshold table → 14 segments at 1150 ms |
| `asr-align` | 14 segments × 14 lines, all matched, order confirmed |
| `fx-apply` | 6 scenes assembled, scene durations correct |
| `install-into-plugin --dry` | paths and padding inspection correct |
| `generate-clone` | ZipVoice loaded, 24 kHz output |

**macOS / Linux are untested** (the path detection has per-platform branches but has
not run on real hardware). If you get it working elsewhere, or hit a new pitfall,
please open an issue / PR — this pitfalls list was built one real crash at a time.

---

## Credits

This toolkit **stands on other people's work.** Without the following, it would be
nothing but a pile of math functions.

### [`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen) — by [沈宏宏](https://github.com/6shenhonghong9)

**This toolkit exists to serve that plugin.** Every finished audio file we produce ends
up playing inside it.

It is the premise of this whole project: it defines the six-scene structure, the
scene-duration formula (`max(step.hold, audioMs + 240)`), the asset-route conventions,
and the entire "interactive access-authorization sequence" design. All we did was
**make the voice good and put it in.**

- License: MIT (`Copyright (c) 2026 沈宏宏`)
- This repository contains **none** of its source code. `tools/install-into-plugin.cjs`
  only copies audio into its `lib/assets/`; it never touches its code
- `docs/` quotes a **few short code excerpts** from it (the asset-route allowlist, the
  scene-duration formula) purely to explain interoperability. Those excerpts remain
  the copyright of the original author

> ⚠️ **If you modify its code and intend to redistribute it**, MIT requires you to keep
> the original copyright notice and license text. The better move is to **contribute the
> change upstream** (open a PR) — that is exactly what our `ID CONFIRMED` position fix
> should become.

### [`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) — by k2-fsa

Every speech capability here comes from it: offline ASR, TTS, **ZipVoice zero-shot
cloning**, speaker embedding, denoising, VAD.

- License: Apache-2.0
- This repository does **not** redistribute it — it is already inside the DeepSeek
  Harness installation (`app.asar.unpacked`). All we did was *notice it was there*

### Models

| Model | Purpose | Upstream |
|---|---|---|
| `sherpa-onnx-whisper-tiny.en` | ASR verification | Whisper (MIT) |
| `sherpa-onnx-zipvoice-distill-int8-zh-en-emilia` | Zero-shot cloning | ZipVoice (Apache-2.0) |
| `vocos_24khz.onnx` | Vocoder | Vocos (MIT) |

Downloaded by `scripts/download-models.*` from the official releases; **not** committed.

### DeepSeek Harness

This toolkit targets it. **It is not affiliated with, or endorsed by, DeepSeek.**

---

## License

MIT. See [LICENSE](LICENSE) — third-party attributions and license status in [NOTICE](NOTICE).

---

*Every entry in the pitfalls list was hit first and understood second. Hopefully it saves you a few.*
