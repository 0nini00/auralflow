import { X, Download } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { UpdateInfo } from "@/services/updateService";

interface Props {
  info: UpdateInfo;
  onClose: () => void;
}

export function UpdateModal({ info, onClose }: Props) {
  const handleOpen = () => {
    void open(info.releaseUrl);
  };

  return (
    <div className="af-dialog-overlay" onClick={onClose}>
      <div className="af-dialog af-update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="af-metadata-header">
          <h2>发现新版本</h2>
          <button className="af-menu-trigger" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="af-dialog-body">
          <p className="af-update-version">
            当前 <strong>{info.currentVersion}</strong>
            <span className="af-update-arrow"> → </span>
            最新 <strong>{info.latestVersion}</strong>
          </p>
          <p className="af-update-name">{info.releaseName}</p>
          <p className="af-settings-hint">
            点击下方按钮在浏览器打开发布页面手动下载安装包。本应用不会自动下载或安装。
          </p>
        </div>
        <div className="af-dialog-actions">
          <button className="af-btn-secondary" onClick={onClose}>稍后再说</button>
          <button className="af-btn-primary" onClick={handleOpen}>
            <Download size={16} />
            <span>打开发布页</span>
          </button>
        </div>
      </div>
    </div>
  );
}
