export interface LibraryLocalMusicActions {
  scanLabel: string;
  scanAccessibilityLabel: string;
  scanHint: string;
  importLabel: string;
  importAccessibilityLabel: string;
  importHint: string;
  disabled: boolean;
}

export function buildLibraryLocalMusicActions({
  localSongCount,
  loading,
}: {
  localSongCount: number;
  loading: boolean;
}): LibraryLocalMusicActions {
  if (loading) {
    return {
      scanLabel: "扫描中",
      scanAccessibilityLabel: "正在扫描本地音乐",
      scanHint: "正在扫描设备音乐库",
      importLabel: "添加中",
      importAccessibilityLabel: "正在添加本地音乐文件",
      importHint: "请稍候",
      disabled: true,
    };
  }

  if (localSongCount > 0) {
    return {
      scanLabel: "刷新",
      scanAccessibilityLabel: "刷新本地音乐",
      scanHint: "重新扫描设备音乐库",
      importLabel: "添加文件",
      importAccessibilityLabel: "从文件选择器添加本地音乐",
      importHint: "手动选择音频文件加入曲库",
      disabled: false,
    };
  }

  return {
    scanLabel: "扫描",
    scanAccessibilityLabel: "扫描本地音乐",
    scanHint: "扫描设备音乐库",
    importLabel: "添加文件",
    importAccessibilityLabel: "从文件选择器添加本地音乐",
    importHint: "手动选择音频文件加入曲库",
    disabled: false,
  };
}
