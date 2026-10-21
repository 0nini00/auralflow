import { useId, type ReactNode } from "react";

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div
      className="af-setting-row"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
    >
      <div className="af-setting-row-main">
        <span id={labelId} className="af-setting-row-label">{label}</span>
        {hint && <span id={hintId} className="af-setting-row-hint">{hint}</span>}
      </div>
      <div className="af-setting-row-control">{children}</div>
    </div>
  );
}
