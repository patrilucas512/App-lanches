"use client";

import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
} from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "small" | "medium" | "large";

export function AdminButton({
  className,
  variant = "primary",
  size = "medium",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={cx("admin-button", `admin-button-${variant}`, `admin-button-${size}`, className)} {...props} />;
}

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export function AdminField({ label, hint, error, required, children, className }: FieldProps) {
  return <label className={cx("admin-field", error && "admin-field-error", className)}>
    <span className="admin-field-label">{label}{required && <b aria-hidden="true"> *</b>}</span>
    {children}
    {error ? <small className="admin-field-message" role="alert">{error}</small> : hint ? <small className="admin-field-hint">{hint}</small> : null}
  </label>;
}

export function AdminInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("admin-input", className)} {...props} />;
}

export function AdminTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("admin-input", "admin-textarea", className)} {...props} />;
}

export function AdminSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("admin-input", "admin-select", className)} {...props}>{children}</select>;
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function AdminBadge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx("admin-badge", `admin-badge-${tone}`, className)} {...props} />;
}

export function AdminCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={cx("admin-card", className)} {...props} />;
}

export function AdminSwitch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className="admin-switch"
    onClick={() => onCheckedChange(!checked)}
  ><span /></button>;
}

export function AdminModal({
  open,
  title,
  eyebrow,
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  return <div className="admin-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
      <header className="admin-modal-head">
        <div>{eyebrow && <small>{eyebrow}</small>}<h2 id="admin-modal-title">{title}</h2></div>
        <button type="button" className="admin-modal-close" aria-label="Fechar" onClick={onClose}>×</button>
      </header>
      <div className="admin-modal-body">{children}</div>
      {footer && <footer className="admin-modal-footer">{footer}</footer>}
    </section>
  </div>;
}

export function AdminEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="admin-empty-state"><span aria-hidden="true">＋</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function AdminSkeleton({ lines = 3 }: { lines?: number }) {
  return <div className="admin-skeleton" aria-label="Carregando">{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>;
}
