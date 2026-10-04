import { ArrowDown, ArrowUp, Bell, BellOff, ExternalLink, FlaskConical, RefreshCw, Trash2 } from "lucide-react";
import type { SourcesSettingsModel } from "../useSettingsViewModel";
import { openCustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";

export function SourcesSettingsSection({ model }: { model: SourcesSettingsModel }) {
  const {
    featureEnabled,
    featureReady,
    customSourceFeaturePending,
    customSourceFeatureError,
    handleCustomSourceFeatureChange,
    customScriptText,
    setCustomScriptText,
    customSourceStatus,
    customSourceAutoCheck,
    customSources,
    removeSource,
    toggleSource,
    moveSource,
    testSource,
    checkSourceUpdate,
    checkAllUpdates,
    toggleUpdateAlert,
    handleCustomSourceAutoCheckToggle,
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
    <label className="af-settings-checkbox-label" htmlFor="custom-source-feature-enabled">
      <input
        id="custom-source-feature-enabled"
        type="checkbox"
        checked={featureEnabled}
        disabled={!featureReady || customSourceFeaturePending}
        onChange={(event) => { void handleCustomSourceFeatureChange(event.target.checked); }}
        aria-describedby="custom-source-feature-hint"
      />
      启用 LX 自定义音源
    </label>
    <p className="af-settings-hint" id="custom-source-feature-hint">
      关闭后保留已导入的音源和设置；内置音源与本地播放不受影响。
    </p>
    {!featureReady && !customSourceFeatureError && <p className="af-settings-hint" role="status">正在恢复 LX 自定义音源设置...</p>}
    {customSourceFeaturePending && <p className="af-settings-hint" role="status">正在保存 LX 自定义音源开关...</p>}
    {customSourceFeatureError && <p className="af-settings-hint" role="alert">{customSourceFeatureError}</p>}
  </div>

  {featureReady && featureEnabled && (
    <>
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
    </>
  )}
</section>
  );
}
