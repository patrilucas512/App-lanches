/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canStartAttempt, gradeAssessment, lessonCompletion, tutorGuard, validateAiDraft, validateCourseForPublish, validateExemption } from "@/lib/learning/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN = new Set(["owner", "admin", "supervisor", "manager"]);
const R = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });

async function auth(storeId: string) {
  if (!UUID.test(storeId)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = String(data?.claims?.sub || "");
  if (!userId) throw new Error("AUTH");
  const { data: store } = await supabase.from("establishments").select("id,organization_id,name").eq("id", storeId).maybeSingle();
  if (!store) throw new Error("FORBIDDEN");
  const [{ data: local }, { data: org }] = await Promise.all([
    supabase.from("establishment_members").select("role").eq("establishment_id", storeId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    supabase.from("organization_members").select("role,all_stores").eq("organization_id", store.organization_id).eq("user_id", userId).eq("active", true).maybeSingle(),
  ]);
  if (!local && !org) throw new Error("FORBIDDEN");
  const role = String(org?.role || local?.role || "member"), a = createAdminClient();
  const { data: employee } = await a.from("custom_staff_members").select("id,name,primary_store_id,establishment_id,status,role_id").eq("organization_id", store.organization_id).eq("user_id", userId).eq("status", "active").maybeSingle();
  return { a, userId, storeId, organizationId: store.organization_id, role, admin: ADMIN.has(role), employee };
}

async function audit(c: any, action: string, entityType: string, entityId?: string | null, reason?: string, after?: any) {
  await c.a.from("learning_audit_events").insert({ organization_id: c.organizationId, actor_user_id: c.userId, employee_id: c.employee?.id || null, entity_type: entityType, entity_id: entityId || null, action, reason: reason || null, after_state: after || null });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url), c = await auth(String(u.searchParams.get("store_id") || "")), adminView = u.searchParams.get("view") === "admin" && c.admin;
    let enrollments: any[] = [];
    if (c.employee) {
      const { data } = await c.a.from("learning_enrollments").select("*,learning_courses(id,title,summary,thumbnail_url,estimated_minutes),learning_course_versions(version),learning_internal_certifications(id,title,issued_at,expires_at,revoked_at)").eq("organization_id", c.organizationId).eq("employee_id", c.employee.id).order("assigned_at", { ascending: false });
      enrollments = data || [];
    }
    if (!adminView) return R({ mode: "my_learning", employee: c.employee, enrollments, summary: { assigned: enrollments.length, inProgress: enrollments.filter(x => x.status === "in_progress").length, completed: enrollments.filter(x => x.status === "completed").length, overdue: enrollments.filter(x => x.due_at && new Date(x.due_at) < new Date() && !["completed", "exempted", "cancelled"].includes(x.status)).length } });
    const [courses, paths, requirements, allEnrollments, employees, certifications, policies] = await Promise.all([
      c.a.from("learning_courses").select("*,learning_course_versions(id,version,status,published_at,learning_modules(id,title,position,learning_lessons(id,title,position,lesson_type)))").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }),
      c.a.from("learning_paths").select("*,learning_path_items(*)").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }),
      c.a.from("learning_requirements").select("*").eq("organization_id", c.organizationId).eq("active", true),
      c.a.from("learning_enrollments").select("*").eq("organization_id", c.organizationId).order("assigned_at", { ascending: false }).limit(1000),
      c.a.from("custom_staff_members").select("id,name,status,primary_store_id,establishment_id,role_id,user_id").eq("organization_id", c.organizationId).eq("status", "active").order("name"),
      c.a.from("learning_internal_certifications").select("*").eq("organization_id", c.organizationId).order("issued_at", { ascending: false }).limit(500),
      c.a.from("learning_policies").select("*").eq("organization_id", c.organizationId).eq("active", true),
    ]);
    const rows = allEnrollments.data || [], completed = rows.filter(x => x.status === "completed").length, overdue = rows.filter(x => x.due_at && new Date(x.due_at) < new Date() && !["completed", "exempted", "cancelled"].includes(x.status)).length;
    return R({ mode: "admin", courses: courses.data || [], paths: paths.data || [], requirements: requirements.data || [], enrollments: rows, employees: employees.data || [], certifications: certifications.data || [], policies: policies.data || [], summary: { activeCourses: (courses.data || []).filter(x => x.status === "published").length, assigned: rows.length, completed, overdue, completionRate: rows.length ? Math.round(completed / rows.length * 100) : 0 }, permissions: { manage: true, publish: true, assign: true, validatePractical: true } });
  } catch (error: any) { const message = error?.message || "Falha"; return R({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500); }
}

