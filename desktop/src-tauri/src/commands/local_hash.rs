/// 计算本地文件的内容指纹（流式 md5）。
///
/// 为什么单独立一条命令：歌词选择要绑定「做出选择时的那份文件内容」，而前端没有可用的文件
/// 哈希能力（也不值得为一个非安全用途引入新的前端依赖）。仓库里本来就有 `md5` crate，
/// 直接复用；md5 在这里只做内容变更检测，不承担任何安全职责。
///
/// 为什么流式：一首无损曲目动辄几十 MB，整文件读进内存只为算哈希既浪费又可能被中断；
/// 分块 consume 让峰值内存与文件大小无关。
///
/// 调用时机由前端保证：只在用户做出歌词选择时调用一次，不在扫描 / 播放路径上调用。
#[tauri::command]
pub async fn hash_local_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);

    // 整文件读盘是同步阻塞 IO：放进阻塞线程池，否则大文件会让 tokio worker 卡住，
    // 其它 IPC（播放解析、歌词、设置）跟着一起停。
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let metadata = std::fs::metadata(&path_buf)
            .map_err(|err| format!("读取文件信息失败: {}", err))?;
        if !metadata.is_file() {
            return Err(format!("不是文件: {}", path));
        }

        let mut file =
            std::fs::File::open(&path_buf).map_err(|err| format!("打开文件失败: {}", err))?;
        let mut context = md5::Context::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|err| format!("读取文件失败: {}", err))?;
            if read == 0 {
                break;
            }
            context.consume(&buffer[..read]);
        }
        Ok(format!("{:x}", context.compute()))
    })
    .await
    .map_err(|err| format!("计算文件指纹任务异常: {}", err))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试专用临时目录：唯一名字建目录，Drop 时连同内容一起删掉。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "auralflow-local-hash-{}-{}",
                label,
                unique_temp_suffix()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn hash(path: &Path) -> Result<String, String> {
        tauri::async_runtime::block_on(hash_local_file(path.to_string_lossy().into_owned()))
    }

    #[test]
    fn hashes_file_content_with_md5() {
        let dir = TempDir::new("content");
        let path = dir.write("song.flac", b"audio-bytes");

        assert_eq!(
            hash(&path).unwrap(),
            format!("{:x}", md5::compute(b"audio-bytes"))
        );
    }

    #[test]
    fn streams_whole_file_beyond_one_chunk() {
        // 分块读取最容易错在「只算第一块」或「漏掉零头」：用跨块的文件把结论钉住。
        let dir = TempDir::new("chunked");
        let content: Vec<u8> = (0..200_000u32).map(|index| (index % 251) as u8).collect();
        let path = dir.write("long.flac", &content);

        assert_eq!(hash(&path).unwrap(), format!("{:x}", md5::compute(&content)));
    }

    #[test]
    fn same_content_different_names_share_fingerprint() {
        // 改名 / 移动不该改变指纹：选择靠它跨文件名继续生效。
        let dir = TempDir::new("rename");
        let first = dir.write("before.flac", b"same-bytes");
        let second = dir.write("after.flac", b"same-bytes");

        assert_eq!(hash(&first).unwrap(), hash(&second).unwrap());
    }

    #[test]
    fn different_content_changes_fingerprint() {
        let dir = TempDir::new("replace");
        let path = dir.write("song.flac", b"first-content");
        let before = hash(&path).unwrap();
        dir.write("song.flac", b"second-content-longer");

        assert_ne!(before, hash(&path).unwrap());
    }

    #[test]
    fn fails_for_missing_path_and_directory() {
        let dir = TempDir::new("missing");
        let missing = dir.0.join("nope.flac");

        assert!(hash(&missing).is_err());
        // 目录没有内容指纹可言：明确报错，不悄悄返回一个固定值。
        assert!(hash(&dir.0).is_err());
    }
}
