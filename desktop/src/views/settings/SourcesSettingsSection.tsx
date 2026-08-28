import { ArrowDown, ArrowUp, Bell, BellOff, ExternalLink, FlaskConical, RefreshCw, Trash2 } from "lucide-react";
import type { SourcesSettingsModel } from "../useSettingsViewModel";
import { openCustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";

export function SourcesSettingsSection({ model }: { model: SourcesSettingsModel }) {
  const {
    customScriptText,
    setCustomScriptText,
    customSourceStatus,
    customSourceAutoCheck,
    biliCookieText,
    setBiliCookieText,
    biliCookieStatus,
    biliCookiePending,
    biliRefreshTokenText,
    setBiliRefreshTokenText,
    biliRefreshTokenStatus,
    handleSaveBiliRefreshToken,
    customSources,
    removeSource,
    toggleSource,
    moveSource,
    testSource,
    checkSourceUpdate,
    checkAllUpdates,
    toggleUpdateAlert,
    biliAccount,
    handleCustomSourceAutoCheckToggle,
    openBilibiliWeb,
    handleSaveBiliCookie,
    handleClearBiliCookie,
    handleImportCustomSourceFile,
    handleImportCustomSourceText,
    getUpdateStatusMessage,
    getTestStatusMessage,
    getVersionLabel,
    getCapabilityTitle,
  } = model;

  return (
<section className="af-settings-section" id="sources">
  <h2 className="af-settings-section-title">音源</h2>
  <div className="af-settings-group">
    <label className="af-settings-label">B站账号（收藏合集）</label>
    <p className="af-settings-hint" style={{ marginBottom: 10 }}>
      浏览器打开 bilibili.com 并登录后，从开发者工具 Network 请求里复制完整 Cookie
      （至少含 SESSDATA；建议同时含 DedeUserID、bili_jct、buvid3）。
    </p>
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        className="af-settings-small-button"
        onClick={openBilibiliWeb}
        disabled={biliCookiePending}
      >
        <ExternalLink size={14} />
        打开 B站网页版
      </button>
    </div>
    <textarea
      className="af-settings-textarea af-custom-source-textarea"
      value={biliCookieText}
      onChange={(event) => setBiliCookieText(event.target.value)}
      placeholder="SESSDATA=...; DedeUserID=...; bili_jct=...; buvid3=..."
      spellCheck={false}
    />
    <div className="af-custom-source-toolbar">
      <button
        type="button"
        className="af-settings-small-button"
        onClick={() => { void handleSaveBiliCookie(); }}
        disabled={biliCookiePending || !biliCookieText.trim()}
      >
        保存并验证 B站 Cookie
      </button>
      <button
        type="button"
        className="af-settings-small-button af-settings-danger-button"
        onClick={() => { void handleClearBiliCookie(); }}
        disabled={biliCookiePending}
      >
        退出 B站
      </button>
    </div>
    {biliAccount && (
      <p className="af-settings-hint">当前 B站账号：{biliAccount.nickname}</p>
    )}
    {biliCookieStatus && <p className="af-settings-hint">{biliCookieStatus}</p>}
    <details style={{ marginTop: 10 }}>
      <summary className="af-settings-hint" style={{ cursor: "pointer", userSelect: "none" }}>
        Cookie 自动续期（可选，减少过期频率）
      </summary>
      <p className="af-settings-hint" style={{ marginTop: 8 }}>
        填入浏览器 localStorage 里的 <code>ac_time_value</code>（即 refresh_token），
        应用会在 Cookie 临近过期时自动续期，有效期可延长至约 6 个月。
        获取方式：在 bilibili.com 页面打开控制台执行 <code>localStorage.getItem("ac_time_value")</code>。
      </p>
      <textarea
        className="af-settings-textarea af-custom-source-textarea"
        value={biliRefreshTokenText}
        onChange={(event) => setBiliRefreshTokenText(event.target.value)}
        placeholder="粘贴 ac_time_value / refresh_token..."
        spellCheck={false}
        style={{ marginTop: 6 }}
      />
      <div className="af-custom-source-toolbar">
        <button
          type="button"
          className="af-settings-small-button"
          onClick={() => { void handleSaveBiliRefreshToken(); }}
        >
          保存 refresh_token
        </button>
      </div>
      {biliRefreshTokenStatus && <p className="af-settings-hint">{biliRefreshTokenStatus}</p>}
    </details>
  </div>

  <div className="af-settings-group">
    <label className="af-settings-label">自定义音源</label>
    <div className="af-settings-input-group">
      <button type="button" className="af-settings-button" onClick={handleImportCustomSourceFile}>
        导入 LX 音源文件
      </button>
      <button
        type="button"
        className="af-settings-button af-settings-button-secondary"
        onClick={handleImportCustomSourceText}
      >
        导入粘贴内容
      </button>
    </div>
    {customSources.length > 0 && (
      <div className="af-custom-source-toolbar">
        <button
          type="button"
          className="af-settings-small-button"
          onClick={() => { void checkAllUpdates(); }}
          disabled={customSources.some((source) => source.updateStatus === "checking")}
        >
          <RefreshCw size={14} />
          检查全部更新
        </button>
        <button
          type="button"
          className={`af-settings-small-button af-custom-source-auto-check ${customSourceAutoCheck ? "af-active" : ""}`}
          onClick={handleCustomSourceAutoCheckToggle}
          aria-pressed={customSourceAutoCheck}
          title={customSourceAutoCheck ? "关闭启动自动检测" : "开启启动自动检测"}
        >
          自动检测：{customSourceAutoCheck ? "开" : "关"}
        </button>
      </div>
    )}
    <textarea
      className="af-settings-textarea af-custom-source-textarea"
      value={customScriptText}
      onChange={(e) => setCustomScriptText(e.target.value)}
    />
    {customSourceStatus && <p className="af-settings-hint">{customSourceStatus}</p>}
  </div>

  <div className="af-settings-group">
    {customSources.length === 0 ? (
      <p className="af-settings-hint">尚未导入自定义音源。</p>
    ) : (
      <div className="af-custom-source-list">
        {customSources.map((source, index) => {
          const capabilityCount = Object.keys(source.sources ?? {}).length;
          const updateMessage = getUpdateStatusMessage(source);
          const testMessage = getTestStatusMessage(source);

          return (
            <div className="af-custom-source-card" key={source.id}>
              <div className="af-custom-source-main">
                <label
                  className="af-custom-source-enable"
                  title={source.enabled ? "停用音源" : "启用音源"}
                  aria-label={source.enabled ? "停用音源" : "启用音源"}
                >
                  <input
                    type="checkbox"
                    className="af-settings-checkbox"
                    checked={source.enabled}
                    onChange={(e) => toggleSource(source.id, e.target.checked)}
                  />
                </label>
                <div className="af-custom-source-info">
                  <div className="af-custom-source-title-row">
                    <div className="af-custom-source-name" title={source.name}>{source.name}</div>
                    {source.version && <span className="af-custom-source-chip">{getVersionLabel(source.version)}</span>}
                    {source.author && <span className="af-custom-source-chip" title={source.author}>{source.author}</span>}
                    <span className="af-custom-source-chip" title={getCapabilityTitle(source)}>
                      {capabilityCount > 0 ? `${capabilityCount} 个平台` : "无平台"}
                    </span>
                  </div>
                  <div className="af-custom-source-desc" title={source.description || "无描述"}>
                    {source.description || "无描述"}
                  </div>
                  {(updateMessage || testMessage) && (
                    <details className="af-custom-source-details">
                      <summary>状态详情</summary>
                      <div className="af-custom-source-message-row">
                        {updateMessage && (
                          <span className={`af-custom-source-status af-custom-source-status-${source.updateStatus ?? "idle"}`}>
                            {updateMessage}
                          </span>
                        )}
                        {testMessage && (
                          <span className={`af-custom-source-status af-custom-source-status-${source.testStatus}`}>
                            {testMessage}
                          </span>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </div>
              <div className="af-custom-source-actions">
                <button
                  type="button"
                  className={`af-custom-source-icon-button ${source.allowShowUpdateAlert ? "af-active" : ""}`}
                  onClick={() => toggleUpdateAlert(source.id, !source.allowShowUpdateAlert)}
                  title={source.allowShowUpdateAlert ? "关闭更新提醒" : "开启更新提醒"}
                  aria-label={source.allowShowUpdateAlert ? "关闭更新提醒" : "开启更新提醒"}
                  aria-pressed={source.allowShowUpdateAlert}
                >
                  {source.allowShowUpdateAlert ? <Bell size={14} /> : <BellOff size={14} />}
                </button>
                <button
                  type="button"
                  className="af-custom-source-icon-button"
                  onClick={() => { void checkSourceUpdate(source.id); }}
                  disabled={source.updateStatus === "checking"}
                  title={source.updateStatus === "checking" ? "检测中" : "检查更新"}
                  aria-label={source.updateStatus === "checking" ? "检测中" : "检查更新"}
                >
                  <RefreshCw size={14} />
                </button>
                {source.updateStatus === "available" && (
                  <button
                    type="button"
                    className="af-custom-source-icon-button"
                    onClick={() => openCustomSourceUpdateModal(source.id)}
                    title="查看更新弹窗"
                    aria-label="查看更新弹窗"
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="af-custom-source-icon-button"
                  onClick={() => testSource(source.id)}
                  disabled={source.testStatus === "testing"}
                  title={source.testStatus === "testing" ? "测试中" : "测试音源"}
                  aria-label={source.testStatus === "testing" ? "测试中" : "测试音源"}
                >
                  <FlaskConical size={14} />
                </button>
                <button
                  type="button"
                  className="af-custom-source-icon-button"
                  onClick={() => moveSource(source.id, "up")}
                  disabled={index === 0}
                  title="上移"
                  aria-label="上移"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="af-custom-source-icon-button"
                  onClick={() => moveSource(source.id, "down")}
                  disabled={index === customSources.length - 1}
                  title="下移"
                  aria-label="下移"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="af-custom-source-icon-button af-settings-danger-button"
                  onClick={() => removeSource(source.id)}
                  title="删除"
                  aria-label="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
          </div>
        )}
      </div>
</section>
  );
}
