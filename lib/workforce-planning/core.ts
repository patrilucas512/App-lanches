export type Confidence = "high" | "medium" | "low";
export type Severity = "error" | "warning" | "info";

export const WORKFORCE_PLANNING_PERMISSIONS = [
  "workforce_planning:view", "workforce_planning:create", "workforce_planning:edit",
  "workforce_planning:publish", "workforce_planning:approve", "workforce_planning:view_cost",
  "workforce_planning:manage_rules", "workforce_planning:manage_open_shifts",
  "workforce_planning:approve_swaps", "workforce_planning:view_network",
] as const;

export type DemandInput = {
  bucketStart: string; roleId: string; minStaff?: number; maxStaff?: number | null;
  productivityRatio?: number | null; drivers: Record<string, number>; driverWeights?: Record<string, number>;
  model?: string; version?: string; confidence?: Confidence; generatedAt?: string;
};

export class StaffingDemandService {
  static calculate(input: DemandInput) {
    const ratio = Math.max(.01, Number(input.productivityRatio || 1));
    const contributions = Object.entries(input.drivers).map(([driver, value]) => ({
      driver, value: Math.max(0, Number(value || 0)), weight: Math.max(0, Number(input.driverWeights?.[driver] ?? 1)),
    }));
    const demandUnits = contributions.reduce((sum, x) => sum + x.value * x.weight, 0);
    const raw = Math.ceil(demandUnits / ratio);
    const minimum = Math.max(0, Number(input.minStaff || 0));
    const capped = input.maxStaff == null ? Math.max(minimum, raw) : Math.min(Number(input.maxStaff), Math.max(minimum, raw));
    const confidence = input.confidence || (contributions.length >= 2 ? "medium" : "low");
    return {
      bucketStart: input.bucketStart, roleId: input.roleId, recommendedHeadcount: capped,
      demandLevel: capped > minimum * 1.5 ? "peak" : capped > minimum ? "normal" : "baseline",
      confidence, warning: confidence === "low" ? "Previsão com baixa confiança; revise antes de usar." : null,
      explanation: contributions.map(x => `${x.driver}: ${x.value} × ${x.weight}`).join("; ") || "Cobertura mínima configurada",
      source: { model: input.model || "explainable_ratio", version: input.version || "1", generatedAt: input.generatedAt || new Date().toISOString() },
    };
  }
}

export type PlannedShift = { id?: string; employeeId?: string | null; roleId: string; storeId: string; startAt: string; endAt: string; skillIds?: string[]; source?: string };
export type ValidationContext = {
  existing: PlannedShift[]; availability?: { employeeId: string; startAt: string; endAt: string; type: string }[];
  employeeSkills?: Record<string, string[]>; requiredSkills?: Record<string, { skillId: string; policy: "warn" | "supervisor_override" | "block" }[]>;
  employeeStoreIds?: Record<string, string[]>; employeeRoleIds?: Record<string, string[]>;
  maxHours?: number; minimumRestHours?: number; overrideReason?: string;
};

const overlaps = (a: PlannedShift, b: PlannedShift) => new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
export class ShiftValidationService {
  static validate(shift: PlannedShift, context: ValidationContext) {
    const issues: { code: string; severity: Severity; message: string; overrideAllowed: boolean }[] = [];
    if (new Date(shift.endAt) <= new Date(shift.startAt)) issues.push({ code: "invalid_range", severity: "error", message: "O fim deve ocorrer depois do início.", overrideAllowed: false });
    if (shift.employeeId) {
      const mine = context.existing.filter(x => x.employeeId === shift.employeeId && x.id !== shift.id);
      if (mine.some(x => overlaps(x, shift))) issues.push({ code: "overlap", severity: "error", message: "Há sobreposição com outro turno.", overrideAllowed: false });
      const unavailable = (context.availability || []).some(x => x.employeeId === shift.employeeId && x.type === "unavailable" && overlaps({ ...shift, startAt: x.startAt, endAt: x.endAt }, shift));
      if (unavailable) issues.push({ code: "unavailable", severity: "error", message: "A pessoa informou indisponibilidade nesse período.", overrideAllowed: true });
      if (context.employeeStoreIds?.[shift.employeeId] && !context.employeeStoreIds[shift.employeeId].includes(shift.storeId)) issues.push({ code: "store_eligibility", severity: "error", message: "Pessoa sem autorização para esta unidade.", overrideAllowed: false });
      if (context.employeeRoleIds?.[shift.employeeId] && !context.employeeRoleIds[shift.employeeId].includes(shift.roleId)) issues.push({ code: "role_eligibility", severity: "error", message: "Pessoa não elegível para esta função.", overrideAllowed: false });
      for (const rule of context.requiredSkills?.[shift.roleId] || []) if (!(context.employeeSkills?.[shift.employeeId] || []).includes(rule.skillId)) issues.push({ code: "missing_skill", severity: rule.policy === "block" ? "error" : "warning", message: "Skill exigida ainda não foi comprovada.", overrideAllowed: rule.policy === "supervisor_override" });
      const duration = (new Date(shift.endAt).getTime() - new Date(shift.startAt).getTime()) / 36e5;
      const hours = mine.reduce((sum, x) => sum + Math.max(0, (new Date(x.endAt).getTime() - new Date(x.startAt).getTime()) / 36e5), 0) + duration;
      if (context.maxHours && hours > context.maxHours) issues.push({ code: "configured_hours", severity: "warning", message: `Carga planejada acima do limite organizacional configurado (${context.maxHours}h).`, overrideAllowed: true });
      const nearest = mine.map(x => Math.min(Math.abs(new Date(shift.startAt).getTime() - new Date(x.endAt).getTime()), Math.abs(new Date(x.startAt).getTime() - new Date(shift.endAt).getTime())) / 36e5).sort((a, b) => a - b)[0];
      if (context.minimumRestHours && Number.isFinite(nearest) && nearest < context.minimumRestHours) issues.push({ code: "configured_rest", severity: "warning", message: `Descanso abaixo da regra interna configurada (${context.minimumRestHours}h).`, overrideAllowed: true });
    }
    const blocking = issues.filter(x => x.severity === "error" && !(x.overrideAllowed && context.overrideReason?.trim()));
    return { valid: blocking.length === 0, issues, requiresReason: issues.some(x => x.overrideAllowed) && !context.overrideReason?.trim(), legalDisclaimer: "Validação operacional configurável; não representa conclusão jurídica universal." };
  }
}

