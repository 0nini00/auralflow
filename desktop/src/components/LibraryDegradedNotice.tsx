import { useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import {
  LIBRARY_NAMESPACE_LABELS,
  getDegradedLibraryNamespaces,
  subscribeDegradedLibraryNamespaces,
} from "@/stores/libraryPersistence";

/**
 * 本地数据读盘失败时的可见告警。
 *
 * 读不出来时我们选择「拒绝写盘」而不是用内存里的空数据覆盖磁盘
 * （见 libraryPersistence 的 loadFailed 守卫），但这样一来用户只会看到
 * 收藏/歌单凭空变空。这里把原因与后续动作说清楚。
 */
export function LibraryDegradedNotice() {
  const namespaces = useSyncExternalStore(
    subscribeDegradedLibraryNamespaces,
    getDegradedLibraryNamespaces,
    getDegradedLibraryNamespaces,
  );

  if (namespaces.length === 0) return null;

  const labels = namespaces.map((namespace) => LIBRARY_NAMESPACE_LABELS[namespace] ?? namespace);

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        maxWidth: "min(680px, calc(100vw - 48px))",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid var(--af-error, #e74c3c)",
        background: "var(--af-bg-elevated, #1f1f1f)",
        color: "var(--af-text-primary, #f5f5f5)",
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle
        size={16}
        style={{ flexShrink: 0, marginTop: 2, color: "var(--af-error, #e74c3c)" }}
      />
      <div>
        <strong>本地数据读取失败，本次已暂停写入：{labels.join("、")}</strong>
        <div style={{ color: "var(--af-text-secondary, #b3b3b3)", marginTop: 2 }}>
          为避免用空数据覆盖磁盘上的内容，这些数据在本次会话中的修改不会保存。
          数据文件位于应用数据目录的 <code>library/</code> 下：处理掉损坏的 JSON
          （或改名备份）后重启应用即可恢复。
        </div>
      </div>
    </div>
  );
}
