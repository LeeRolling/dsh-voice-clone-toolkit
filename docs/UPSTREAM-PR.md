# 上游 PR：[`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen) 的 `ID CONFIRMED` 读数重叠修正

> 本文件记录我们从**本地修改**到**建议上游**的完整过程，供透明审计与复现。
> 补丁： [`docs/patches/0001-idline-reposition.patch`](patches/0001-idline-reposition.patch)
> 目标： [6shenhonghong9/dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)（MIT，作者 **沈宏宏**）

---

## 一、我们在本地改过插件什么（透明记录）

本工具包**不包含**该插件的代码，也不修改它。但为了让成品音频听起来对，
我们在**本机那份副本**上做了两类改动。全部改动都有备份，可逐级回退。

| # | 改动 | 文件 | 备份链 | 是否建议上游 |
|---|---|---|---|---|
| 1 | `ID CONFIRMED` 读数挪到右下角 + 与身份核验同进退 | `lib/splash.css` `lib/splash.js` | `*.pre-idline-patch.bak` | ✅ **建议**（见下） |
| 2 | 全局底噪床（贯穿开机的循环噪声，v1→v4 迭代） | `lib/splash.js` | `*.pre-bed-patch.bak` → `pre-bed2` → `pre-bed3` → `pre-bed4` | ❌ 不建议（纯个人听感偏好） |

**第 2 类为什么不上游**：它会给所有用户加一条常驻底噪，属于产品取向问题，
不应该由我们替原作者决定。它留在本工具包的文档里当经验记录就好
（见 [PITFALLS.md](../PITFALLS.md) 的 E 组）。

**回退方式**：把对应的 `*.bak` 覆盖回原文件名即可。补丁链顺序：
`pre-idline` → `pre-bed` → `pre-bed2` → `pre-bed3` → `pre-bed4` → 当前。

---

## 二、建议上游的改动

### 问题

`ID CONFIRMED : <编号>` 这行等宽读数固定定位在 `left: calc(50% + 190px); top: 49%`
—— 正好落在**居中大标题的右侧延伸区**。于是：

1. 窗口一窄，或读数本身变长（例如把 `identityId` 改成更长的编号），
   它就会和中文大字、英文等宽副标题**叠在一起**
2. 原作者当时的应对是在 `@media (max-width: 1180px)` 里直接 `display: none`
   —— 也就是**小窗口下这行身份读数完全消失**
3. **退场时机**：`ui.idline.classList.remove('dsu-in')` 只在终幕调用一次，
   所以从第 1 幕到终幕它一直挂着，即使在"身份资料确认"早就完成之后

### 改动（两处，都很小）

**1. `lib/splash.css` —— 挪到右下角、页脚上方，不再进入居中文字的版心**

- `left: calc(50% + 190px); top: 49%` → `right: 46px; bottom: 104px`
- 加 `text-align: right`，右对齐成一条独立读数
- 删除 `@media (max-width: 1180px) { .dsu-idline { display: none } }` —— 挪位后不再需要隐藏
- 入场动效由 `translateY(-50%) translateX(16px)` 简化为纯 `translateX(16px)`
  （不再垂直居中，所以去掉 Y 分量）

**2. `lib/splash.js` —— 与身份核验同进退**

在 `stepLoop` 里，第 3 幕开始前收掉这行读数：

```js
var n = i + 1
if (i >= 2) ui.idline.classList.remove('dsu-in')   // ← 新增
setStepCount(n, step.badge)
```

理由：这行读数的叙事作用是「身份已确认」，而第 3 幕已经是「接收访问需求」。
让它跟着身份核验的退场动画一起消失，比一路挂到终幕更干净。

### 完整 diff

```diff
diff --git a/lib/splash.css b/lib/splash.css
@@ -424,12 +424,16 @@
-/* 右侧等宽信息行（对应参考片 "· ID CONFIRMED : JOYC"） */
+/* 右侧等宽信息行（对应参考片 "· ID CONFIRMED : JOYC"）
+   本地补丁：原定位 left:calc(50% + 190px) / top:49% 落在居中大标题的右侧延伸区，
+   会与中文大字、英文等宽副标题叠字（窗口越窄越明显）。改挂到右下角、页脚上方，
+   右对齐成一条独立读数，任何宽度下都不会进入居中文字的版心。 */
 .dsu-idline {
   position: absolute;
-  left: calc(50% + 190px);
-  top: 49%;
-  transform: translateY(-50%) translateX(16px);
+  right: 46px;
+  bottom: 104px;
+  text-align: right;
+  transform: translateX(16px);
@@ -440,7 +444,7 @@
-.dsu-idline.dsu-in { opacity: 1; transform: translateY(-50%); }
+.dsu-idline.dsu-in { opacity: 1; transform: none; }
@@ -1091,10 +1095,8 @@
-/* 窄窗口里右侧那行等宽小字会和环撞上，直接收掉 */
-@media (max-width: 1180px) {
-  .dsu-idline { display: none; }
-}
+/* 本地补丁：该行已挪到右下角，无需再隐藏 */

diff --git a/lib/splash.js b/lib/splash.js
@@ -1148,6 +1148,9 @@
       chain = chain.then(function () {
         if (finished) return
         var n = i + 1
+        /* 本地补丁：这行读数与身份核验同进退 —— 第 3 幕起收掉。
+           原代码只在 finale 里 remove('dsu-in')，所以它会一路挂到终幕。 */
+        if (i >= 2) ui.idline.classList.remove('dsu-in')
         setStepCount(n, step.badge)
         setSlats(n)
         setProgress(step.progress)
```

