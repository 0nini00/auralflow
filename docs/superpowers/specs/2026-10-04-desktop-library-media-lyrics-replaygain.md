# 桌面曲库、资料匹配、歌词与 ReplayGain

范围：用户确认原五项中暂不做真实频谱，仅实现以下四项。维持 React/Tauri 与现有在线播放，不引入 BASS，不复制 ZeroBit 源码，不自动提交或发布。

1. 本地曲库：从同一 localSongs 派生全部/艺术家/专辑/文件夹视图和搜索；当前筛选结果决定播放队列；专辑按艺术家+名称区分，不盲目拆分AC/DC等名称。
2. 手动资料：搜索网易/QQ候选并预览，用户选择歌词/封面后默认应用本机覆盖项；写入文件单独确认。覆盖项保留扫描与重启，不把大封面base64写入曲库。选定封面原始字节存入独立manual-covers资料目录，不受自动缓存清理影响；本机覆盖同时保留匹配的翻译和罗马音，写文件仅写原文。错误与部分写入明确展示，过期请求不能覆盖新选择。
3. 歌词：归一化来源提供的 romaLyric 与明确 ruby 标记；不生成罗马音/注音，不猜测同时间多行语义。播放页/桌面歌词独立显示开关默认关闭，原始逐字与译文兼容。手动localLyrics优先缓存并支持同曲实时更新。
4. ReplayGain：默认关闭，仅本地曲目已有 gain/peak 标签；读取而不自动分析或改写标签。增益与用户音量/静音/淡入淡出分离；峰值已知时限制防削波，缺峰值不声称已防削波。无效/缺失标签不处理并显示原因。使用本地受控asset的GainNode，仅做音量处理不创建Analyser，不把在线URL接入WebAudio，不改变LX开关语义。

公共契约：MusicInfo.replayGain={gainDb,peak?}；LocalSong新增replayGain/embeddedLyrics/lyricsOverride/coverOverride，localSongToMusicInfo与getLocalSongCover为统一映射。RustAppSettings新增replayGainEnabled、lyricShowRomanization、lyricShowRuby（默认false）。

验证：分类与当前队列、异步候选失效与明确写文件、手动覆盖缓存优先、歌词安全渲染与切换、RG数学与元数据读取、真实音频输出增益、线上/本地切换、LX回归。后端单测60秒，编译单独进行。已有测试→类型检查/lint→桌面构建→最小冒烟，不以随机图形替代验证。


## 完成验证

- 桌面180项、core131项、Rust57项单元/组件测试通过；check:all与desktop:build通过。移动端保留原有2条lint警告，构建有原有分块提示。
- 无界面Chromium通过实际WAV波形验证负增益、正增益与静音，并验证不提供CORS的在线流仍使用普通媒体元素正常推进。测试用分析节点只存在于临时验证脚本，产品未增加频谱。
- 修复了本地输出初始化迟到抢回旧歌、暂停后旧请求复活、多标签ReplayGain漏读；专职复审已确认相关修复。
- 未做原生Tauri窗口的人工视听验收，未生成新release、未Git提交。