export function coverage(required: number, scheduled: number) {
  const gap = scheduled - required;
  return { required, scheduled, gap, status: gap < 0 ? "critical_gap" : gap > 0 ? "covered_above_recommendation" : "covered", label: gap < 0 ? `Faltam ${Math.abs(gap)}` : gap > 0 ? `Cobertura acima da recomendação em ${gap}` : "Cobertura adequada" };
}

type Candidate = { employeeId: string; name: string; available: boolean; roleEligible: boolean; storeEligible: boolean; skills: string[]; plannedHours: number; weekendShifts?: number; closingShifts?: number; individualCost?: number };
export class ScheduleSuggestionService {
  static suggest(candidates: Candidate[], requiredSkillIds: string[], count: number) {
    const eligible = candidates.filter(x => x.available && x.roleEligible && x.storeEligible && requiredSkillIds.every(id => x.skills.includes(id)));
    const fair = [...eligible].sort((a, b) => a.plannedHours - b.plannedHours || (a.weekendShifts || 0) - (b.weekendShifts || 0) || (a.closingShifts || 0) - (b.closingShifts || 0) || a.name.localeCompare(b.name));
    const make = (rows: Candidate[], label: string) => ({ label, employees: rows.slice(0, count).map(x => ({ employeeId: x.employeeId, name: x.name, explanation: `${x.name} está disponível, é elegível para unidade e função${requiredSkillIds.length ? ", possui as skills necessárias" : ""} e tem ${x.plannedHours}h programadas.`, criteria: ["availability", "role", "skills", "planned_workload", "store_eligibility"] })), suggestionOnly: true, canPublish: false, sensitiveAttributesUsed: false });
    return [make(fair, "Sugestão A · distribuição equilibrada"), make([...fair].reverse(), "Sugestão B · alternativa revisável")];
  }
}

export class LaborPlanningService {
  static estimate(shifts: { minutes: number; roleRateCents?: number; individualCostCents?: number }[], canViewIndividualCost: boolean, forecastRevenueCents = 0) {
    const plannedCostCents = Math.round(shifts.reduce((sum, x) => sum + x.minutes / 60 * Number(canViewIndividualCost ? x.individualCostCents ?? x.roleRateCents ?? 0 : x.roleRateCents ?? 0), 0));
    return { plannedCostCents, laborPercent: forecastRevenueCents > 0 ? plannedCostCents / forecastRevenueCents * 100 : null, mode: canViewIndividualCost ? "authorized_detail" : "aggregate_role_rate", individualValuesExposed: false, disclaimer: "Estimativa gerencial baseada em regras internas; não é folha nem cálculo legal de horas extras." };
  }
}

export function compareScenario(base: number[], scenario: number[]) { const b = base.reduce((a, x) => a + x, 0), s = scenario.reduce((a, x) => a + x, 0); return { baseHeadcount: b, scenarioHeadcount: s, difference: s - b, changesPublishedSchedule: false }; }
export function versionSchedule(currentVersion: number, published: boolean) { return { nextVersion: Math.max(1, currentVersion + (published ? 1 : 0)), preservesPublishedSnapshot: published, status: "draft" as const }; }
export function liveCoverage(planned: number, statuses: string[]) { const present = statuses.filter(x => ["checked_in", "on_break"].includes(x)).length; return { planned, present, gap: present - planned, uncertain: statuses.includes("late_by_rule"), note: statuses.includes("late_by_rule") ? "Atraso por regra não confirma ausência." : null }; }
export function canPublish(validation: { valid: boolean; issues: { severity: Severity }[] }, humanConfirmed: boolean) { return { allowed: validation.valid && humanConfirmed, humanConfirmationRequired: true, automaticPublication: false, criticalErrors: validation.issues.filter(x => x.severity === "error").length }; }
export function revalidateCopiedShifts(shifts: PlannedShift[], unavailableEmployees: string[]) { return shifts.map(x => ({ ...x, source: "copied", valid: !x.employeeId || !unavailableEmployees.includes(x.employeeId), needsReview: Boolean(x.employeeId && unavailableEmployees.includes(x.employeeId)) })); }
export function automationActionAllowed(action: string) { return !["auto_assign_employee", "auto_publish_schedule", "discipline_employee", "terminate_employee", "reduce_hours"].includes(action); }
