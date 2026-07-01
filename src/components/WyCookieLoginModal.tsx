import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, RefreshCw, X } from "lucide-react";
import { patchSettings } from "@lx/tauri-bridge";
import {
  checkWyQrLogin,
  createWyQrLoginImage,
  getWyCookie,
  setWyCookie,
  type WyQrLoginImage,
} from "@/services/wyAccountService";
import { useWyAccountStore } from "@/stores/wyAccountStore";
import { warnAsyncError } from "@/utils/logAsyncError";

interface WyCookieLoginModalProps {
  open: boolean;
  onClose: () => void;
}

type LoginMethod = "qr" | "cookie";

export function WyCookieLoginModal({ open, onClose }: WyCookieLoginModalProps) {
  const loadAccount = useWyAccountStore((s) => s.load);
  const logoutAccount = useWyAccountStore((s) => s.logout);
  const account = useWyAccountStore((s) => s.account);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("qr");
  const [cookieText, setCookieText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [error, setError] = useState("");
  const [qrLogin, setQrLogin] = useState<WyQrLoginImage | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [qrError, setQrError] = useState("");
  const [qrExpired, setQrExpired] = useState(false);
  const [accountError, setAccountError] = useState("");

  const clearQrPolling = useCallback(() => {
    if (!pollTimerRef.current) return;
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const persistLoginCookie = useCallback(async (rawCookie: string) => {
    const previousCookie = await getWyCookie();
    const previousAccountState = {
      account: useWyAccountStore.getState().account,
      playlists: useWyAccountStore.getState().playlists,
      isLoading: false,
      isLoaded: useWyAccountStore.getState().isLoaded,
      error: useWyAccountStore.getState().error,
    };

    try {
      const normalized = setWyCookie(rawCookie);
      await patchSettings({ wyCookie: normalized });
      await loadAccount(normalized);

      const latest = useWyAccountStore.getState();
      if (!latest.account) {
        throw new Error(latest.error || "网易云账号验证失败");
      }

      onClose();
    } catch (err) {
      setWyCookie(previousCookie);
      useWyAccountStore.setState(previousAccountState);
      try {
        await patchSettings({ wyCookie: previousCookie || null });
      } catch (rollbackError) {
        warnAsyncError("wy-login:rollback-cookie", rollbackError);
      }
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  }, [loadAccount, onClose]);

  const startQrPolling = useCallback((key: string) => {
    clearQrPolling();
    setQrExpired(false);
    let pending = false;

    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await checkWyQrLogin(key);
        setQrStatus(status.message);

        if (status.code === 800) {
          clearQrPolling();
          setQrExpired(true);
          setQrStatus("二维码已过期，请刷新后重新扫码");
          return;
        }
        if (status.code === 801 || status.code === 802) return;
        if (status.code !== 803) {
          clearQrPolling();
          setQrError(status.message);
          return;
        }
        if (!status.cookie) {
          clearQrPolling();
          setQrError("扫码成功但网易云未返回 Cookie，请刷新二维码重试");
          return;
        }

        clearQrPolling();
        setSubmitting(true);
        setQrError("");
        setQrExpired(false);
        await persistLoginCookie(status.cookie);
      } catch (err) {
        clearQrPolling();
        setQrError(err instanceof Error ? err.message : String(err));
      } finally {
        pending = false;
        setSubmitting(false);
      }
    };

    pollTimerRef.current = setInterval(poll, 1800);
    void poll();
  }, [clearQrPolling, persistLoginCookie]);

  const refreshQrLogin = useCallback(async () => {
    clearQrPolling();
    setQrLoading(true);
    setQrError("");
    setQrExpired(false);
    setQrStatus("正在生成二维码...");
    setQrLogin(null);
    try {
      const nextQrLogin = await createWyQrLoginImage();
      setQrLogin(nextQrLogin);
      setQrStatus("请使用网易云音乐 App 扫码登录");
      setQrExpired(false);
      startQrPolling(nextQrLogin.key);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : String(err));
    } finally {
      setQrLoading(false);
    }
  }, [clearQrPolling, startQrPolling]);

  useEffect(() => {
    if (!open) {
      clearQrPolling();
      return;
    }

    setLoginMethod("qr");
    setCookieText("");
    setError("");
    setQrError("");
    setQrStatus("");
    setQrExpired(false);
    setAccountError("");
    setLogoutPending(false);
    setQrLogin(null);
    void refreshQrLogin();
  }, [clearQrPolling, open, refreshQrLogin]);

  useEffect(() => clearQrPolling, [clearQrPolling]);

  if (!open) return null;

  const handleCookieSubmit = async () => {
    const raw = cookieText.trim();
    if (!raw) {
      setError("请先粘贴网易云 Cookie");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await persistLoginCookie(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    clearQrPolling();
    setLogoutPending(true);
    setError("");
    setQrError("");
    setAccountError("");
    try {
      await logoutAccount();
      onClose();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogoutPending(false);
    }
  };

  const switchLoginMethod = (method: LoginMethod) => {
    setLoginMethod(method);
    if (method === "qr") {
      setError("");
      if (qrLogin) {
        startQrPolling(qrLogin.key);
      } else if (!qrLoading) {
        void refreshQrLogin();
      }
      return;
    }
    clearQrPolling();
    setQrError("");
    setQrExpired(false);
  };

  return (
    <div className="af-dialog-overlay">
      <div className="af-dialog af-cookie-login-dialog">
        <div className="af-cookie-login-header">
          <div>
            <h2>登录网易云账号</h2>
          </div>
          <button type="button" className="af-menu-trigger" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="af-dialog-body">
          <div className="af-login-method-tabs" role="tablist" aria-label="网易云登录方式">
            <button
              type="button"
              className={`af-login-method-tab ${loginMethod === "qr" ? "af-active" : ""}`}
              onClick={() => switchLoginMethod("qr")}
              role="tab"
              aria-selected={loginMethod === "qr"}
            >
              扫码登录
            </button>
            <button
              type="button"
              className={`af-login-method-tab ${loginMethod === "cookie" ? "af-active" : ""}`}
              onClick={() => switchLoginMethod("cookie")}
              role="tab"
              aria-selected={loginMethod === "cookie"}
            >
              Cookie 登录
            </button>
          </div>

          {loginMethod === "qr" ? (
            <div className="af-qr-login-panel" role="tabpanel">
              <div className="af-qr-code-box">
                {qrLogin ? (
                  <>
                    <img src={qrLogin.qrImageUrl} alt="网易云扫码登录二维码" />
                    {qrExpired && <span className="af-qr-expired-badge">已过期</span>}
                  </>
                ) : (
                  <span>{qrLoading ? "生成中..." : "二维码未生成"}</span>
                )}
              </div>
              <div className="af-qr-login-copy">
                <p>{qrStatus || "请使用网易云音乐 App 扫码登录"}</p>
                <button
                  type="button"
                  className="af-settings-small-button"
                  onClick={refreshQrLogin}
                  disabled={qrLoading || submitting || logoutPending}
                >
                  <RefreshCw size={14} />
                  刷新二维码
                </button>
              </div>
              {qrError && <p className="af-settings-error">{qrError}</p>}
            </div>
          ) : (
            <div role="tabpanel">
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
              {error && <p className="af-settings-error">{error}</p>}
            </div>
          )}

          {account && (
            <div className="af-cookie-login-account">
              {account.avatarUrl && <img src={account.avatarUrl} alt="" />}
              <div>
                <p>当前已登录：{account.nickname}</p>
                <span>UID：{account.uid}</span>
              </div>
            </div>
          )}
          {accountError && <p className="af-settings-error">{accountError}</p>}
        </div>

        <div className="af-dialog-actions">
          {account && (
            <button
              type="button"
              className="af-btn-secondary af-settings-danger-button"
              onClick={handleLogout}
              disabled={submitting || logoutPending}
            >
              <LogOut size={16} />
              <span>{logoutPending ? "退出中..." : "退出登录"}</span>
            </button>
          )}
          <button type="button" className="af-btn-secondary" onClick={onClose} disabled={submitting || logoutPending}>
            取消
          </button>
          {loginMethod === "cookie" ? (
            <button
              type="button"
              className="af-btn-primary"
              onClick={handleCookieSubmit}
              disabled={submitting || logoutPending || !cookieText.trim()}
            >
              {submitting ? "验证中..." : "保存并验证"}
            </button>
          ) : (
            <button
              type="button"
              className="af-btn-primary"
              onClick={refreshQrLogin}
              disabled={submitting || logoutPending || qrLoading}
            >
              {qrLoading ? "生成中..." : "重新扫码"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
