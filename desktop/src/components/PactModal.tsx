import { useState, useEffect, useRef } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";

interface Props {
  onAccepted: () => void;
}

export function PactModal({ onAccepted }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    loadSettings()
      .then((s) => {
        if (!s.pactAccepted) setVisible(true);
      })
      .catch(() => setVisible(true))
      .finally(() => setChecking(false));
  }, []);

  const handleAccept = async () => {
    try {
      await patchSettings({ pactAccepted: true });
    } catch {
      // 持久化失败不阻塞使用
    }
    setVisible(false);
    onAccepted();
  };

  useDialogFocus({ open: !checking && visible, containerRef: dialogRef, closeOnEscape: false });

  if (checking || !visible) return null;

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
