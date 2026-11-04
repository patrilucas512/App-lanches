// Fase 98E: chave pública VAPID por ambiente (NEXT_PUBLIC_VAPID_PUBLIC_KEY). A chave precisa formar par com a
// privada guardada no banco do ambiente (private.app_secrets.vapid_private_key). Sem a variável, a chave atual de
// produção só vale quando o app aponta para o banco de produção; em dev e homologação o push fica desligado em
// vez de inscrever o navegador com uma chave que o servidor não consegue usar.
export const PRODUCTION_VAPID_PUBLIC_KEY = "BCP0CejQDRaVxSo35ZtUDs5wFYbrTNnAJZDrlFBaI1hzPONZR89meKlAFlVOFXHu7TDUZFT-n_CAy0K1kUuCobQ";
const PRODUCTION_SUPABASE_REF = "qjwmjwubtgqginwhmajv";

export function vapidPublicKey(
  configured: string | undefined = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  const key = configured?.trim();
  if (key) return key;
  return supabaseUrl?.includes(PRODUCTION_SUPABASE_REF) ? PRODUCTION_VAPID_PUBLIC_KEY : null;
}

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}

export function supportsPushNotifications() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && vapidPublicKey() !== null;
}

export async function subscribeToPush(askPermission = true): Promise<PushSubscriptionJSON | null> {
  const key = vapidPublicKey();
  if (!supportsPushNotifications() || !key) return null;
  if (Notification.permission === "default" && askPermission) await Notification.requestPermission();
  if (Notification.permission !== "granted") return null;
  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(key) });
  return subscription.toJSON();
}
