# 桌面端在系统音量合成器里的身份（为什么显示成 Microsoft Edge WebView2）

排查日期：2026-10-09 · 环境：Windows 11 26300 · WebView2 154.0.4258.62 · AuralFlow 0.6.11

## 现象

任务栏与开始菜单里图标、名字都正确，但**系统音量合成器**（设置 → 系统 → 声音 → 音量合成器）
里本应用的音频显示为 **「Microsoft Edge WebView2」+ Edge 图标**，认不出是 AuralFlow。

## 证据

1. **音频不是主进程播的**。`auralflow.exe`（pid 9416）派生出的 WebView2 进程组里，真正持音频会话的是
   `--type=utility --utility-sub-type=audio.mojom.AudioService --service-sandbox-type=audio`（pid 8264），
   它是浏览器进程（pid 22716）的子进程，即本应用的**孙进程**。

2. **AUMID 没有覆盖到音频进程**。`--app-user-model-id=cn.chenle.auralflow`（`tauri.conf.json` 的
   `additionalBrowserArgs`）只出现在**浏览器进程**的命令行里；音频服务进程的完整命令行里没有它。
   实测：进程也没有打包身份，于是系统只能按 exe 身份回退显示。

3. **shell 里的应用身份本身是好的**：`shell:AppsFolder\cn.chenle.auralflow` 存在，
   `Name = AuralFlow`、`Link.Target = D:\AuralFlow\auralflow.exe`；开始菜单快捷方式带着 AUMID 属性。
   也就是说「名字解析链」没问题，问题在于音频进程不带任何身份。

4. **会话的名称/图标可以由别的进程改写**（这条决定了修复方案）：对**别人拥有**的音频会话调用
   `IAudioSessionControl::SetDisplayName` / `SetIconPath`，实测返回 `S_OK`，并且能立刻读回新值。
   对照：`pure_live.exe` 的会话登记了 `package:media_kit` + 自己的 exe 图标，合成器就照着它显示，
   说明合成器优先用会话自己登记的名称/图标，只有它们为空时才退回进程身份。

## 修复

`src-tauri/src/audio_session.rs`：后台线程按秒轮询**默认渲染端点**上的音频会话，把满足
「进程链能追到本应用」且名称/图标还不是目标值的会话改写为：

- 名称：`AuralFlow`
- 图标：`<当前 exe 路径>,0`

失败一律降级（只记日志）。日志锚点：

```
[audio-session] 已把音频会话身份改写为 AuralFlow（pid=8264）
```

## 已知边界

- 只处理**默认渲染端点**上的会话；把播放设备切到非默认端点时不会改写。
- WebView2 若在会话生命周期内重新登记名称/图标，会在下一次轮询（≤1s）内被改回。
- 主进程侧的 `SetCurrentProcessExplicitAppUserModelID` 与 `--app-user-model-id` 仍然保留：
  它们负责任务栏/开始菜单的名字与图标，与音频会话这一层无关。
