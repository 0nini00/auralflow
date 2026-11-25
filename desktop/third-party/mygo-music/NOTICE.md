# MyGo Music 烟雾背景

来源：egoist/mygo-music 的 `internal/app/backdrop.go`。

上游提交：`a717245f18e773f27ffe9ee08b330dd101218515`。

源文件：https://github.com/egoist/mygo-music/blob/a717245f18e773f27ffe9ee08b330dd101218515/internal/app/backdrop.go

许可证：GNU Affero General Public License version 3，全文见同目录 `LICENSE`。

2026-11-25 移植修改：

- `desktop/src/services/immersiveFogShader.ts` 将 `fogSource` 转为 WebGL 1 GLSL，调整纵轴方向，保留五层噪声、上升流动、暗角与微尘。桌面播放引擎尚无频谱输出，使用上游 `Bass = 0` 的视觉结果。
- `desktop/src/services/immersiveBackgroundRenderer.ts` 沿用 `fogColors` 的 HSV 配色与 `step` 的速度渐变，接入已有封面色、生命周期和图形错误提示。半尺寸画布以 30 FPS 绘制，并保留大窗口像素预算。
- 切歌沿用本项目的颜色过渡，不保存上一个背景位图；暂停渐停，隐藏窗口、减少动态效果或关闭页面时停止持续绘制。

以上移植部分保留上游 AGPL-3.0 许可。
