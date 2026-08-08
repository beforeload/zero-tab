import type { ReactNode } from 'react';
import { ChevronIcon, CloseIcon } from './Icons';

type Props = {
  title: string;
  count?: string;
  collapsed: boolean;
  required?: boolean;
  onToggle(): void;
  onHide?(): void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CardFrame({
  title,
  count,
  collapsed,
  required,
  onToggle,
  onHide,
  actions,
  children,
  className = '',
}: Props) {
  return (
    <section className={`workstation-card ${className}`.trim()}>
      <div className="workstation-card-header">
        <div className="workstation-card-heading">
          <h2>{title}</h2>
          {count && <span className="section-count">{count}</span>}
        </div>
        <div className="workstation-card-actions">
          {actions}
          <button
            className="toolbar-button"
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            <ChevronIcon className={collapsed ? '' : 'is-open'} />
          </button>
          {!required && onHide && (
            <button
              className="toolbar-button"
              type="button"
              onClick={onHide}
              aria-label={`Hide ${title}`}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="workstation-card-body">{children}</div>}
    </section>
  );
}
