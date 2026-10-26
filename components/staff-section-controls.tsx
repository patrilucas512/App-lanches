"use client";

type StaffSectionControlsProps = {
  activeCount: number;
  totalCount: number;
  open: boolean;
  onToggle: () => void;
  label: string;
};

export function StaffSectionControls({
  activeCount,
  totalCount,
  open,
  onToggle,
  label,
}: StaffSectionControlsProps) {
  return <div className="staff-section-controls">
    <div className="staff-active-counter" aria-label={`${activeCount} funcionários ativos de ${totalCount} cadastrados`}>
      <strong>{activeCount}</strong>
      <span>ativos<small>{totalCount} cadastrados</small></span>
    </div>
    <button
      type="button"
      className={`staff-registration-toggle ${open ? "open" : ""}`}
      aria-expanded={open}
      aria-label={open ? `Fechar cadastro de ${label}` : `Abrir cadastro de ${label}`}
      title={open ? "Fechar cadastro" : `Cadastrar ${label}`}
      onClick={onToggle}
    >
      <span aria-hidden="true">＋</span>
      <b>{open ? "Fechar cadastro" : `Cadastrar ${label}`}</b>
    </button>
  </div>;
}
