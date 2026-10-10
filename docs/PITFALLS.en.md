# Pitfalls

[中文](PITFALLS.md) | **English**

> This is the English edition. Every entry below was hit for real — raw errors included.
> The [Chinese edition](PITFALLS.md) carries some additional commentary.

---

## Quick reference (symptom → cause)

| # | Symptom / error | Actual cause | Fix |
|---|---|---|---|
| 1 | `reference_sample_rate 0 is invalid` | Reference-audio fields at the top level instead of inside `generationConfig` | Nest them; wrong placement is **silently ignored** |
| 2 | `Expect only 2 arguments. Given: 3` | Every function in this native addon takes an **options object** | `decodeOfflineStream(rec, stream)`, `acceptWaveformOffline(stream, {samples,sampleRate})` |
| 3 | Replaced the audio, no change | Asset responses carry `max-age=86400` | **Ctrl+Shift+R** hard refresh |
| 4 | Edited CSS/JS, no change | Static files are cached by mtime | Normal refresh is enough (no restart needed) |
| 5 | Volume slider does nothing at 0.8 / 0.9 / 1.0 | Gain is `min(1, 0.85×v×1.6)`; above 0.735 everything clamps to 1.0 | Only 0–0.735 is useful |
| 6 | Fade-out sounds like an instant cut | `AudioParam.value` **does not return the interpolated value** | Use `cancelAndHoldAtTime`, or compute the value yourself |
| 7 | Fade-in sounds like it "just appears" | `exponentialRamp` used; for the first ~90 % it stays below the hearing threshold | **Use a linear ramp to fade in**; exponential is fine for fading out |
| 8 | Segment count matches but the clone timbre drifts | One segment was actually **two sentences merged** → reference transcript off by one | Always verify with ASR; never trust the count |
| 9 | Awkward silence between a caption appearing and the voice | Lead-in silence too long | **Move the lead-in to the tail** (total length unchanged); don't cut |
| 10 | Noise floor "disappears" between scenes | The noise floor lived inside each audio file; between files it is digital silence | Use a **global noise bed** spanning the whole sequence |
| 11 | Plugin fails to start after hand-editing a patch file | Plugin registered twice; duplicate path registration throws | Remove the manual line; use `dsh plugin add` |
| 12 | `dsh --profile desktop --dump-config` refused | The desktop profile is **owned by the Electron process** | CLI can only `plugin add/remove`, not boot |
| 13 | `rg` / `readdir` on `app.asar` says the path does not exist | asar is an archive, not a directory | Use `ELECTRON_RUN_AS_NODE=1` with the app's exe |
| 14 | Chinese text in `.ps1` turns into garbage / syntax errors | PowerShell 5.1 reads BOM-less `.ps1` as ANSI | Keep scripts pure ASCII, or add a UTF-8 BOM |
| 15 | `codeload.github.com` times out; git cannot connect | Direct GitHub access is blocked | Proxy release assets via gh-proxy; models via hf-mirror / ModelScope |
| 16 | Preview player stuck at `0:00 / 0:00` | DSH's in-app preview is sandboxed; local relative paths and `data:` URIs are blocked | Give people a file path and open it in a real browser |

---

## Detail

### A. Finding and using the sherpa-onnx that DSH ships

**A1 — DSH contains a complete local speech stack.**

```
<install>/resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-<platform>/
    sherpa-onnx.node          ← N-API addon; plain Node can require it
    sherpa-onnx-c-api.dll
    onnxruntime.dll
```

Measured **sherpa-onnx 1.13.8 / onnxruntime 1.28.2**, exporting **104 capabilities**:
offline and streaming ASR, TTS, **ZipVoice zero-shot cloning**, speaker embedding and
similarity, speech denoising, VAD, punctuation, keyword spotting, language ID, and
speaker diarization.

Because it is **N-API** (stable ABI) it loads in a system Node — no Electron runtime needed.

**A2 — `app.asar` itself is not a directory.**

`rg` and `fs.readdirSync('.../app.asar/dsh')` both fail with "path not found".
To browse inside asar, use Electron's node mode (Electron's fs is asar-patched):

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& "C:\...\DeepSeek Harness.exe" your-script.js "C:\...\app.asar\dsh\node_modules\..."
```

(This is flaky in practice. For reliable access, `npx @electron/asar extract` is better.)

**A3 — The CLI cannot boot the desktop profile.**

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

`dsh plugin --profile desktop add/remove` is allowed; **booting it is not**.
This is also why some marketplace plugins explicitly say "do not change the desktop
profile from the command line".

---

### B. The shape of this native addon's API

**B1 — Everything takes an options object, and the errors tell you the arity.**

```js
// ✗ positional
addon.acceptWaveformOffline(stream, sampleRate, samples)   // Expect only 2 arguments. Given: 3
addon.decodeOfflineStream(stream)                          // Expect only 2 arguments. Given: 1
addon.writeWave(file, samples, sampleRate)                 // Expect only 2 arguments. Given: 3