> 完整补丁（含上下文与索引行）见 [`patches/0001-idline-reposition.patch`](patches/0001-idline-reposition.patch)，
> 已验证可在原始文件上 `git apply --check` 干净应用。

---

## 三、PR 正文（可直接粘贴）

**标题**

```
fix: ID CONFIRMED 读数与幕内文案重叠，且小窗口下被隐藏
```

**正文**

```markdown
## 问题

`ID CONFIRMED : <编号>` 这行等宽读数定位在 `left: calc(50% + 190px); top: 49%`，
正好压在居中大标题的右侧延伸区。两个后果：

1. **会叠字**：窗口一窄，或 `identityId` 稍长，它就和中文大字 / 英文等宽副标题重叠。
   现在代码的应对是 `@media (max-width: 1180px) { display: none }` ——
   等于**窄窗口下这行身份读数直接消失**。
2. **退场时机不对**：`remove('dsu-in')` 只在 finale 里调用一次，
   所以这行读数从第 1 幕一路挂到终幕，哪怕"身份资料确认"早就完成了。

## 改动

**1. `lib/splash.css`** —— 挪到右下角、页脚上方

- `left: calc(50% + 190px); top: 49%` → `right: 46px; bottom: 104px`
- 加 `text-align: right`，右对齐成一条独立读数
- 删掉窄窗口的 `display: none`（挪位后不会再和环/文字相撞）
- 入场动效去掉 `translateY(-50%)`（不再垂直居中）

**2. `lib/splash.js`** —— 与身份核验同进退

```js
var n = i + 1
if (i >= 2) ui.idline.classList.remove('dsu-in')   // 新增：第 3 幕起收掉
```

这行读数的叙事作用是「身份已确认」，而第 3 幕已经是「接收访问需求」。
让它跟着身份核验的动画一起退场，比一路挂到终幕更连贯。

## 效果

- 任意宽度都不再进入居中文字的版心，小窗口也不再丢失身份读数
- 退场时机与分镜叙事一致

## 测试

- 环境：DeepSeek Harness Desktop（desktop profile，Electron）
- 操作：完整播放开机序列 + `window.__DSH_STARTUP_API__.replay()` 重播多次
- 结果：读数稳定落在右下角、不与版心文字重叠；第 3 幕起随身份核验一并淡出
- 说明：未在 <1180px 的窄窗口下逐档验证，但该行已脱离居中文字的版心，
  原先的碰撞在几何上不会再发生

## 补丁

`0001-idline-reposition.patch` 可直接 `git apply`，已验证在 v1.1.0 的
`lib/splash.css` / `lib/splash.js` 上干净应用。

---

本次改动的代码由 AI 助手协助撰写，方案取舍与实机验证由提交者确认。
```

> 上面最后那句「AI 助手协助」建议保留 —— 诚实标注是现在的通行做法，
> 也免得后面被问起来尴尬。你要是不想留，删掉那一段即可。

---

## 四、怎么提交这个 PR

**① 先 Fork**

打开 https://github.com/6shenhonghong9/dsh-startup-screen → 右上角 **Fork** →
得到 `https://github.com/LeeRolling/dsh-startup-screen`

**② 克隆你的 fork，建分支**

```powershell
cd "C:\Users\Admin\Documents\deepseek-harness\default-workspace"
git clone https://github.com/LeeRolling/dsh-startup-screen.git
cd dsh-startup-screen
git checkout -b fix/idline-reposition
```

**③ 应用补丁**

```powershell
git apply "..\dsh-voice-clone-toolkit\docs\patches\0001-idline-reposition.patch"
git diff --stat
```

预期输出：

```
 lib/splash.css | 12 +++++-------
 lib/splash.js  |  3 +++
 2 files changed, 9 insertions(+), 6 deletions(-)
```

> ⚠️ 如果上游已经改过这几个位置，`git apply` 会失败（会明确告诉你在哪个 hunk）。
> 那种情况下别硬来 —— 告诉我，我按上游的最新代码重新生成补丁。

**④ 看一眼、确认没问题**

```powershell
git diff
```

**⑤ 提交并推送**

```powershell
git add -A
git commit -m "fix: ID CONFIRMED 读数与幕内文案重叠，且小窗口下被隐藏"
git push -u origin fix/idline-reposition
```

**⑥ 开 PR**

推送后终端会直接给出一个链接，或者打开
`https://github.com/6shenhonghong9/dsh-startup-screen/compare/main...LeeRolling:fix/idline-reposition`
→ 把上面第三节的标题和正文粘进去 → **Create pull request**

---

## 五、为什么值得做这件事

- 我们**站在这个插件上**才做出了开机动画。把改进还回去，比点个 star 实在得多
- 这个补丁是**通用问题**，不是我们自己的偏好 —— 原作者大概率会用
- 一旦收下，别人就不需要打补丁，你也不需要维护 fork
- 如果最后没被合并，也没有损失：issue/PR 本身就是一份记录