export async function POST(req: Request) {
  try {
    const b = await req.json(), c = await auth(String(b.store_id || "")), action = String(b.action || "");
    if (action === "create_course") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const slug = String(b.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
      const { data: course, error } = await c.a.from("learning_courses").insert({ organization_id: c.organizationId, title: String(b.title || "").slice(0, 160), slug: `${slug}-${Date.now().toString(36)}`, summary: String(b.summary || "").slice(0, 500), category: b.category || "operational", difficulty: b.difficulty || "basic", created_by: c.userId }).select().single();
      if (error) throw error;
      const contentHash = createHash("sha256").update(JSON.stringify({ title: course.title, at: Date.now() })).digest("hex");
      const { data: version, error: versionError } = await c.a.from("learning_course_versions").insert({ course_id: course.id, organization_id: c.organizationId, version: 1, title: course.title, summary: course.summary, content_hash: contentHash, created_by: c.userId }).select().single();
      if (versionError) throw versionError;
      await audit(c, "created", "course", course.id);
      return R({ course, version }, 201);
    }
    if (action === "add_module") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const { data: version } = await c.a.from("learning_course_versions").select("id,immutable").eq("id", b.version_id).eq("organization_id", c.organizationId).maybeSingle();
      if (!version || version.immutable) return R({ error: "A versão publicada não pode ser alterada." }, 409);
      const { count } = await c.a.from("learning_modules").select("id", { count: "exact", head: true }).eq("course_version_id", version.id);
      const { data, error } = await c.a.from("learning_modules").insert({ course_version_id: version.id, organization_id: c.organizationId, title: String(b.title || "").slice(0, 160), position: count || 0 }).select().single();
      if (error) throw error;
      return R({ module: data }, 201);
    }
    if (action === "add_lesson") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const { data: module } = await c.a.from("learning_modules").select("id,course_version_id").eq("id", b.module_id).eq("organization_id", c.organizationId).maybeSingle();
      if (!module) return R({ error: "Módulo não encontrado." }, 404);
      const { data: version } = await c.a.from("learning_course_versions").select("immutable").eq("id", module.course_version_id).maybeSingle();
      if (version?.immutable) return R({ error: "A versão publicada não pode ser alterada." }, 409);
      const { count } = await c.a.from("learning_lessons").select("id", { count: "exact", head: true }).eq("module_id", module.id);
      const { data, error } = await c.a.from("learning_lessons").insert({ module_id: module.id, organization_id: c.organizationId, title: String(b.title || "").slice(0, 160), position: count || 0, lesson_type: b.lesson_type || "text", content_json: b.content_json || {}, safe_external_url: b.safe_external_url || null, document_id: b.document_id || null, completion_rule: b.completion_rule || "opened", estimated_minutes: Number(b.estimated_minutes || 0) }).select().single();
      if (error) throw error;
      return R({ lesson: data }, 201);
    }
    if (action === "publish_course") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const { data: course } = await c.a.from("learning_courses").select("*").eq("id", b.course_id).eq("organization_id", c.organizationId).maybeSingle();
      const { data: latest } = await c.a.from("learning_course_versions").select("id").eq("course_id", b.course_id).eq("organization_id", c.organizationId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
      const versionId = b.version_id || latest?.id || course?.current_version_id;
      const { data: version } = await c.a.from("learning_course_versions").select("*,learning_modules(*,learning_lessons(*))").eq("id", versionId).eq("organization_id", c.organizationId).maybeSingle();
      if (!course || !version) return R({ error: "Curso ou versão não encontrada." }, 404);
      const validation = validateCourseForPublish({ title: course.title, summary: course.summary, modules: (version.learning_modules || []).map((m: any) => ({ title: m.title, position: m.position, lessons: (m.learning_lessons || []).map((l: any) => ({ id: l.id, title: l.title, position: l.position, lessonType: l.lesson_type, content: l.content_json, safeExternalUrl: l.safe_external_url, documentId: l.document_id, completionRule: l.completion_rule })) })) });
      if (!validation.valid) return R({ error: "Revise o curso antes de publicar.", details: validation.errors }, 409);
      const publishedAt = new Date().toISOString();
      await c.a.from("learning_course_versions").update({ status: "published", immutable: true, published_by: c.userId, published_at: publishedAt }).eq("id", version.id);
      await c.a.from("learning_courses").update({ status: "published", current_version_id: version.id, published_by: c.userId, published_at: publishedAt, updated_at: publishedAt }).eq("id", course.id);
      await audit(c, "published", "course", course.id, String(b.reason || "Revisão humana concluída"));
      return R({ published: true, course_id: course.id, version_id: version.id });
    }
    if (action === "assign_course") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const employeeIds = [...new Set<string>((b.employee_ids || []).filter((x: any) => UUID.test(String(x))))];
      if (!employeeIds.length) return R({ error: "Selecione ao menos um funcionário." }, 400);
      const { data: course } = await c.a.from("learning_courses").select("id,current_version_id,status").eq("id", b.course_id).eq("organization_id", c.organizationId).maybeSingle();
      if (!course || course.status !== "published" || !course.current_version_id) return R({ error: "Somente cursos publicados podem ser atribuídos." }, 409);
      const { data: employees } = await c.a.from("custom_staff_members").select("id,user_id,primary_store_id,establishment_id").eq("organization_id", c.organizationId).in("id", employeeIds).eq("status", "active");
      const cycle = String(b.cycle_key || "initial"), rows = (employees || []).map((e: any) => ({ organization_id: c.organizationId, store_id: e.primary_store_id || e.establishment_id, employee_id: e.id, user_id: e.user_id, course_id: course.id, course_version_id: course.current_version_id, source: b.source || "manual", cycle_key: cycle, due_at: b.due_at || null }));
      const { data, error } = await c.a.from("learning_enrollments").upsert(rows, { onConflict: "employee_id,course_id,cycle_key", ignoreDuplicates: true }).select();
      if (error) throw error;
      await audit(c, "assigned", "course", course.id, undefined, { count: data?.length || 0 });
      return R({ assigned: data?.length || 0, idempotent: true }, 201);
    }
    if (action === "lesson_progress") {
      if (!c.employee) throw new Error("FORBIDDEN");
      const { data: enrollment } = await c.a.from("learning_enrollments").select("id,employee_id,course_id,status").eq("id", b.enrollment_id).eq("organization_id", c.organizationId).eq("employee_id", c.employee.id).maybeSingle();
      if (!enrollment) throw new Error("FORBIDDEN");
      const { data: lesson } = await c.a.from("learning_lessons").select("id,completion_rule").eq("id", b.lesson_id).eq("organization_id", c.organizationId).maybeSingle();
      if (!lesson) return R({ error: "Aula não encontrada." }, 404);
      const completed = lessonCompletion(lesson.completion_rule, b.evidence || {});
      await c.a.from("learning_lesson_progress").upsert({ enrollment_id: enrollment.id, lesson_id: lesson.id, employee_id: c.employee.id, status: completed ? "completed" : "in_progress", progress_percent: completed ? 100 : Number(b.progress_percent || 0), last_position_seconds: Number(b.last_position_seconds || 0), completion_evidence: b.evidence || {}, device_event_id: b.device_event_id || null, started_at: new Date().toISOString(), completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "enrollment_id,lesson_id" });
      const { data: all } = await c.a.from("learning_lesson_progress").select("status").eq("enrollment_id", enrollment.id), total = Number(b.total_lessons || all?.length || 1), done = (all || []).filter(x => x.status === "completed").length, percent = Math.min(100, Math.round(done / total * 100));
      await c.a.from("learning_enrollments").update({ status: percent === 100 ? "completed" : "in_progress", progress_percent: percent, started_at: enrollment.status === "assigned" ? new Date().toISOString() : undefined, completed_at: percent === 100 ? new Date().toISOString() : null, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", enrollment.id);
      return R({ completed, progress_percent: percent });
    }
    if (action === "submit_assessment") {
      if (!c.employee) throw new Error("FORBIDDEN");
      const { data: assessment } = await c.a.from("learning_assessments").select("*,learning_assessment_questions(*,learning_assessment_options(*))").eq("id", b.assessment_id).eq("organization_id", c.organizationId).eq("active", true).maybeSingle();
      const { data: enrollment } = await c.a.from("learning_enrollments").select("id,employee_id").eq("id", b.enrollment_id).eq("employee_id", c.employee.id).maybeSingle();
      if (!assessment || !enrollment) throw new Error("FORBIDDEN");
      const { data: attempts } = await c.a.from("learning_assessment_attempts").select("status").eq("assessment_id", assessment.id).eq("enrollment_id", enrollment.id), allowed = canStartAttempt(attempts || [], assessment.max_attempts);
      if (!allowed.allowed) return R({ error: "Limite de tentativas atingido." }, 409);
      const questions = (assessment.learning_assessment_questions || []).map((q: any) => ({ id: q.id, type: q.question_type, points: Number(q.points), manualReviewRequired: q.manual_review_required, correctOptionIds: (q.learning_assessment_options || []).filter((o: any) => o.is_correct).map((o: any) => o.id) })), graded = gradeAssessment(questions, b.answers || [], Number(assessment.passing_score || 0)), attemptNumber = allowed.used + 1;
      const { data: attempt, error } = await c.a.from("learning_assessment_attempts").insert({ organization_id: c.organizationId, assessment_id: assessment.id, enrollment_id: enrollment.id, employee_id: c.employee.id, attempt_number: attemptNumber, status: graded.status, score: graded.score, passed: graded.passed, submitted_at: new Date().toISOString(), graded_at: graded.status !== "under_review" ? new Date().toISOString() : null, integrity_snapshot: { server_graded: true } }).select().single();
      if (error) throw error;
      await c.a.from("learning_assessment_answers").insert((b.answers || []).map((answer: any) => { const result = graded.results.find(x => x.questionId === answer.questionId); return { attempt_id: attempt.id, question_id: answer.questionId, selected_option_ids: answer.selectedOptionIds || [], free_text: answer.freeText || null, awarded_points: result?.awardedPoints, correct: result?.correct }; }));
      return R({ attempt: { id: attempt.id, status: graded.status, score: graded.score, passed: graded.passed, attemptNumber }, feedbackAllowed: assessment.show_feedback_after_submission, answerKeyExposed: false });
    }
    if (action === "exempt_enrollment") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const ex = validateExemption(String(b.reason || ""), c.userId), { data } = await c.a.from("learning_enrollments").update({ status: "exempted", exemption_reason: ex.reason, exempted_by: c.userId, updated_at: new Date().toISOString() }).eq("id", b.enrollment_id).eq("organization_id", c.organizationId).select().maybeSingle();
      if (!data) return R({ error: "Matrícula não encontrada." }, 404);
      await audit(c, "exempted", "enrollment", data.id, ex.reason);
      return R({ enrollment: data });
    }
    if (action === "issue_internal_certificate") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const token = randomBytes(24).toString("base64url"), tokenHash = createHash("sha256").update(token).digest("hex"), { data: enrollment } = await c.a.from("learning_enrollments").select("id,employee_id,course_id,status,learning_courses(title)").eq("id", b.enrollment_id).eq("organization_id", c.organizationId).maybeSingle();
      if (!enrollment || enrollment.status !== "completed") return R({ error: "A conclusão é obrigatória para emitir a certificação interna." }, 409);
      const { data, error } = await c.a.from("learning_internal_certifications").insert({ organization_id: c.organizationId, employee_id: enrollment.employee_id, course_id: enrollment.course_id, enrollment_id: enrollment.id, title: (enrollment.learning_courses as any)?.title || "Treinamento concluído", public_token_hash: tokenHash, expires_at: b.expires_at || null }).select().single();
      if (error) throw error;
      await audit(c, "issued", "internal_certification", data.id);
      return R({ certification: data, verification_token: token, label: "Certificação interna" }, 201);
    }
    if (action === "ai_draft") {
      if (!c.admin) throw new Error("FORBIDDEN");
      const guard = tutorGuard({ examMode: Boolean(b.exam_mode), request: String(b.prompt || "") });
      if (!guard.allowed) return R({ error: guard.message }, 409);
      const validation = validateAiDraft({ draftType: b.draft_type || "course_outline", groundingReferences: b.grounding_references || [], examMode: Boolean(b.exam_mode) }), draft = { outline: ["Objetivo", "Conteúdo", "Prática", "Avaliação"], notice: "Rascunho sujeito à revisão humana.", sourceReferences: b.grounding_references };
      const { data, error } = await c.a.from("learning_ai_drafts").insert({ organization_id: c.organizationId, created_by: c.userId, draft_type: b.draft_type || "course_outline", prompt_redacted: String(b.prompt || "").slice(0, 1000), grounding_references: b.grounding_references || [], draft_content: draft, exam_mode: Boolean(b.exam_mode) }).select().single();
      if (error) throw error;
      return R({ draft: data, governance: validation });
    }
    return R({ error: "Ação inválida." }, 400);
  } catch (error: any) { const message = error?.message || "Falha"; return R({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 400); }
}
