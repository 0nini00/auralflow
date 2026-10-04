# 桌面四项功能实施计划

- [x] 公共模型与本地映射：core/sources/types.ts、tauri-bridge/src/index.ts、services/localMusicService.ts；先运行local-playback-model.test.ts红灯，再补映射。
- [x] 本地分类worker：LocalMusicView、localLibraryGrouping、LocalLibraryBrowser与local-library测试；复用同一localSongs。
- [x] 手动匹配worker：MetadataEditModal、manualMediaMatchService和候选dialog；测试不确认不写文件、手动覆盖和过期响应。
- [x] 歌词：core/lyrics解析、lyricsService、useLyrics、歌词组件与两个显示开关；解析和React渲染测试。
- [x] ReplayGain：Rust models/local_audio 标签、纯增益模型、本地GainNode、playerEngine/PlaybackSettings/App接线；单测覆盖增益正负/峰值及旧线上通路。
- [x] 集成：library更新同步到当前播放元信息及队列而不重启播放；扫描刷新RG但保留手动覆盖。
- [x] 验证：pnpm test:desktop；pnpm test:core；pnpm check:all；cargo build --tests后cargo test（60秒）；pnpm desktop:build；实际音频/组件冒烟；独立审查、diff检查。
