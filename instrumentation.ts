// Fase 99G: todo erro de rota ou API (Next onRequestError) vai para public.app_error_events, mascarado
// (lib/error-log.ts). O plano Hobby da Vercel guarda só 1 hora de log; o banco guarda 14 dias.
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
) {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { recordAppError } = await import("@/lib/error-log");
  await recordAppError({ error, method: request.method, path: request.path, routePath: context.routePath, routeType: context.routeType });
}
