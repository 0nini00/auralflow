# Audio fixtures

这些一秒单声道静音文件由本地 FFmpeg 合成，不含用户音频。测试将副本写入临时目录，验证真实容器的标签写回与时长保持。

生成方式：`ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 1 -c:a CODEC silence.EXT`。

编码器分别为 MP3 `libmp3lame`、FLAC `flac`、OGG `libvorbis`、Opus `libopus`、AIFF `pcm_s16be`、M4A/AAC `aac`。WAV fixture 由测试直接构造。

`cover-red.png` 和 `cover-blue.png` 是 Pillow 生成的 1×1 RGB 纯色图，用于确认封面替换没有保留旧图。