// ✓ options objects
addon.acceptWaveformOffline(stream, { samples, sampleRate })
addon.decodeOfflineStream(recognizer, stream)
addon.writeWave(file, { samples, sampleRate })
addon.offlineTtsGenerateWithConfig(tts, { text, generationConfig })
```

**Fastest way to learn the API**: install the official JS wrapper and read its mapping
layer — it passes objects straight through to the addon.

```bash
npm i sherpa-onnx-node
# node_modules/sherpa-onnx-node/non-streaming-tts.js / non-streaming-asr.js / types.js
```

**B2 — ZipVoice reference-audio fields MUST be nested inside `generationConfig`.** (Biggest time sink.)

```js
// ✗ top level — silently ignored, and the resulting error looks unrelated
addon.offlineTtsGenerateWithConfig(tts, {
  text, referenceAudio, referenceSampleRate, referenceText,   // all useless
})
// → TTS generation failed
//   offline-tts-zipvoice-impl.h:Generate:79 reference_sample_rate 0 is invalid.

// ✓ correct
addon.offlineTtsGenerateWithConfig(tts, {
  text,
  generationConfig: {
    referenceAudio: Float32Array,      // reference samples
    referenceSampleRate: 24000,
    referenceText: 'what the reference says',  // required — aligns timbre to phonemes
    numSteps: 4,
    extra: { minCharInSentence: '5' }, // required for short lines; default splits at 30 chars
  },
})
```

**B3 — You cannot probe model-type support by feeding fake paths.**

The seemingly clever approach: pass a non-existent path and look for the model type in
the error.

```js
addon.createOfflineTts({ model: { zipvoice: { tokens: 'X:/nope.txt', ... } }, ... })
// expected: offline-tts-zipvoice-model-config.cc:Validate --zipvoice-tokens: 'X:/nope.txt' does not exist
```

**What you actually get** is one line:

```
Please check your config!
```

Because the detailed C++ errors are written **directly to stderr** by the native library
and never reach the JS exception object.

**Correct approach**: load a **real** model. If the TTS instance is created, the type is supported:

```js
const t = addon.createOfflineTts({ model: { zipvoice: { tokens: <real>, encoder, decoder, dataDir, vocoder } }, ... })
addon.getOfflineTtsSampleRate(t)   // → 24000
```

(`tools/check-env.cjs` does exactly this.) Also note: if the `zipvoice` group is
incomplete, the validator reports `Please provide exactly one tts model.` — a misleading error.

**B4 — `readWave` only accepts WAV.** Convert mp3 / m4a to WAV first.

---

### C. Segmentation and text alignment

**C1 — Intra-line breaths and inter-line pauses can differ by only 200 ms.**

Real measurements from one recording:

```
intra-line (breathing at a period):   0.38 / 0.41 / 0.46 / 0.48 / 0.52 / 0.55 / 0.82 / 0.96 / 1.04 s
inter-line (between two lines):       1.23 ~ 1.33 s
```

At a 250 ms threshold one line got split into three; at 1150 ms we got exactly 14 segments.
**Method**: run 200 / 300 / … / 1300 ms, pick the one where the count matches the known
number of lines, then **verify**.

**C2 — A matching count does NOT mean correct alignment.** ⚠️ The most dangerous one.

We once got **26 segments** for a transcript of exactly **26 lines** — looked perfect.
One of those segments was actually **two sentences merged**, so from segment 7 onward
everything was off by one.

Consequence: reference text no longer matches the audio → the cloned timbre drifts
inexplicably → **and nothing reports an error.**

**So `asr-align.cjs` is not optional.** It matches by **content** (not position) and
prints an order-alignment table that tells you directly whether anything shifted.

**C3 — Two limits of ASR; don't misuse it.**

- Proper nouns get misheard (`DeepSeek Harness` → `Deepsea Carnus`) → use it for
  **alignment**, not content verification
- Under extreme FX it can start **repeating itself** (one tier was heard as
  `Access permission required. Acce`) → intelligibility scores are unreliable at both
  extremes; **the final judgement has to be human ears**

**C4 — Never trust a TTS's declared pauses; measure them.**

MiniMax prompt `Welcome to Deep<#0.15#>Seek<#0.25#> Harness.`:

