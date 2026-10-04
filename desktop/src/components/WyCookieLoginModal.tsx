import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, LogOut, RefreshCw, X } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { patchSettings } from "@lx/tauri-bridge";
import {
  checkWyQrLogin,
  createWyQrLoginImage,
  getWyCookie,
  setWyCookie,
  type WyQrLoginImage,
} from "@/services/wyAccountService";
import { useWyAccountStore } from "@/stores/wyAccountStore";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface WyCookieLoginModalProps {
  open: boolean;
  onClose: () => void;
}

type LoginMethod = "qr" | "cookie";

// 只协调本弹窗发起的账号事务，不缓存设置；跨实例也必须等验证/回滚结束。
let accountMutationQueue: Promise<unknown> = Promise.resolve();
function enqueueAccountMutation<T>(mutate: () => Promise<T>): Promise<T> {
  // 前一事务的错误仍交给其调用方处理，失败不会阻断后续独立事务。
  const operation = accountMutationQueue.then(mutate, mutate);
  accountMutationQueue = operation;
  return operation;
}

export function WyCookieLoginModal({ open, onClose }: WyCookieLoginModalProps) {
  const loadAccount = useWyAccountStore((s) => s.load);
  const logoutAccount = useWyAccountStore((s) => s.logout);
  const account = useWyAccountStore((s) => s.account);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const committingRef = useRef(false);
  const [committing, setCommitting] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestGenRef = useRef(0);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  openRef.current = open;
  onCloseRef.current = onClose;
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
  const busy = submitting || logoutPending || committing;

  const stopQrPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 停止轮询不等于取消验证；只有离开当前会话/登录方式才使后续结果失效。
  const invalidateRequests = useCallback(() => {
    stopQrPolling();
    requestGenRef.current += 1;
    return requestGenRef.current;
  }, [stopQrPolling]);
  const isCurrentRequest = useCallback((gen: number) => (
    openRef.current && gen === requestGenRef.current
  ), []);

  const handleClose = useCallback(() => {
    if (committingRef.current) return;
    invalidateRequests();
    setSubmitting(false);
    setLogoutPending(false);
    onCloseRef.current();
  }, [invalidateRequests]);

  useDialogFocus({
    open,
    containerRef: dialogRef,
    onClose: handleClose,
    closeOnEscape: !busy,
  });

  const persistLoginCookie = useCallback(async (rawCookie: string, gen: number) => {
    const completed = await enqueueAccountMutation(async () => {
      if (!isCurrentRequest(gen)) return false;
      const previousCookie = await getWyCookie();
      if (!isCurrentRequest(gen)) return false;
      const { account, playlists, isLoaded, error } = useWyAccountStore.getState();
      const previousAccountState = { account, playlists, isLoaded, error, isLoading: false };

      committingRef.current = true;
      setCommitting(true);
      try {
        // 从第一次修改 Cookie 起，不可再因视图失效而丢弃事务；卸载也要收敛。
        const normalized = setWyCookie(rawCookie);
        await patchSettings({ wyCookie: normalized });
        await loadAccount(normalized);
        const latest = useWyAccountStore.getState();
        if (!latest.account) throw new Error(latest.error || "网易云账号验证失败");
        return true;
      } catch (err) {
        setWyCookie(previousCookie);
        useWyAccountStore.setState(previousAccountState);
        const message = err instanceof Error ? err.message : String(err);
        try {
          await patchSettings({ wyCookie: previousCookie || null });
        } catch (rollbackError) {
          const failure = new Error(message + "；恢复原登录配置失败：" + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)));
          if (!isCurrentRequest(gen)) console.error("离开登录弹窗后账号回滚失败", failure);
          throw failure;
        }
        throw new Error(message);
      } finally {
        committingRef.current = false;
        if (mountedRef.current) setCommitting(false);
      }
    });
    if (completed && isCurrentRequest(gen)) handleClose();
  }, [handleClose, isCurrentRequest, loadAccount]);

  const startQrPolling = useCallback((key: string, gen: number) => {
    stopQrPolling();
    setQrExpired(false);
    let pending = false;
    const poll = async () => {
      if (!isCurrentRequest(gen) || pending) return;
      pending = true;
      try {
        const status = await checkWyQrLogin(key);
        if (!isCurrentRequest(gen)) return;
        setQrStatus(status.message);
        if (status.code === 800) {
          stopQrPolling();
          setQrExpired(true);
          setQrStatus("二维码已过期，请刷新后重新扫码");
          return;
        }
        if (status.code === 801 || status.code === 802) return;
        stopQrPolling();
        if (status.code !== 803) {
          setQrError(status.message);
          return;
        }
        if (!status.cookie) {
          setQrError("扫码成功但网易云未返回 Cookie，请刷新二维码重试");
          return;
        }
        setSubmitting(true);
        setQrError("");
        await persistLoginCookie(status.cookie, gen);
      } catch (err) {
        if (!isCurrentRequest(gen)) return;
        stopQrPolling();
        setQrError(err instanceof Error ? err.message : String(err));
      } finally {
        pending = false;
        if (isCurrentRequest(gen)) setSubmitting(false);
      }
    };
    pollTimerRef.current = setInterval(poll, 1800);
    void poll();
  }, [isCurrentRequest, persistLoginCookie, stopQrPolling]);

  const refreshQrLogin = useCallback(async () => {
    const gen = invalidateRequests();
    setQrLoading(true);
    setSubmitting(false);
    setQrError("");
    setQrExpired(false);
    setQrStatus("正在生成二维码...");
    setQrLogin(null);
    try {
      const nextQrLogin = await createWyQrLoginImage();
      if (!isCurrentRequest(gen)) return;
      setQrLogin(nextQrLogin);
      setQrStatus("请用网易云音乐 App 扫码（微信无法扫此码）");
      startQrPolling(nextQrLogin.key, gen);
    } catch (err) {
      if (isCurrentRequest(gen)) setQrError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrentRequest(gen)) setQrLoading(false);
    }
  }, [invalidateRequests, isCurrentRequest, startQrPolling]);

  useEffect(() => {
    mountedRef.current = true;
    setSubmitting(false);
    setLogoutPending(false);
    setQrLoading(false);
    if (open) {
      setLoginMethod("qr");
      setCookieText("");
      setError("");
      setQrError("");
      setQrStatus("");
      setQrExpired(false);
      setAccountError("");
      setQrLogin(null);
      void refreshQrLogin();
    } else {
      invalidateRequests();
    }
    return () => { mountedRef.current = false; invalidateRequests(); };
  }, [invalidateRequests, open, refreshQrLogin]);

  if (!open) return null;

  const handleCookieSubmit = async () => {
    if (committingRef.current) return;
    const raw = cookieText.trim();
    if (!raw) {
      setError("请先粘贴网易云 Cookie");
      return;
    }
    const gen = requestGenRef.current;
    setSubmitting(true);
    setError("");
    try {
      await persistLoginCookie(raw, gen);
    } catch (err) {
      if (isCurrentRequest(gen)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrentRequest(gen)) setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (committingRef.current) return;
    const gen = invalidateRequests();
    setQrLoading(false);
    setLogoutPending(true);
    setError("");
    setQrError("");
    setAccountError("");
    try {
      const completed = await enqueueAccountMutation(async () => {
        if (!isCurrentRequest(gen)) return false;
        committingRef.current = true;
        setCommitting(true);
        try {
          await logoutAccount();
          return true;
        } finally {
          committingRef.current = false;
          if (mountedRef.current) setCommitting(false);
        }
      });
      if (completed && isCurrentRequest(gen)) handleClose();
    } catch (err) {
      if (isCurrentRequest(gen)) setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrentRequest(gen)) setLogoutPending(false);
    }
  };

  const openNeteaseWebLogin = () => {
    const gen = requestGenRef.current;
    void openUrl("https://music.163.com").catch(() => {
      if (isCurrentRequest(gen)) setError("无法打开浏览器，请手动访问 music.163.com");
    });
  };

  const switchLoginMethod = (method: LoginMethod) => {
    if (committingRef.current || method === loginMethod) return;
    const gen = invalidateRequests();
    setLoginMethod(method);
    setSubmitting(false);
    setLogoutPending(false);
    setQrLoading(false);
    setError("");
    setQrError("");
    if (method === "qr") {
      if (qrLogin && !qrExpired) startQrPolling(qrLogin.key, gen);
      else void refreshQrLogin();
    }
  };

  const handleRefreshQrLogin = () => {
    if (!committingRef.current) void refreshQrLogin();
  };

  return createPortal(
    <div className="af-dialog-overlay" onClick={handleClose}>
      <div
        ref={dialogRef}
        className="af-dialog af-cookie-login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-cookie-login-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="af-cookie-login-header">
          <div>
            <h2 id="af-cookie-login-title">登录网易云账号</h2>
          </div>
          <button type="button" className="af-menu-trigger" onClick={handleClose} disabled={committing} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="af-dialog-body">
          <div className="af-login-method-tabs" role="tablist" aria-label="网易云登录方式">
            <button
              type="button"
              className={`af-login-method-tab ${loginMethod === "qr" ? "af-active" : ""}`}
              onClick={() => switchLoginMethod("qr")}
              disabled={committing}
              role="tab"
              aria-selected={loginMethod === "qr"}
            >
              扫码登录
            </button>
            <button
              type="button"
              className={`af-login-method-tab ${loginMethod === "cookie" ? "af-active" : ""}`}
              onClick={() => switchLoginMethod("cookie")}
              disabled={committing}
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
                <p>{qrStatus || "请用网易云音乐 App 扫码（微信无法扫此码）"}</p>
                <p className="af-settings-hint" style={{ marginTop: 6 }}>
                  微信绑定用户请切到「Cookie」：网页微信扫码登录后粘贴 Cookie。
                </p>
                <button
                  type="button"
                  className="af-settings-small-button"
                  onClick={handleRefreshQrLogin}
                  disabled={qrLoading || busy}
                >
                  <RefreshCw size={14} />
                  刷新二维码
                </button>
              </div>
              {qrError && <p role="alert" className="af-settings-error">{qrError}</p>}
            </div>
          ) : (
            <div role="tabpanel">
              <p className="af-settings-hint" style={{ marginBottom: 10 }}>
                若你平时用微信登录网页版网易云：先打开网易云网页版并用微信扫码登录，
                再从开发者工具 Network 请求里复制完整 Cookie（至少含 MUSIC_U），粘贴到下方。
                本应用的「扫码登录」只能用网易云 App，不支持微信/支付宝扫码。
              </p>
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="af-settings-small-button"
                  onClick={openNeteaseWebLogin}
                  disabled={busy}
                >
                  <ExternalLink size={14} />
                  打开网易云网页版
                </button>
              </div>
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
              {error && <p role="alert" className="af-settings-error">{error}</p>}
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
          {accountError && <p role="alert" className="af-settings-error">{accountError}</p>}
        </div>

        <div className="af-dialog-actions">
          {account && (
            <button
              type="button"
              className="af-btn-secondary af-settings-danger-button"
              onClick={handleLogout}
              disabled={busy}
            >
              <LogOut size={16} />
              <span>{logoutPending ? "退出中..." : "退出登录"}</span>
            </button>
          )}
          <button type="button" className="af-btn-secondary" onClick={handleClose} disabled={busy}>
            取消
          </button>
          {loginMethod === "cookie" ? (
            <button
              type="button"
              className="af-btn-primary"
              onClick={handleCookieSubmit}
              disabled={busy || !cookieText.trim()}
            >
              {submitting ? "验证中..." : "保存并验证"}
            </button>
          ) : (
            <button
              type="button"
              className="af-btn-primary"
              onClick={handleRefreshQrLogin}
              disabled={busy || qrLoading}
            >
              {qrLoading ? "生成中..." : "重新扫码"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
