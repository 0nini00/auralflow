import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bell, BellOff, ExternalLink, FlaskConical, GripVertical, RefreshCw, Trash2 } from "lucide-react";
import type { SourcesSettingsModel } from "../useSettingsViewModel";
import { openCustomSourceUpdateModal } from "@/components/CustomSourceUpdateModal";
import { SettingRow } from "./SettingRow";
import { resolveDropSlot } from "@/utils/listReorder";

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

  // ── 拖动排序 ──
  // 按下卡片后由 window 级监听接管指针：列表本身保持不动，只按指针纵坐标算出插入槽位，
  // 松手时才真正改顺序，避免拖动过程中卡片反复重排带来的抖动。
  const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  // 监听器只注册一次，通过 ref 读取最新的音源列表与动作，避免闭包拿到旧数据
  const dragRef = useRef({ sources: customSources, moveSource, draggingId });
  useEffect(() => {
    dragRef.current = { sources: customSources, moveSource, draggingId };
  });

  // 槽位按「去掉被拖动项之后」的卡片位置计算，与 store 的 remove→insert 语义一致
  const resolveSlotAt = (clientY: number): number => {
    const { sources, draggingId: activeId } = dragRef.current;
    const anchors = sources
      .filter((source) => source.id !== activeId)
      .map((source) => cardRefs.current.get(source.id))
      .filter((element): element is HTMLDivElement => Boolean(element?.getBoundingClientRect))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });
    return resolveDropSlot(anchors, clientY);
  };

  useEffect(() => {
    if (!draggingId) return;
    const handlePointerMove = (event: PointerEvent) => {
      setDropSlot(resolveSlotAt(event.clientY));
    };
    const finishDrag = (clientY: number | null) => {
      const { draggingId: activeId, sources, moveSource: move } = dragRef.current;
      if (activeId && clientY !== null) {
        const slot = resolveSlotAt(clientY);
        // 原位松手（例如只是在卡片上点了一下）不写库，避免无意义的落盘
        if (slot !== sources.findIndex((source) => source.id === activeId)) {
          move(activeId, slot);
        }
      }
      setDraggingId(null);
      setDropSlot(null);
    };
    const handlePointerUp = (event: PointerEvent) => finishDrag(event.clientY);
    const handleCancel = () => finishDrag(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
    };
  }, [draggingId]);

  const handleCardPointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // 卡片内的开关、按钮和「状态详情」保留原有点击行为，不触发拖动
    if (target?.closest("button, input, label, summary, a, textarea, select")) return;
    // 阻止文字选中与原生拖拽，拖动全程由指针事件驱动
    event.preventDefault();
    dragRef.current = { ...dragRef.current, draggingId: id };
    setDraggingId(id);
    setDropSlot(null);
  };

  // 无鼠标场景保留排序能力：手柄获得焦点后用上下方向键逐格移动
  const handleDragKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = customSources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const nextIndex = index + step;
    // 已经在首/末位时不再向外移动，避免产生空写入
    if (nextIndex < 0 || nextIndex >= customSources.length) return;
    moveSource(id, nextIndex);
  };

  const remainingIds = draggingId
    ? customSources.filter((source) => source.id !== draggingId).map((source) => source.id)
    : [];

  return (
<section
  className={`af-settings-section af-custom-source-section${draggingId ? " af-dragging-active" : ""}`}
  id="sources"
>
  <h2 className="af-settings-section-title">音源</h2>

  <div className="af-settings-card">
    <SettingRow
      label="启用 LX 自定义音源"
      hint="关闭后保留已导入的音源和设置；内置音源与本地播放不受影响。"
    >
      <input
        id="custom-source-feature-enabled"
        type="checkbox"
        className="af-switch"
        role="switch"
        aria-label="启用 LX 自定义音源"
        checked={featureEnabled}
        disabled={!featureReady || customSourceFeaturePending}
        onChange={(event) => { void handleCustomSourceFeatureChange(event.target.checked); }}
      />
    </SettingRow>
  </div>
  <p className="af-settings-warning" role="note">
    自定义音源脚本会在应用内执行，拥有与本应用相同的权限；只导入你信任的来源。
    脚本也会随 WebDAV 同步以明文上传。
  </p>
  {!featureReady && !customSourceFeatureError && <p className="af-settings-hint" role="status">正在恢复 LX 自定义音源设置...</p>}
  {customSourceFeaturePending && <p className="af-settings-hint" role="status">正在保存 LX 自定义音源开关...</p>}
  {customSourceFeatureError && <p className="af-settings-hint" role="alert">{customSourceFeatureError}</p>}

  {featureReady && featureEnabled && (
    <>
  <div className="af-settings-group">
    <span className="af-settings-label">自定义音源</span>
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
      </div>
    )}
    <label className="af-settings-label" htmlFor="custom-source-script-input">粘贴脚本</label>
    <textarea
      id="custom-source-script-input"
      className="af-settings-textarea af-custom-source-textarea"
      aria-label="粘贴 LX 自定义音源脚本"
      placeholder="在此粘贴 LX Music 自定义音源脚本，或使用上方按钮导入文件"
      value={customScriptText}
      onChange={(e) => setCustomScriptText(e.target.value)}
    />
    {customSourceStatus && <p className="af-settings-hint">{customSourceStatus}</p>}
  </div>

  <div className="af-settings-card">
    <SettingRow label="自动检测音源更新" hint="启动后自动检查已导入音源的远端脚本版本">
      <input
        type="checkbox"
        className="af-switch"
        role="switch"
        aria-label="自动检测音源更新"
        checked={customSourceAutoCheck}
        onChange={() => handleCustomSourceAutoCheckToggle()}
      />
    </SettingRow>
  </div>

  <div className="af-settings-group">
    {customSources.length === 0 ? (
      <p className="af-settings-hint">尚未导入自定义音源。</p>
    ) : (
      <>
        {customSources.length > 1 && (
          <p className="af-settings-hint">按住音源卡片上下拖动即可调整顺序，排在前面的音源会优先参与取链。</p>
        )}
        <div className="af-custom-source-list">
          {customSources.map((source) => {
            const capabilityCount = Object.keys(source.sources ?? {}).length;
            const updateMessage = getUpdateStatusMessage(source);
            const testMessage = getTestStatusMessage(source);
            const isDragging = draggingId === source.id;
            const remainingIndex = remainingIds.indexOf(source.id);
            const dropClass = isDragging || dropSlot === null || remainingIndex < 0
              ? ""
              : dropSlot === remainingIndex
                ? " af-drop-before"
                : dropSlot === remainingIds.length && remainingIndex === remainingIds.length - 1
                  ? " af-drop-after"
                  : "";

            return (
              <div
                className={`af-custom-source-card${isDragging ? " af-dragging" : ""}${dropClass}`}
                key={source.id}
                ref={(element) => { cardRefs.current.set(source.id, element); }}
                onPointerDown={(event) => handleCardPointerDown(event, source.id)}
              >
                <div className="af-custom-source-main">
                  <span
                    className="af-custom-source-drag-handle"
                    role="button"
                    tabIndex={0}
                    title="按住拖动可调整音源顺序"
                    aria-label={`调整「${source.name}」的顺序：按住拖动，或用上下方向键移动`}
                    onKeyDown={(event) => handleDragKeyDown(event, source.id)}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </span>
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
                      onClick={() => openCustomSourceUpdateModal(source.id, { manual: true })}
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
      </>
    )}
  </div>
    </>
  )}
</section>
  );
}