```
declared: 0.15 + 0.25 = 0.40 s
measured: 0.96 + 1.04 = 2.00 s   ← 5× larger
inter-line <#0.5#> measured 1.23–1.33 s ← 2.6× larger
```

It sounds like "Welcome to Deep…(1 s)…Seek…(1 s)…Harness", and that scene waits an
extra 2 seconds for nothing. `tools/segment-audio.cjs` prints intra-line pauses per
segment, so this is visible immediately.

---

### D. Editing intuition vs. NLE logic

**D1 — "The caption appeared but the voice hadn't started yet" → move, don't cut.**

A user put it exactly right: *"By editing-software logic, keep the total audio length
unchanged and just move the audio earlier by the corresponding amount."*

```
cut: shorten the total → the whole animation speeds up (the rhythm changes)
move: reduce lead by N, increase tail by N → total unchanged, rhythm unchanged
```

And the "breathing room between standalone scenes" belongs **after** the line, not
while the operator stares at a caption waiting for audio. So: **move whenever you can.**

**D2 — The lead-in has a physical upper bound.**
One line had only 1.2 s of lead but the request was to cut 1.8 s — impossible; the
maximum is 1.2 s. Anything more means changing the total length.

**D3 — The plugin's scene-duration formula.**

```js
// splash.js
var target = Math.max(ms(step.hold), (spoken || 0) + ms(240));
//                                                            ↑ hard-coded tail
```

Therefore:
- The **minimum gap between scenes is 240 ms**; true seamlessness is not possible
- To run scenes back to back: set lead and tail to 0 on those scenes; the remaining
  240 ms is the plugin's own tail and already sounds immediate
- Longer audio directly lengthens the scene

---

### E. The noise floor must be global

**E1 — A noise floor stored inside the files will always break.**

The plugin plays **six independent audio files**, one per scene, with a 240 ms transition
between them. If the noise floor lives inside the files, the gaps between scenes are
digital silence — immediately noticeable ("the channel closed") in a quiet room.

**Correct approach: one global noise bed** (a looped Web Audio buffer synthesized at
runtime), started when the animation starts and stopped at the reveal. This is the film
mixing concept of a "always-open channel".

**E2 — Level and curve guidance.**

- A **steady tone** in the noise floor (e.g. 120 Hz AC hum) is far more noticeable than
  broadband hiss, so it should be attenuated harder than the hiss
- **Fade in linearly**; the fade-out can be linear or exponential
- A fade-in of ≥ 2.5 s is needed before it stops feeling abrupt

---

### F. Two Web Audio traps

**F1 — `AudioParam.value` does not return the interpolated value.** ⚠️ Fails silently

```js
// ✗ intended: fade out from the "current" gain
gain.cancelScheduledValues(t)
gain.setValueAtTime(gain.value, t)        // gain.value === last *explicitly set* value
gain.linearRampToValueAtTime(0, t + 2)    // if you once did setValueAtTime(0), this is 0 → 0
// Result: gain drops to 0 instantly. No error, no warning.
```

**Fix**: use `cancelAndHoldAtTime(t)` (which pins the interpolated value), or **compute
the current value yourself**:

```js
var elapsed = t - fadeStartTime
var current = targetLevel * Math.max(0, Math.min(1, elapsed / fadeInDuration))
```

**F2 — Do not use `exponentialRamp` for a fade-in.**

An exponential curve is linear in dB, which sounds "even" — but that is for a **fade-out**.
For a **fade-in**, starting near zero and rising exponentially keeps the signal below the
hearing threshold for most of the duration, then shoots up at the end:

```
3-second fade, halfway through:
  linear      → 50 % amplitude = −6 dB    (sounds "almost there")
  exponential → −42 dB                    (still inaudible, then it appears)
```

**A 36 dB difference.** So: **linear for fade-in, either for fade-out.**

**F3 — Browsers require a user gesture before audio may play.**

The AudioContext starts suspended. The completely silent first seconds of the boot
sequence are a platform limitation, not a bug.

---

### G. Plugin and caching

**G1 — Asset responses are cached for 24 hours.**

```
Content-Type: audio/mpeg
Cache-Control: public, max-age=86400
```

After replacing audio you **must hard-refresh with Ctrl+Shift+R**; a normal F5 keeps
serving the old copy, which looks exactly like "my change did nothing".

