type Flags = Record<string, unknown>;

// Same rule the modules use on the server (storeFlags in lib/customer-experience/server.ts): a module is on
// when the store or its plan turns it on. Flags that only exist per store (delivery_enabled, whatsapp_enabled,
// ai_enabled...) come straight from the store.
export function mergeStoreFlags<T extends Flags>(plan: T, storeFlags: Flags | null | undefined): T {
  if (!storeFlags) return plan;
  const merged: Flags = { ...plan };
  for (const [key, value] of Object.entries(storeFlags)) {
    if (!key.endsWith("_enabled") || typeof value !== "boolean") continue;
    merged[key] = plan[key] === true || value;
  }
  return merged as T;
}
