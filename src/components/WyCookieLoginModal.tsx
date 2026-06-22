import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { patchSettings } from "@lx/tauri-bridge";
import { setWyCookie } from "@/services/wyAccountService";
import { useWyAccountStore } from "@/stores/wyAccountStore";

interface WyCookieLoginModalProps {
  open: boolean;
  onClose: () => void;
}

export function WyCookieLoginModal({ open, onClose }: WyCookieLoginModalProps) {
  const loadAccount = useWyAccountStore((s) => s.load);
  const account = useWyAccountStore((s) => s.account);
  const storeError = useWyAccountStore((s) => s.error);
  const [cookieText, setCookieText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCookieText("");
    setError("");
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    const raw = cookieText.trim();
    if (!raw) {
      setError("请先粘贴网易云 Cookie");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const normalized = setWyCookie(raw);
      await patchSettings({ wyCookie: normalized });
      await loadAccount(normalized);

      const latest = useWyAccountStore.getState();
      if (!latest.account) {
        throw new Error(latest.error || storeError || "Cookie 验证失败");
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="af-dialog-overlay">
      <div className="af-dialog af-cookie-login-dialog">
        <div className="af-cookie-login-header">
          <div>
            <h2>登录网易云账号</h2>
            <p>粘贴已登录 music.163.com 的 Cookie，保存后会自动验证账号。</p>
          </div>
          <button type="button" className="af-menu-trigger" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="af-dialog-body">
          <label className="af-settings-label" htmlFor="wy-cookie-login">
            Cookie
          </label>
          <textarea
            id="wy-cookie-login"
            className="af-settings-textarea af-cookie-login-textarea"
            placeholder="_iuqxldmzr_=...; MUSIC_U=...; __csrf=..."
            value={cookieText}
            onChange={(event) => setCookieText(event.target.value)}
            autoFocus
          />
          <p className="af-settings-hint">
            登录 music.163.com 后，从浏览器 DevTools -&gt; Application -&gt; Cookies 复制。
          </p>
          {error && <p className="af-settings-error">{error}</p>}
          {account && (
            <p className="af-settings-hint">
              当前已登录：{account.nickname}
            </p>
          )}
        </div>

        <div className="af-dialog-actions">
          <button type="button" className="af-btn-secondary" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="af-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !cookieText.trim()}
          >
            {submitting ? "验证中..." : "保存并验证"}
          </button>
        </div>
      </div>
    </div>
  );
}