**G2 — Static files (css/js) are cached by mtime** → editing code only needs a refresh.

**G3 — WAV content can be named `.mp3`, with zero code changes.**

Asset route:

```js
// allowlist + path traversal guard
if (!/^[a-z0-9._-]+\.mp3$/i.test(name) || name.includes('..')) { 404 }
// raw bytes out
res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.length })
res.end(bytes)
```

Playback side:

```js
fetch('/dsh-startup/asset/line-1.mp3')
  .then(r => r.arrayBuffer())
  .then(ab => audioContext.decodeAudioData(ab))   // ← sniffs by content, not extension
```

So naming a WAV `line-1.mp3` plays fine. **Cost**: larger files
(22 kHz/16-bit/mono ≈ 44 KB/s). Convert to real MP3 if size matters.

**G4 — The volume slider has a dead zone.**

```js
g.gain.value = Math.min(1, 0.85 * clamp01(C.voiceVolume, 0, 1) * 1.6)
//                         0.85 × 1.6 = 1.36
```

| Slider | Actual gain |
|---|---|
| 0.45 | 0.612 |
| 0.60 | 0.816 |
| 0.735 | 1.000 |
| 0.8 / 0.9 / 1.0 | **all 1.000 (dead zone)** |

**The useful range is only 0 – 0.735.**

**G5 — Do not hand-add plugin insert lines to `cordis.patch.yml`.**

The plugin gets registered twice → `apply` runs twice → `ctx.webServer.register()` on the
same path twice → **hard error, startup fails**. `dsh plugin add` already merges
dependencies declaring `dsh.bundle` into the layer stack; no manual edit needed.

**G6 — DSH's in-app file preview is sandboxed.**

- Local media via relative paths will not load (player sits at `0:00 / 0:00`)
- `data:` URIs are blocked too

When sharing something for listening, **give an absolute file path and open it in a real
browser**. (This also explains why a self-contained single-file HTML works outside the
app but not inside it.)

---

### H. Networking (mainland China)

**H1 — Direct GitHub access is effectively unusable.**

Measured:

| Target | Result |
|---|---|
| `codeload.github.com` (what pnpm/git tarball fetches use) | ❌ 30 s timeout |
| git protocol `github.com/.../info/refs` | ❌ failed after 19.5 s |
| GitHub release assets via `gh-proxy.com` | ✅ 200 in **2.7 s** |
| `hf-mirror.com` | ✅ 200 in 2.5 s |
| `modelscope.cn` | ✅ 302 in **0.96 s** |
| `huggingface.co` | ❌ 15 s timeout |

**What to do**:
- GitHub release assets → `https://gh-proxy.com/https://github.com/...`
- Models → hf-mirror or ModelScope
- Python packages → the Tsinghua mirror

**H2 — The models live under fixed GitHub release tags.**

```
tts-models      sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2   (~104 MB)
vocoder-models  vocos_24khz.onnx                                        (~52 MB)
asr-models      sherpa-onnx-whisper-tiny.en.tar.bz2                     (~113 MB)
```

(`scripts/download-models.ps1` has gh-proxy built in, plus a `-Mirror` override.)

---

### I. Script environment

**I1 — PowerShell 5.1 reads BOM-less `.ps1` as ANSI (GBK on Chinese Windows).**

Effect: Chinese string literals get shredded → syntax errors such as

```
字符串缺少终止符: '。
语句块或类型定义中缺少右“}”。
```

**So every `.ps1` in this toolkit is pure ASCII.** Add a UTF-8 BOM if you need Chinese.

**I2 — Windows blocks `.ps1` execution by default.**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
# or
Invoke-Expression (Get-Content -Raw scripts\download-models.ps1)
```

**I3 — Do not inline multi-line Node scripts into PowerShell**; quoting and line
continuation break easily. Write a `.cjs` file and run that.

---

## Finally: one non-technical point

**Technical capability ≠ permission to publish.**

We verified that a few seconds of a game's voice acting is enough to clone a nearly
identical timbre and make it say anything. It is not hard.

**But that voice belongs to someone else.** Publishing such output carries risks and
consequences that are entirely yours.

That is why this toolkit **ships no audio**, and why we recommend:

- Only use voices you have the rights to (your own, authorized, or explicitly
  commercially-licensed synthetic voices)
- Want a publishable "mechanical announcer"? Clean dry voice + this toolkit's DSP
  chain — **that path is completely clean**
- Want to clone a character's voice? Fine for your own machine — **do not distribute it**
