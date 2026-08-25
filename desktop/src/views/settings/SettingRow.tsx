import type { ReactNode } from "react";

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="af-setting-row">
      <div className="af-setting-row-main">
        <span className="af-setting-row-label">{label}</span>
        {hint && <span className="af-setting-row-hint">{hint}</span>}
      </div>
      <div className="af-setting-row-control">{children}</div>
    </div>
  );
}
