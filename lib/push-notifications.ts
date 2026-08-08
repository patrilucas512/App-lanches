export const VAPID_PUBLIC_KEY = "BCP0CejQDRaVxSo35ZtUDs5wFYbrTNnAJZDrlFBaI1hzPONZR89meKlAFlVOFXHu7TDUZFT-n_CAy0K1kUuCobQ";

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}

export function supportsPushNotifications() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function subscribeToPush(askPermission = true): Promise<PushSubscriptionJSON | null> {
  if (!supportsPushNotifications()) return null;
  if (Notification.permission === "default" && askPermission) await Notification.requestPermission();
  if (Notification.permission !== "granted") return null;
  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(VAPID_PUBLIC_KEY) });
  return subscription.toJSON();
}
