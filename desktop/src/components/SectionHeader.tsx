import { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  action?: {
    label: string;
    onClick: () => void;
  } | ReactNode;
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <div className="af-section-header">
      <h2 className="af-section-title">{title}</h2>
      {action && (
        <>
          {typeof action === 'object' && 'label' in action ? (
            <button type="button" className="af-section-action" onClick={action.onClick}>
              {action.label}
            </button>
          ) : (
            action
          )}
        </>
      )}
    </div>
  );
}
