import { useState, useRef } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { logger } from "@/services/logger";
import { updateSettings, useSettingsStore } from "@/stores/settingsStore";

export function PactModal() {
  const dialogRef = useRef<HTMLDivElement>(null);
  // 设置还没读到时不能当成「没同意过」：读到之前不弹；读取失败则照常弹出。
  const needsConsent = useSettingsStore((s) => (s.settings ? !s.settings.pactAccepted : s.loadError !== null));
  const [dismissed, setDismissed] = useState(false);
  const visible = needsConsent && !dismissed;

  const handleAccept = () => {
    // 落盘失败不阻塞使用：本次先关掉，下次启动会再问一次。
    setDismissed(true);
    updateSettings({ pactAccepted: true }).catch((error) => {
      logger.warn("保存「已同意使用须知」失败，下次启动会再次询问", error);
    });
  };

  useDialogFocus({ open: visible, containerRef: dialogRef, closeOnEscape: false });

  if (!visible) return null;

  return (
    <div className="af-dialog-overlay af-pact-overlay">
      <div ref={dialogRef} className="af-dialog af-pact-dialog" role="dialog" aria-modal="true" aria-labelledby="af-pact-title">
        <h2 id="af-pact-title">使用须知</h2>
        <div className="af-pact-body">
          <p>AuralFlow 是一个基于 Tauri + React 的多源音乐播放器，仅供学习交流使用。</p>
          <ul>
            <li>本软件不存储任何音频文件，所有内容来自第三方音源，版权归原权利人所有。</li>
            <li>VIP 歌曲播放需要你自己的网易云账号登录，请勿用于商业用途或批量下载。</li>
            <li>使用本软件产生的任何法律责任由使用者自行承担。</li>
            <li>请遵守所在地相关版权法律法规。</li>
          </ul>
          <p className="af-pact-confirm">继续使用即视为你已阅读并同意以上条款。</p>
        </div>
        <div className="af-dialog-actions">
          <button className="af-btn-primary" onClick={handleAccept}>
            我已阅读并同意
          </button>
        </div>
      </div>
    </div>
  );
}
