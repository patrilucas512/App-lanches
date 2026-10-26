"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush } from "@/lib/push-notifications";
import { PixPayment } from "@/components/pix-payment";
import { CustomerInstallCard } from "@/components/app-install-prompt";
import { operationTheme, readableText } from "@/lib/operation-theme";

type Addon = {
  id?: string;
  group_id?: string;
  name: string;
  price_cents: number;
};
type AddonSelection = Addon & { quantity: number };
type MenuAddonGroup = {
  id: string;
  name: string;
  description?: string;
  min_choices: number;
  max_choices: number;
  required: boolean;
  addons: Addon[];
};
export type MenuProduct = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  price_cents: number;
  featured?: boolean;
  ingredients?: string[];
  addon_options?: Addon[];
  addon_groups?: MenuAddonGroup[];
};
export type MenuCategory = {
  id: string;
  name: string;
  description?: string;
  products: MenuProduct[];
};
export type PublicMenu = {
  establishment: {
    id?: string;
    name: string;
    slug: string;
    description?: string;
    logo_url?: string;
    cover_url?: string;
    accent_color: string;
    secondary_color?: string;
    menu_background_color?: string;
    menu_surface_color?: string;
    menu_text_color?: string;
    menu_muted_color?: string;
  };
  settings: {
    whatsapp?: string;
    delivery_enabled: boolean;
    pickup_enabled: boolean;
    estimated_minutes?: number;
    payment_methods?: string[];
  };
  banners?: {
    id: string;
    title: string;
    image_url: string;
    link_url?: string;
    subtitle?: string;
    promotion_type?: "banner" | "percentage" | "fixed" | "free_delivery";
    promotion_value?: number;
    destination_type?: "menu" | "category" | "product" | "checkout" | "url";
    destination_id?: string;
  }[];
  categories: MenuCategory[];
  service_mode?: {
    mode: string;
    waiter_mode_enabled: boolean;
    table_service_enabled: boolean;
    takeaway_enabled: boolean;
    counter_pickup_enabled: boolean;
    delivery_enabled: boolean;
    store_open: boolean;
    customer_self_order_enabled: boolean;
    waiter_call_enabled: boolean;
    bill_closing_enabled: boolean;
    accepted_payment_methods: string[];
    active_waiters: number;
  };
  payment_gateways?: { provider: "mercado_pago" | "pagarme"; label: string }[];
};
type CartItem = {
  key: string;
  product: MenuProduct;
  quantity: number;
  addons: AddonSelection[];
  removedIngredients: string[];
};
type SavedOrderItem = {
  productId: string;
  productName: string;
  quantity: number;
  addons: AddonSelection[];
  removedIngredients: string[];
};
type SavedOrder = {
  savedAt: string;
  items: SavedOrderItem[];
};
type QrTable = {
  table_id: string;
  table_number: string;
  table_name?: string;
  waiter_calls_enabled: boolean;
};
type TrackedItem = {
  id: string;
  product_name: string;
  quantity: number;
  addons: Addon[];
  removed_ingredients: string[];
};
type OrderTracking = {
  order_number: number;
  status: string;
  kitchen_status?: string;
  fulfillment_type: string;
  created_at: string;
  updated_at: string;
  estimated_minutes: number;
  estimated_min_minutes?: number;
  estimated_max_minutes?: number;
  estimated_arrival_at?: string | null;
  table_number?: string;
  started_at?: string;
  ready_at?: string;
  delivered_at?: string;
  delivery_status?: string;
  delivery_confirmation?: "pin" | "assisted";
  delivery_pin?: string;
  payment_method?: string;
  online_payment_status?: "pending" | "approved" | "declined" | "canceled" | "refunded";
  items: TrackedItem[];
};
type CustomerDeliveryTracking = {
  delivery_status: string;
  tracking_available: boolean;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_label?: string | null;
  last_updated_at?: string | null;
};
type DeliveryQuote = {
  zone_id?: string | null;
  zone_name?: string | null;
  fee_cents: number;
  minimum_order_cents: number;
  estimated_minutes: number;
  estimated_min_minutes?: number;
  estimated_max_minutes?: number;
  total_cents: number;
};

const addonIdentity = (addon: Addon) => addon.id || addon.name;
const hasProductOptions = (product: MenuProduct) =>
  Boolean(product.addon_groups?.length || product.addon_options?.length);

const statusOrder = ["received", "preparing", "ready", "delivered"];
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
const moneyInputToCents = (value: string) => {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  return Math.round(Number(normalized) * 100);
};
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function groupedAddonNames(addons: Addon[]) {
  const counts = new Map<string, number>();
  for (const addon of addons || [])
    counts.set(addon.name, (counts.get(addon.name) || 0) + 1);
  return [...counts]
    .map(([name, quantity]) => `${quantity > 1 ? `${quantity}× ` : ""}${name}`)
    .join(", ");
}

function readSavedOrder(storageKey: string): SavedOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (!parsed || typeof parsed.savedAt !== "string" || !Array.isArray(parsed.items))
      return null;
    const items = parsed.items.filter(
      (item: SavedOrderItem) =>
        item &&
        typeof item.productId === "string" &&
        typeof item.productName === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        Array.isArray(item.addons) &&
        Array.isArray(item.removedIngredients),
    );
    return items.length ? { savedAt: parsed.savedAt, items } : null;
  } catch {
    return null;
  }
}

export function PublicMenuView({
  menu,
  tableNumber,
  source,
}: {
  menu: PublicMenu;
  tableNumber?: string;
  source?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const cartStarted = useRef(false);
  const portalReorderApplied = useRef(false);
  const checkoutForm = useRef<HTMLFormElement | null>(null);
  const checkoutSession = useRef("");
  const audioContext = useRef<AudioContext | null>(null);
  const alertedReady = useRef(false);
  const storageKey = `masterapp:${menu.establishment.slug}:pedido`;
  const oldStorageKey = `mesa-viva:${menu.establishment.slug}:pedido`;
  const lastOrderStorageKey = `masterapp:${menu.establishment.slug}:ultimo-pedido`;
  const categories = menu.categories.filter(
    (category) => category.products.length,
  );
  const products = categories.flatMap((category) => category.products);
  const heroProduct =
    products.find((product) => product.featured && product.image_url) ||
    products.find((product) => product.image_url);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem("masterapp:menu-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastOrder, setLastOrder] = useState<SavedOrder | null>(() =>
    readSavedOrder(lastOrderStorageKey),
  );
  const [customizingKey, setCustomizingKey] = useState<string | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(false);
  const [message, setMessage] = useState("");
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [qrTable, setQrTable] = useState<QrTable | null>(null);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterMessage, setWaiterMessage] = useState("");
  const [trackingToken, setTrackingToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("pedido") ||
        window.localStorage.getItem(storageKey) ||
        window.localStorage.getItem(oldStorageKey) ||
        "",
  );
  useEffect(() => {
    if (!trackingToken) return;
    try { window.localStorage.setItem(storageKey, trackingToken); } catch { /* Acompanhamento continua pela URL. */ }
  }, [storageKey, trackingToken]);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [driverTracking, setDriverTracking] = useState<CustomerDeliveryTracking | null>(null);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [destinationMessage, setDestinationMessage] = useState("");
  const [destinationBusy, setDestinationBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const service = menu.service_mode ?? {
    mode: "mixed",
    waiter_mode_enabled: true,
    table_service_enabled: true,
    takeaway_enabled: true,
    counter_pickup_enabled: menu.settings.pickup_enabled,
    delivery_enabled: menu.settings.delivery_enabled,
    store_open: true,
    customer_self_order_enabled: true,
    waiter_call_enabled: true,
    bill_closing_enabled: true,
    accepted_payment_methods: menu.settings.payment_methods || [],
    active_waiters: 0,
  };
  const fulfillmentOptions = [
    service.table_service_enabled && {
      value: "dine_in",
      label: "Consumir no local",
      detail: "Atendimento na mesa",
    },
    service.takeaway_enabled && {
      value: "takeaway",
      label: "Para viagem",
      detail: "Pedido embalado para levar",
    },
    service.counter_pickup_enabled && {
      value: "pickup",
      label: "Retirada",
      detail: "Busque no estabelecimento",
    },
    service.delivery_enabled && {
      value: "delivery",
      label: "Entrega",
      detail: "Receba no endereço informado",
    },
  ].filter(Boolean) as { value: string; label: string; detail: string }[];
  const defaultFulfillment = fulfillmentOptions[0]?.value || "pickup";
  const [fulfillment, setFulfillment] = useState(
    tableNumber && service.table_service_enabled
      ? "dine_in"
      : defaultFulfillment,
  );
  const gatewayPaymentOptions = (menu.payment_gateways || []).map((gateway) => ({
    value: `${gateway.provider}_online`, label: `Cartão online · ${gateway.label}`,
  }));
  const inlinePixAvailable = (menu.payment_gateways || []).some(g => g.provider === "mercado_pago") && ["pickup", "takeaway", "delivery"].includes(fulfillment);
  const paymentOptions = [
    ...(inlinePixAvailable ? [{ value: "mercado_pago_pix", label: "Pix online · QR Code e Copia e Cola" }] : []),
    ...service.accepted_payment_methods.filter(value => !(inlinePixAvailable && value === "pix")).map((value) => ({
      value,
      label: value === "pix" ? "Pix do estabelecimento" : value === "cash" ? "Dinheiro" : value === "credit_card" ? "Cartão de crédito na entrega" : "Cartão de débito na entrega",
    })),
    ...gatewayPaymentOptions,
  ];
  const [paymentMethod, setPaymentMethod] = useState(paymentOptions[0]?.value || "cash");
  const availablePaymentValues = paymentOptions.map(option => option.value).join(",");
  useEffect(() => {
    const values = availablePaymentValues.split(",");
    if (!values.includes(paymentMethod)) setPaymentMethod(values[0] || "cash");
  }, [availablePaymentValues, paymentMethod]);
  const [cashReceived, setCashReceived] = useState("");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  const itemUnitPrice = (item: CartItem) =>
    item.product.price_cents +
    item.addons.reduce(
      (sum, addon) => sum + addon.price_cents * addon.quantity,
      0,
    );
  const total = useMemo(
    () =>
      cart.reduce((sum, item) => sum + itemUnitPrice(item) * item.quantity, 0),
    [cart],
  );
  const checkoutTotal = total + (fulfillment === "delivery" ? deliveryQuote?.fee_cents || 0 : 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    setDeliveryQuote(null);
    setQuoteMessage("");
  }, [total, fulfillment]);
  const record = (
    event: string,
    productId?: string,
    orderId?: string,
    valueCents?: number,
  ) => {
    if (menu.establishment.slug !== "demo")
      void supabase.rpc("record_public_event", {
        requested_slug: menu.establishment.slug,
        requested_event: event,
        requested_product: productId ?? null,
        requested_order: orderId ?? null,
        requested_value_cents: valueCents ?? null,
      });
  };

  useEffect(() => {
    if (menu.establishment.slug !== "demo")
      void supabase.rpc("record_public_event", {
        requested_slug: menu.establishment.slug,
        requested_event: "menu_view",
        requested_product: null,
        requested_order: null,
        requested_value_cents: null,
      });
    if (source === "qr" || tableNumber)
      void supabase
        .rpc("record_qr_scan", {
          requested_slug: menu.establishment.slug,
          requested_table_number: tableNumber ?? null,
          requested_source: source === "qr" ? "qr" : "print",
          requested_user_agent: navigator.userAgent,
        })
        .then(({ data }) => {
          if (data?.table_id) setQrTable(data as QrTable);
        });
  }, [menu.establishment.slug, source, supabase, tableNumber]);

  function confirmDestination() {
    if (!navigator.geolocation) return setDestinationMessage("Este aparelho não disponibiliza localização. O endereço informado continua válido.");
    setDestinationBusy(true);
    setDestinationMessage("Aguardando sua permissão de localização...");
    navigator.geolocation.getCurrentPosition(async position => {
      if (position.coords.accuracy > 50) {
        setDestinationBusy(false);
        setDestinationMessage("Sinal impreciso. Tente novamente perto de uma janela.");
        return;
      }
      try {
        const { error } = await supabase.rpc("confirm_delivery_destination_location", {
          requested_tracking_token: trackingToken,
          requested_latitude: position.coords.latitude,
          requested_longitude: position.coords.longitude,
        });
        setDestinationMessage(error ? error.message : "Localização do destino confirmada para este pedido.");
      } catch {
        setDestinationMessage("Não foi possível confirmar agora. Tente novamente.");
      } finally { setDestinationBusy(false); }
    }, () => {
      setDestinationBusy(false);
      setDestinationMessage("Localização não disponível. A entrega seguirá pelo endereço informado.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function changeTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("masterapp:menu-theme", next);
  }

  function scrollCategory(categoryId: string, direction: number) {
    const carousel = document.querySelector<HTMLElement>(
      `[data-carousel="${categoryId}"]`,
    );
    carousel?.scrollBy({
      left: direction * Math.max(280, carousel.clientWidth * 0.82),
      behavior: "smooth",
    });
  }

  function readyAlert() {
    if (alertedReady.current) return;
    alertedReady.current = true;
    if (navigator.vibrate)
      navigator.vibrate([1000, 350, 1000, 350, 1000, 350, 1000, 350, 1000]);
    const context = audioContext.current;
    if (!context) return;
    void context.resume();
    let count = 0;
    const beep = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = count % 2 ? 740 : 980;
      gain.gain.value = 0.12;
      oscillator.start();
      oscillator.stop(context.currentTime + 0.55);
      count += 1;
    };
    beep();
    const timer = window.setInterval(() => {
      if (count >= 10) window.clearInterval(timer);
      else beep();
    }, 1000);
  }

  useEffect(() => {
    if (!trackingToken) return;
    let active = true;
    const refresh = async () => {
      const [{ data }, { data: locationData }] = await Promise.all([
        supabase.rpc("get_public_order_status", { requested_tracking_token: trackingToken }),
        supabase.rpc("get_customer_delivery_tracking", { requested_tracking_token: trackingToken }),
      ]);
      if (!active || !data) return;
      const next = data as OrderTracking;
      setTracking(next);
      setDriverTracking((locationData || null) as CustomerDeliveryTracking | null);
      if (
        (next.kitchen_status === "ready" || next.status === "ready") &&
        !alertedReady.current
      )
        readyAlert();
    };
    void refresh();
    const poll = window.setInterval(refresh, 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [trackingToken, supabase]);

  function markCartStarted(productId: string) {
    record("product_added", productId);
    if (!cartStarted.current) {
      cartStarted.current = true;
      record("cart_started");
    }
  }

  function add(product: MenuProduct) {
    const existing = cart.find(
      (item) =>
        item.product.id === product.id &&
        !item.addons.length &&
        !item.removedIngredients.length,
    );
    if (existing)
      setCart((current) =>
        current.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: Math.min(999, item.quantity + 1) }
            : item,
        ),
      );
    else
      setCart((current) => [
        ...current,
        {
          key: crypto.randomUUID(),
          product,
          quantity: 1,
          addons: [],
          removedIngredients: [],
        },
      ]);
    markCartStarted(product.id);
  }

  function repeatLastOrder() {
    if (!lastOrder) return;
    let skippedItems = 0;
    const restored = lastOrder.items.flatMap<CartItem>((savedItem) => {
      const product = products.find((candidate) => candidate.id === savedItem.productId);
      if (!product) {
        skippedItems += 1;
        return [];
      }
      const availableAddons = [
        ...(product.addon_options || []),
        ...(product.addon_groups || []).flatMap((group) => group.addons),
      ];
      const addons = savedItem.addons.flatMap<AddonSelection>((savedAddon) => {
        const currentAddon = availableAddons.find(
          (candidate) =>
            (savedAddon.id && candidate.id === savedAddon.id) ||
            (!savedAddon.id &&
              candidate.name === savedAddon.name &&
              candidate.group_id === savedAddon.group_id),
        );
        return currentAddon
          ? [{ ...currentAddon, quantity: Math.max(1, Math.min(20, savedAddon.quantity)) }]
          : [];
      });
      const ingredients = product.ingredients || [];
      return [{
        key: crypto.randomUUID(),
        product,
        quantity: Math.max(1, Math.min(999, savedItem.quantity)),
        addons,
        removedIngredients: savedItem.removedIngredients.filter((ingredient) =>
          ingredients.includes(ingredient),
        ),
      }];
    });
    if (!restored.length) {
      setMessage("Os itens do último pedido não estão mais disponíveis.");
      return;
    }
    setCart(restored);
    setCheckoutStep(false);
    setCustomizingKey(null);
    setMessage(
      skippedItems
        ? "Pedido restaurado. Itens indisponíveis não foram adicionados."
        : "Último pedido adicionado à sacola.",
    );
    restored.forEach((item) => markCartStarted(item.product.id));
  }

  useEffect(() => {
    if (portalReorderApplied.current || new URLSearchParams(window.location.search).get("reorder") !== "1" || !lastOrder) return;
    portalReorderApplied.current = true;
    repeatLastOrder();
    window.history.replaceState({}, "", window.location.pathname);
  }, [lastOrder]);

  function changeQuantity(key: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.key === key
            ? {
                ...item,
                quantity: Math.max(0, Math.min(999, item.quantity + delta)),
              }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }
  function productQuantity(productId: string) {
    return cart
      .filter((item) => item.product.id === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  }
  function removeOneProduct(productId: string) {
    setCart((current) => {
      const candidates = current
        .map((item, index) => ({ item, index }))
        .filter((value) => value.item.product.id === productId);
      const target =
        candidates.find(
          (value) =>
            !value.item.addons.length && !value.item.removedIngredients.length,
        ) || candidates.at(-1);
      if (!target) return current;
      return current
        .map((item, index) =>
          index === target.index
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0);
    });
  }
  function openAddons(product: MenuProduct) {
    const existing = cart.find((item) => item.product.id === product.id);
    if (existing) setCustomizingKey(existing.key);
    else {
      const key = crypto.randomUUID();
      setCart((current) => [
        ...current,
        { key, product, quantity: 1, addons: [], removedIngredients: [] },
      ]);
      setCustomizingKey(key);
      markCartStarted(product.id);
    }
    setCheckoutStep(false);
    setBagOpen(true);
  }
  function toggleIngredient(key: string, ingredient: string) {
    setCart((current) =>
      current.map((item) =>
        item.key !== key
          ? item
          : {
              ...item,
              removedIngredients: item.removedIngredients.includes(ingredient)
                ? item.removedIngredients.filter(
                    (value) => value !== ingredient,
                  )
                : [...item.removedIngredients, ingredient],
            },
      ),
    );
  }
  function changeAddon(
    key: string,
    addon: Addon,
    delta: number,
    group?: MenuAddonGroup,
  ) {
    setCart((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        const identity = addonIdentity(addon);
        const groupQuantity = group
          ? item.addons
              .filter((value) => value.group_id === group.id)
              .reduce((sum, value) => sum + value.quantity, 0)
          : 0;
        if (delta > 0 && group && groupQuantity >= group.max_choices)
          return item;
        const quantity = Math.max(
          0,
          Math.min(
            20,
            (item.addons.find(
              (value) => addonIdentity(value) === identity,
            )?.quantity || 0) + delta,
          ),
        );
        const addons = item.addons.filter(
          (value) => addonIdentity(value) !== identity,
        );
        if (quantity) addons.push({ ...addon, quantity });
        return { ...item, addons };
      }),
    );
  }

  async function quoteDelivery(data?: FormData) {
    const formData = data || (checkoutForm.current ? new FormData(checkoutForm.current) : null);
    const neighborhood = String(formData?.get("delivery_neighborhood") || "").trim();
    if (neighborhood.length < 2) {
      setDeliveryQuote(null);
      setQuoteMessage("Informe o bairro para calcular a taxa.");
      return null;
    }
    if (menu.establishment.slug === "demo") {
      const demoQuote = { fee_cents: 500, minimum_order_cents: 0, estimated_minutes: 40, estimated_min_minutes: 35, estimated_max_minutes: 45, total_cents: total + 500 };
      setDeliveryQuote(demoQuote);
      setQuoteMessage("Taxa calculada para demonstração.");
      return demoQuote;
    }
    setQuoteLoading(true);
    setQuoteMessage("Calculando a entrega...");
    const { data: result, error } = await supabase.rpc("quote_public_delivery", {
      requested_slug: menu.establishment.slug,
      requested_neighborhood: neighborhood,
      requested_subtotal_cents: total,
    });
    setQuoteLoading(false);
    if (error) {
      setDeliveryQuote(null);
      setQuoteMessage(error.message);
      return null;
    }
    const nextQuote = result as DeliveryQuote;
    setDeliveryQuote(nextQuote);
    setQuoteMessage(nextQuote.fee_cents === 0 ? "Entrega grátis para este pedido." : `Taxa de entrega: ${money(nextQuote.fee_cents)}.`);
    return nextQuote;
  }

  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (orderSubmitting) return;
    setOrderSubmitting(true);
    setMessage("Enviando o pedido para a cozinha...");
    if (!service.store_open) {
      setOrderSubmitting(false);
      return setMessage(
        "A loja está fechada no momento e não recebe novos pedidos.",
      );
    }
    for (const item of cart) {
      for (const group of item.product.addon_groups || []) {
        const selected = item.addons
          .filter((addon) => addon.group_id === group.id)
          .reduce((sum, addon) => sum + addon.quantity, 0);
        if (selected < group.min_choices)
          { setOrderSubmitting(false); return setMessage(
            `${item.product.name}: escolha pelo menos ${group.min_choices} opção(ões) em ${group.name}.`,
          ); }
        if (selected > group.max_choices)
          { setOrderSubmitting(false); return setMessage(
            `${item.product.name}: escolha no máximo ${group.max_choices} opção(ões) em ${group.name}.`,
          ); }
      }
    }
    if (menu.establishment.slug === "demo") {
      setOrderSubmitting(false);
      return setMessage(
        "Esta é uma loja demonstrativa. Crie sua conta para receber pedidos reais.",
      );
    }
    if (!audioContext.current) audioContext.current = new AudioContext();
    void audioContext.current.resume();
    alertedReady.current = false;
    const data = new FormData(event.currentTarget);
    const buyerName = String(data.get("name") || "").trim();
    const chosenFulfillment = String(data.get("fulfillment"));
    const tableLabel = String(data.get("table_label") || "").trim();
    const requestedPayment = String(data.get("payment") || "");
    const buyerPhone = String(data.get("phone") || "").replace(/\D/g, "");
    const cashReceivedCents =
      requestedPayment === "cash"
        ? moneyInputToCents(String(data.get("cash_received") || ""))
        : null;
    if (buyerName.split(/\s+/).length < 2) {
      setOrderSubmitting(false);
      return setMessage(
        "Informe seu nome e sobrenome para identificar o pedido.",
      );
    }
    if (chosenFulfillment === "dine_in" && !tableLabel) { setOrderSubmitting(false);
      return setMessage("Informe o número ou nome da mesa onde você está.");
    }
    const deliveryAddress = chosenFulfillment === "delivery" ? {
      recipient_name: buyerName,
      street: String(data.get("delivery_street") || "").trim(),
      number: String(data.get("delivery_number") || "").trim(),
      complement: String(data.get("delivery_complement") || "").trim(),
      neighborhood: String(data.get("delivery_neighborhood") || "").trim(),
      reference: String(data.get("delivery_reference") || "").trim(),
    } : null;
    if (chosenFulfillment === "delivery" && (
      !deliveryAddress?.street || !deliveryAddress.number ||
      !deliveryAddress.neighborhood || buyerPhone.length < 10
    )) { setOrderSubmitting(false); return setMessage("Confira rua, número, bairro e WhatsApp."); }
    const freshQuote = chosenFulfillment === "delivery" ? await quoteDelivery(data) : null;
    if (chosenFulfillment === "delivery" && !freshQuote) { setOrderSubmitting(false); return setMessage("Confira a área e a taxa de entrega."); }
    const validatedTotal = total + (freshQuote?.fee_cents || 0);
    if (requestedPayment === "cash" && (
      cashReceivedCents === null || !Number.isFinite(cashReceivedCents) || cashReceivedCents < validatedTotal
    )) { setOrderSubmitting(false); return setMessage("Informe um valor em dinheiro igual ou maior que o total da compra."); }
    const pushSubscription = subscribeToPush(true).catch(() => null);
    const requestedItems = cart.map((item) => ({
      product_id: item.product.id,
      quantity: item.quantity,
      addons: item.addons.map((addon) => ({
        id: addon.id,
        group_id: addon.group_id,
        name: addon.name,
        quantity: addon.quantity,
      })),
      removed_ingredients: item.removedIngredients,
    }));
    if (!checkoutSession.current) checkoutSession.current = crypto.randomUUID();
    const capacityIdempotency = `checkout:${checkoutSession.current}:${crypto.randomUUID()}`;
    let capacityHoldId = "";
    try {
      const capacityResponse = await fetch("/api/public-capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reserve", slug: menu.establishment.slug, fulfillment: chosenFulfillment, items: requestedItems, session_reference: checkoutSession.current, idempotency_key: capacityIdempotency }) });
      const capacity = await capacityResponse.json() as { allow?:boolean;hold_id?:string;message?:string;promise?:{label?:string};fallback?:string };
      if (!capacityResponse.ok || capacity.allow === false) { setOrderSubmitting(false); return setMessage(capacity.message || "Não há capacidade disponível para este horário. Tente o próximo horário sugerido."); }
      capacityHoldId = capacity.hold_id || "";
      if (capacity.promise?.label) setMessage(`Horário reservado por 5 minutos · previsão ${capacity.promise.label}. Confirmando pedido...`);
    } catch {
      setMessage("Confirmando com estimativa conservadora...");
    }
    const { data: result, error } = await supabase.rpc("place_public_order_v2", {
      requested_slug: menu.establishment.slug,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      requested_fulfillment: chosenFulfillment,
      requested_items: requestedItems,
      order_notes: null,
      requested_table_number:
        chosenFulfillment === "dine_in" ? tableLabel : null,
      requested_source: source === "qr" || qrTable ? "qr" : "direct",
      requested_payment: requestedPayment === "mercado_pago_pix" ? "mercado_pago_online" : requestedPayment,
      requested_cash_received_cents: cashReceivedCents,
      requested_delivery_address: deliveryAddress,
    });
    if (error) {
      if (capacityHoldId) void fetch("/api/public-capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", slug: menu.establishment.slug, hold_id: capacityHoldId, session_reference: checkoutSession.current }) });
      setOrderSubmitting(false);
      return setMessage(error.message);
    }
    if (capacityHoldId) {
      try {
        const commitResponse = await fetch("/api/public-capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit", slug: menu.establishment.slug, fulfillment: chosenFulfillment, hold_id: capacityHoldId, order_id: result.order_id, tracking_token: result.tracking_token, session_reference: checkoutSession.current }) });
        const committed = await commitResponse.json().catch(() => null) as {promise?:{label?:string}}|null;
        if (committed?.promise?.label) setTrackingMessage(`Previsão atual: ${committed.promise.label}.`);
      } catch {
        // O pedido oficial permanece válido; o worker reconcilia a capacidade depois.
      }
    }
    record("order_whatsapp", undefined, result.order_id, result.total_cents);
    const token = String(result.tracking_token);
    const savedOrder: SavedOrder = {
      savedAt: new Date().toISOString(),
      items: cart.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        addons: item.addons,
        removedIngredients: item.removedIngredients,
      })),
    };
    try {
      window.localStorage.setItem(lastOrderStorageKey, JSON.stringify(savedOrder));
    } catch {
      // The order remains valid even when private browsing blocks local storage.
    }
    setLastOrder(savedOrder);
    window.localStorage.setItem(storageKey, token);
    window.localStorage.removeItem(oldStorageKey);
    setTrackingToken(token);
    setDestinationMessage("");
    setBagOpen(false);
    setCheckoutStep(false);
    setCart([]);
    setCashReceived("");
    setDeliveryQuote(null);
    setQuoteMessage("");
    cartStarted.current = false;
    setMessage("");
    setOrderSubmitting(false);
    const subscription = await pushSubscription;
    if (subscription)
      void supabase.rpc("register_customer_push_subscription", {
        requested_tracking_token: token,
        requested_subscription: subscription,
      });
    if (requestedPayment === "mercado_pago_online" || requestedPayment === "pagarme_online") {
      setMessage(`Abrindo o pagamento seguro do ${requestedPayment === "mercado_pago_online" ? "Mercado Pago" : "Pagar.me"}...`);
      const checkoutResponse = await fetch("/api/order-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: result.order_id,
          tracking_token: token,
          provider: requestedPayment.replace("_online", ""),
        }),
      });
      const checkout = await checkoutResponse.json() as { url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.url) {
        setMessage(checkout.error || "Pedido criado, mas o pagamento não pôde ser aberto. Faça um novo pedido ou fale com o estabelecimento.");
        return;
      }
      window.location.assign(checkout.url);
      return;
    }
  }

  async function callWaiter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWaiterMessage("Enviando chamado...");
    const data = new FormData(event.currentTarget);
    const label =
      qrTable?.table_number || String(data.get("table_label") || "").trim();
    const { data: result, error } = await supabase.rpc("create_waiter_call", {
      requested_slug: menu.establishment.slug,
      requested_table_number: label,
      requested_note: String(data.get("note") || ""),
    });
    setWaiterMessage(
      error
        ? error.message
        : result?.duplicate
          ? "Seu chamado já está aguardando atendimento."
          : `Garçom chamado para a mesa ${label}!`,
    );
  }

  function startNewOrder() {
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(oldStorageKey);
    setTrackingToken("");
    setTracking(null);
    setDriverTracking(null);
    setTrackingMessage("");
    alertedReady.current = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function confirmReceived() {
    if (!trackingToken || currentStatus !== "ready" || tracking?.fulfillment_type === "delivery") return;
    setTrackingMessage("Confirmando a retirada...");
    const { error } = await supabase.rpc("confirm_public_order_received", {
      requested_tracking_token: trackingToken,
    });
    if (error) return setTrackingMessage(error.message);
    setTracking(current => current ? { ...current, status: "completed", kitchen_status: "delivered" } : current);
    setTrackingMessage("Pedido finalizado. Obrigado!");
  }

  const deliveryStatusMap: Record<string, string> = {
    ready_for_dispatch: "ready", searching_driver: "ready", driver_assigned: "ready", driver_to_pickup: "ready",
    picked_up: "on_route", on_route: "on_route", arrived: "arrived", delivered: "delivered",
    returning_to_store: "returning_to_store", returned_to_store: "returning_to_store", failed: "returning_to_store",
  };
  const currentStatus = tracking?.fulfillment_type === "delivery" && tracking.delivery_status
    ? (deliveryStatusMap[tracking.delivery_status] || tracking.kitchen_status || "received")
    : tracking?.kitchen_status || (tracking?.status === "completed" ? "delivered" : tracking?.status) || "received";
  const trackingStages = tracking?.fulfillment_type === "delivery"
    ? [["received", "Recebido"], ["preparing", "Em preparo"], ["on_route", "Saiu para entrega"], ["delivered", "Entregue"]]
    : [["received", "Recebido"], ["preparing", "Em preparo"], ["ready", "Pronto"], ["delivered", "Entregue"]];
  const deliveryStageOrder = ["received", "preparing", "ready", "on_route", "arrived", "delivered"];
  const stageIndex = tracking?.fulfillment_type === "delivery"
    ? Math.max(0, deliveryStageOrder.indexOf(currentStatus) >= 3 ? 2 : deliveryStageOrder.indexOf(currentStatus))
    : Math.max(0, statusOrder.indexOf(currentStatus));
  const countdownStart = tracking?.started_at || tracking?.created_at;
  const secondsRemaining =
    tracking && countdownStart
      ? Math.max(
          0,
          tracking.estimated_minutes * 60 -
            Math.floor((now - new Date(countdownStart).getTime()) / 1000),
        )
      : 0;
  const minutesLabel = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const deliveryEtaMinimum = tracking?.estimated_min_minutes || tracking?.estimated_minutes || 45;
  const deliveryEtaMaximum = tracking?.estimated_max_minutes || tracking?.estimated_minutes || deliveryEtaMinimum;
  const trackingFulfillment =
    tracking?.fulfillment_type === "dine_in"
      ? "Consumir no local"
      : tracking?.fulfillment_type === "takeaway"
        ? "Para viagem"
        : tracking?.fulfillment_type === "delivery"
          ? "Entrega"
          : "Retirada";

  return (
    <main
      className={`menu-page menu-${theme}`}
      style={
        {
          ...operationTheme(menu.establishment),
          "--menu-accent": menu.establishment.accent_color || "#ff641f",
          "--menu-paper": menu.establishment.secondary_color || "#f5efe5",
          "--menu-brand-bg": menu.establishment.menu_background_color || "#080807",
          "--menu-brand-surface": menu.establishment.menu_surface_color || "#151411",
          "--menu-brand-text": "var(--op-background-text)",
          "--menu-brand-muted": "var(--op-background-muted)",
          "--menu-surface-text": "var(--op-text)",
          "--menu-surface-muted": "var(--op-muted)",
          "--menu-link": "var(--op-link)",
          "--menu-on-accent": "var(--op-on-accent)",
          "--menu-light-text": readableText(menu.establishment.secondary_color || "#f5efe5", "#181612"),
          "--menu-light-muted": readableText(menu.establishment.secondary_color || "#f5efe5", "#6e685e"),
        } as React.CSSProperties
      }
    >
      <nav className="menu-topbar">
        <a className="menu-store-brand" href="#inicio">
          {menu.establishment.logo_url ? (
            <img
              src={menu.establishment.logo_url}
              alt={`Logo de ${menu.establishment.name}`}
            />
          ) : (
            <span>{menu.establishment.name.charAt(0)}</span>
          )}
          <div>
            <b>{menu.establishment.name}</b>
            <small
              className={service.store_open ? "store-open" : "store-closed"}
            >
              <i /> {service.store_open ? "Aberto agora" : "Fechado agora"}
            </small>
          </div>
        </a>
        <div className="menu-top-links">
          <a href="#inicio">Início</a>
          <a href="#cardapio">Cardápio</a>
          {tracking && <a href="#acompanhar">Acompanhar pedido</a>}
        </div>
        <div className="menu-top-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={changeTheme}
            aria-label={`Ativar modo ${theme === "dark" ? "claro" : "escuro"}`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            type="button"
            className="bag-button"
            onClick={() => {
              setCheckoutStep(false);
              setBagOpen(true);
            }}
          >
            <span>▢</span> Sacola <b>{totalItems}</b>
          </button>
        </div>
      </nav>

      <header
        id="inicio"
        className="menu-cover"
        style={
          menu.establishment.cover_url || heroProduct?.image_url
            ? {
                backgroundImage: `linear-gradient(90deg,rgba(5,5,4,.98) 0%,rgba(5,5,4,.78) 48%,rgba(5,5,4,.18) 100%),url(${menu.establishment.cover_url || heroProduct?.image_url})`,
              }
            : undefined
        }
      >
        <div className="menu-hero-copy">
          <span className="menu-eyebrow">
            SABOR, AGILIDADE E PEDIDO SEM FILA
          </span>
          <h1>{menu.establishment.name}</h1>
          <p>
            {menu.establishment.description ||
              "Escolha, personalize e envie seu pedido direto para a cozinha."}
          </p>
          {!service.store_open && (
            <div className="menu-store-closed-notice">
              Loja fechada agora · o cardápio continua disponível para consulta.
            </div>
          )}
          <div className="menu-hero-actions">
            <a href="#cardapio">
              Ver cardápio <span>→</span>
            </a>
            <a href={`/conta/${menu.establishment.slug}`} className="menu-account-link">
              Minha conta
            </a>
            {menu.settings.estimated_minutes && (
              <small>
                Pronto em cerca de <b>{menu.settings.estimated_minutes} min</b>
              </small>
            )}
          </div>
        </div>
      </header>

      <nav className="menu-category-nav" aria-label="Categorias do cardápio">
        <a href="#cardapio" className="active">
          Todos
        </a>
        {categories.map((category) => (
          <a
            href={`#${slugify(category.name)}-${category.id.slice(0, 5)}`}
            key={category.id}
          >
            {category.name}
          </a>
        ))}
      </nav>
      {service.waiter_call_enabled &&
        service.waiter_mode_enabled &&
        service.active_waiters > 0 && (
          <button
            className="floating-waiter-button"
            onClick={() => setWaiterOpen(true)}
          >
            🔔 Chamar garçom
          </button>
        )}

      {tracking && (
        <div className="order-tracking-shell">
          <section
            id="acompanhar"
            className={`order-tracking tracking-${currentStatus}`}
            aria-live="polite"
          >
          {tracking.fulfillment_type === "delivery" && ["received", "preparing"].includes(tracking.status) && <div className="customer-driver-location waiting">
            <div><b>Você está no endereço da entrega?</b><span>Opcional: confirme sua posição atual para ajudar a equipe a identificar o destino. Use somente se estiver no local que receberá o pedido.</span>{destinationMessage && <span role="status">{destinationMessage}</span>}</div>
            <button type="button" className="button outline" disabled={destinationBusy} onClick={confirmDestination}>{destinationBusy ? "Localizando..." : "Estou no destino · confirmar GPS"}</button>
          </div>}
          <div className="tracking-heading">
            <div>
              <small>
                ACOMPANHE SEU PEDIDO · {trackingFulfillment.toUpperCase()}
              </small>
              <h2>Pedido #{tracking.order_number}</h2>
            </div>
            {currentStatus === "preparing" && tracking.fulfillment_type !== "delivery" && (
              <div className="tracking-clock">
                <span>⏱</span>
                <b>{minutesLabel}</b>
                <small>tempo estimado</small>
              </div>
            )}
            {tracking.fulfillment_type === "delivery" && currentStatus !== "delivered" && currentStatus !== "returning_to_store" && (
              <div className="tracking-delivery-eta" aria-label={`Previsão de entrega entre ${deliveryEtaMinimum} e ${deliveryEtaMaximum} minutos`}>
                <span>PREVISÃO</span>
                <b>{deliveryEtaMinimum}–{deliveryEtaMaximum} min</b>
                <small>estimativa operacional</small>
              </div>
            )}
            {currentStatus === "ready" && tracking.fulfillment_type !== "delivery" && (
              <div className="tracking-ready-alert">
                <b>PRONTO!</b>
                <span>
                  {tracking.fulfillment_type === "dine_in" &&
                  service.waiter_mode_enabled
                    ? `A equipe levará até ${tracking.table_number ? `a mesa ${tracking.table_number}` : "sua mesa"}.`
                    : tracking.fulfillment_type === "delivery"
                      ? "Seu pedido está pronto para sair para entrega."
                      : tracking.fulfillment_type === "takeaway"
                        ? "Seu pedido para viagem está pronto para retirada."
                        : "Retire seu pedido, obrigado."}
                </span>
              </div>
            )}
          </div>
          {tracking.online_payment_status === "pending" && <div className="tracking-delivery-update warning"><b>Aguardando confirmação do pagamento</b><span>O pedido será enviado à cozinha automaticamente após a aprovação do provedor.</span></div>}
          {tracking.payment_method === "mercado_pago_online" && ["pickup", "takeaway", "delivery"].includes(tracking.fulfillment_type) && tracking.online_payment_status === "pending" && <PixPayment key={trackingToken} trackingToken={trackingToken} />}
          {tracking.online_payment_status === "approved" && <div className="tracking-delivery-update success"><b>Pago online ✓</b><span>Pagamento confirmado. Não pague novamente na retirada.</span></div>}
          {["pickup", "takeaway"].includes(tracking.fulfillment_type) && ["cash", "credit_card", "debit_card"].includes(tracking.payment_method || "") && currentStatus !== "delivered" && <div className="tracking-delivery-update warning"><b>Passe no caixa antes de retirar</b><span>Seu pedido segue normalmente para a cozinha. Pague no caixa e apresente a confirmação antes da retirada.</span></div>}
          {tracking.online_payment_status === "declined" && <div className="tracking-delivery-update warning"><b>Pagamento não aprovado</b><span>Este pedido não foi enviado à cozinha. Faça um novo pedido e escolha outra forma de pagamento.</span></div>}
          {tracking.fulfillment_type === "delivery" && currentStatus === "ready" && <div className="tracking-delivery-update"><b>Preparando o despacho</b><span>Estamos buscando ou aguardando o motoboy responsável.</span></div>}
          {tracking.fulfillment_type === "delivery" && currentStatus === "on_route" && <div className="tracking-delivery-update"><b>Seu pedido saiu para entrega</b><span>Acompanhe esta tela e aguarde o motoboy.</span></div>}
          {tracking.fulfillment_type === "delivery" && currentStatus === "arrived" && <div className="tracking-delivery-update"><b>O motoboy chegou</b><span>Confira o pedido antes de informar o PIN.</span></div>}
          {tracking.fulfillment_type === "delivery" && currentStatus === "delivered" && <div className="tracking-delivery-update success"><b>Entrega confirmada com segurança</b><span>{tracking.delivery_confirmation === "pin" ? "O PIN foi validado e a entrega ficou registrada." : "A entrega foi concluída com assistência do estabelecimento e registro de auditoria."}</span></div>}
          {tracking.fulfillment_type === "delivery" && ["on_route", "arrived"].includes(currentStatus) && <div className={`customer-driver-location ${driverTracking?.tracking_available ? "available" : "waiting"}`}><div><small>LOCALIZAÇÃO DO MOTOBOY</small><b>{driverTracking?.tracking_available ? "Posição aproximada disponível" : "Aguardando sinal de localização"}</b><span>{driverTracking?.last_updated_at ? `Atualizada às ${new Date(driverTracking.last_updated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "A posição aparecerá quando o motoboy ativar o compartilhamento."}</span></div>{driverTracking?.tracking_available && driverTracking.latitude != null && driverTracking.longitude != null && <a className="button outline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${driverTracking.latitude}&mlon=${driverTracking.longitude}#map=16/${driverTracking.latitude}/${driverTracking.longitude}`}>Ver posição aproximada</a>}</div>}
          {tracking.delivery_pin && <div className="delivery-pin-card" aria-live="assertive"><small>PIN SEGURO DE ENTREGA</small><strong>{tracking.delivery_pin}</strong><span>Informe somente ao motoboy quando ele estiver com seu pedido no endereço.</span></div>}
          {currentStatus === "returning_to_store" && <div className="tracking-delivery-update warning"><b>Entrega não concluída</b><span>O pedido está retornando ao estabelecimento. Entre em contato com a loja para orientação.</span></div>}
          <div className="tracking-steps">
            {trackingStages.map(([status, label], index) => {
              const completed = tracking.fulfillment_type === "delivery"
                ? index <= (currentStatus === "delivered" ? 3 : stageIndex)
                : index <= stageIndex;
              const interactive = tracking.fulfillment_type !== "delivery" && status === "delivered";
              return interactive ? <button type="button" key={status} className={`tracking-confirm-step ${completed ? "active" : ""}`} disabled={currentStatus !== "ready"} onClick={() => void confirmReceived()}><i>{currentStatus === "delivered" ? "✓" : 4}</i><span>{currentStatus === "ready" ? "Confirmar retirada" : currentStatus === "delivered" ? "Entregue" : "Aguardando"}</span></button>
                : <div className={completed ? "active" : ""} key={status}><i>{completed && index < (tracking.fulfillment_type === "delivery" ? (currentStatus === "delivered" ? 4 : stageIndex) : stageIndex) ? "✓" : index + 1}</i><span>{label}</span></div>;
            })}
          </div>
          {trackingMessage && (
            <div className="tracking-message">{trackingMessage}</div>
          )}
          <div className="tracking-items">
            <h3>Seu pedido</h3>
            {tracking.items.map((item) => (
              <div key={item.id}>
                <b>
                  {item.quantity}× {item.product_name}
                </b>
                {item.addons?.length > 0 && (
                  <small>+ {groupedAddonNames(item.addons)}</small>
                )}
                {item.removed_ingredients?.length > 0 && (
                  <strong>SEM {item.removed_ingredients.join(", ")}</strong>
                )}
              </div>
            ))}
          </div>
          {(tracking.fulfillment_type !== "delivery" || currentStatus === "delivered") && <button
            type="button"
            className="new-order-button"
            onClick={startNewOrder}
          >
            Fazer novo pedido
          </button>}
          <CustomerInstallCard />
          </section>
        </div>
      )}

      {menu.banners?.length ? (
        <section className="menu-banners">
          {menu.banners.map((banner) => (
            <a
              key={banner.id}
              href={banner.link_url || "#"}
              style={{ backgroundImage: `url(${banner.image_url})` }}
            >
              <span className="menu-banner-copy">
                <b>{banner.title}</b>
                {banner.subtitle ? <small>{banner.subtitle}</small> : null}
                {banner.promotion_type === "percentage" &&
                banner.promotion_value ? (
                  <em>{banner.promotion_value}% OFF</em>
                ) : banner.promotion_type === "fixed" &&
                  banner.promotion_value ? (
                  <em>{money(banner.promotion_value)} de desconto</em>
                ) : banner.promotion_type === "free_delivery" ? (
                  <em>Entrega grátis</em>
                ) : null}
              </span>
            </a>
          ))}
        </section>
      ) : null}
      <section id="cardapio" className="menu-content">
        {categories.map((category, categoryIndex) => (
          <div
            className="menu-category"
            id={`${slugify(category.name)}-${category.id.slice(0, 5)}`}
            key={category.id}
          >
            <div className="menu-category-title">
              <div>
                <span>
                  {categoryIndex === 0
                    ? "OS FAVORITOS DA CASA"
                    : "ESCOLHA O SEU"}
                </span>
                <h2>{category.name}</h2>
              </div>
              <div className="menu-category-side">
                {category.description && <p>{category.description}</p>}
              </div>
            </div>
            <div className="product-carousel-shell">
              <button
                className="product-carousel-arrow previous"
                type="button"
                aria-label={`Ver produtos anteriores de ${category.name}`}
                onClick={() => scrollCategory(category.id, -1)}
              >
                ‹
              </button>
              <div
                className="product-grid product-carousel"
                data-carousel={category.id}
              >
                {category.products.map((product) => {
                  const selectedQuantity = productQuantity(product.id);
                  return (
                    <article className="product-card" key={product.id}>
                      <div
                        className="product-image"
                        style={
                          product.image_url
                            ? { backgroundImage: `url(${product.image_url})` }
                            : undefined
                        }
                      >
                        {product.featured && <span>DESTAQUE</span>}
                      </div>
                      <div className="product-info">
                        <small>{category.name}</small>
                        <h3>{product.name}</h3>
                        <p>
                          {product.description ||
                            (product.ingredients?.length
                              ? product.ingredients.join(", ")
                              : "Preparado especialmente para você.")}
                        </p>
                        {product.ingredients?.length ? (
                          <span className="ingredient-summary">
                            Leva: {product.ingredients.join(", ")}
                          </span>
                        ) : null}
                        <div className="product-purchase-row">
                          <strong>{money(product.price_cents)}</strong>
                          {service.customer_self_order_enabled && (
                            <div className="product-order-actions">
                              {hasProductOptions(product) ? (
                                <button
                                  type="button"
                                  className="addons-button"
                                  disabled={!service.store_open}
                                  onClick={() => openAddons(product)}
                                >
                                  Adicionais
                                </button>
                              ) : null}
                              <div
                                className={`product-quantity ${selectedQuantity ? "selected" : ""}`}
                              >
                                <button
                                  type="button"
                                  disabled={
                                    !selectedQuantity || !service.store_open
                                  }
                                  aria-label={`Diminuir quantidade de ${product.name}`}
                                  onClick={() => removeOneProduct(product.id)}
                                >
                                  −
                                </button>
                                <b>{selectedQuantity}</b>
                                <button
                                  type="button"
                                  disabled={!service.store_open}
                                  aria-label={`Aumentar quantidade de ${product.name}`}
                                  onClick={() => add(product)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <button
                className="product-carousel-arrow next"
                type="button"
                aria-label={`Ver próximos produtos de ${category.name}`}
                onClick={() => scrollCategory(category.id, 1)}
              >
                ›
              </button>
            </div>
          </div>
        ))}
      </section>

      {service.customer_self_order_enabled && (cart.length > 0 || lastOrder) && (
        <button
          className="cart-bar"
          onClick={() => {
            record("checkout_started", undefined, undefined, total);
            setCheckoutStep(false);
            setBagOpen(true);
          }}
        >
          <span>
            <b>▢</b>{" "}
            {cart.length
              ? `${totalItems} ${totalItems === 1 ? "item" : "itens"}`
              : "Último pedido"}
          </span>
          <strong>{cart.length ? "Ver sacola" : "Pedir novamente"}</strong>
          {cart.length ? <b>{money(total)}</b> : <b>↻</b>}
        </button>
      )}

      {bagOpen && (
        <div className="checkout-overlay" onClick={() => setBagOpen(false)}>
          <aside
            className="checkout-card"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="checkout-close"
              onClick={() => setBagOpen(false)}
            >
              ×
            </button>
            <span className="checkout-kicker">SUA SACOLA</span>
            <h2>{checkoutStep ? "Finalizar pedido" : "Revise seu pedido"}</h2>
            {lastOrder && !checkoutStep && (
              <section className="last-order-card" aria-label="Último pedido neste celular">
                <div className="last-order-heading">
                  <div>
                    <span>ÚLTIMO PEDIDO NESTE CELULAR</span>
                    <strong>Seu favorito está salvo</strong>
                  </div>
                  <time dateTime={lastOrder.savedAt}>
                    {Number.isNaN(new Date(lastOrder.savedAt).getTime())
                      ? "Pedido anterior"
                      : new Intl.DateTimeFormat("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                        }).format(new Date(lastOrder.savedAt))}
                  </time>
                </div>
                <div className="last-order-items">
                  {lastOrder.items.map((item, index) => (
                    <span key={`${item.productId}-${index}`}>
                      {item.quantity}× {item.productName}
                    </span>
                  ))}
                </div>
                <button type="button" className="repeat-order-button" onClick={repeatLastOrder}>
                  ↻ Pedir novamente
                </button>
              </section>
            )}
            {cart.length ? (
              <>
                <div className="cart-lines">
                  {cart.map((item) => (
                    <div className="cart-line cart-line-custom" key={item.key}>
                      <div className="cart-line-heading">
                        <div>
                          <b>{item.product.name}</b>
                          <small>{item.product.description}</small>
                        </div>
                        <strong>
                          {money(itemUnitPrice(item) * item.quantity)}
                        </strong>
                      </div>
                      <div className="cart-item-tools">
                        <div className="mini-quantity">
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.key, -1)}
                          >
                            −
                          </button>
                          <b>{item.quantity}</b>
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.key, 1)}
                          >
                            +
                          </button>
                        </div>
                        {item.product.ingredients?.length ||
                        hasProductOptions(item.product) ? (
                          <button
                            type="button"
                            className="customize-toggle"
                            onClick={() =>
                              setCustomizingKey(
                                customizingKey === item.key ? null : item.key,
                              )
                            }
                          >
                            Personalizar
                          </button>
                        ) : null}
                      </div>
                      {customizingKey === item.key && (
                        <div className="inline-customizer">
                          {item.product.addon_groups?.map((group) => (
                            <fieldset key={group.id}>
                              <legend>{group.name}</legend>
                              <small>
                                {group.description ||
                                  `Escolha de ${group.min_choices} até ${group.max_choices} opção(ões).`}
                              </small>
                              {group.addons.map((addon) => {
                                const quantity =
                                  item.addons.find(
                                    (value) =>
                                      addonIdentity(value) ===
                                      addonIdentity(addon),
                                  )?.quantity || 0;
                                const groupQuantity = item.addons
                                  .filter(
                                    (value) => value.group_id === group.id,
                                  )
                                  .reduce(
                                    (sum, value) => sum + value.quantity,
                                    0,
                                  );
                                return (
                                  <div
                                    className="addon-counter-row"
                                    key={addonIdentity(addon)}
                                  >
                                    <div>
                                      <b>{addon.name}</b>
                                      <span>
                                        + {money(addon.price_cents)} cada
                                      </span>
                                    </div>
                                    <div>
                                      <button
                                        type="button"
                                        disabled={!quantity}
                                        onClick={() =>
                                          changeAddon(
                                            item.key,
                                            addon,
                                            -1,
                                            group,
                                          )
                                        }
                                      >
                                        −
                                      </button>
                                      <b>{quantity}</b>
                                      <button
                                        type="button"
                                        disabled={
                                          groupQuantity >= group.max_choices
                                        }
                                        onClick={() =>
                                          changeAddon(
                                            item.key,
                                            addon,
                                            1,
                                            group,
                                          )
                                        }
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </fieldset>
                          ))}
                          {item.product.addon_options?.length ? (
                            <fieldset>
                              <legend>Adicionais</legend>
                              <small>
                                Use − e + para escolher a quantidade de cada
                                adicional.
                              </small>
                              {item.product.addon_options.map((addon) => {
                                const quantity =
                                  item.addons.find(
                                    (value) => value.name === addon.name,
                                  )?.quantity || 0;
                                return (
                                  <div
                                    className="addon-counter-row"
                                    key={addon.name}
                                  >
                                    <div>
                                      <b>{addon.name}</b>
                                      <span>
                                        + {money(addon.price_cents)} cada
                                      </span>
                                    </div>
                                    <div>
                                      <button
                                        type="button"
                                        disabled={!quantity}
                                        onClick={() =>
                                          changeAddon(item.key, addon, -1)
                                        }
                                      >
                                        −
                                      </button>
                                      <b>{quantity}</b>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          changeAddon(item.key, addon, 1)
                                        }
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </fieldset>
                          ) : null}
                          {item.product.ingredients?.length ? (
                            <fieldset>
                              <legend>Deseja retirar algo?</legend>
                              {item.product.ingredients.map((ingredient) => (
                                <label key={ingredient}>
                                  <input
                                    type="checkbox"
                                    checked={item.removedIngredients.includes(
                                      ingredient,
                                    )}
                                    onChange={() =>
                                      toggleIngredient(item.key, ingredient)
                                    }
                                  />
                                  <span>Sem {ingredient}</span>
                                </label>
                              ))}
                            </fieldset>
                          ) : null}
                        </div>
                      )}
                      {item.addons.length > 0 && (
                        <div className="cart-addon-summary">
                          +{" "}
                          {item.addons
                            .map((addon) => `${addon.quantity}× ${addon.name}`)
                            .join(", ")}
                        </div>
                      )}
                      {item.removedIngredients.length > 0 && (
                        <div className="cart-removed-highlight">
                          SEM {item.removedIngredients.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {checkoutStep ? (
                  <form ref={checkoutForm} className="form" onSubmit={order}>
                    <div className="field">
                      <label>NOME E SOBRENOME</label>
                      <input
                        name="name"
                        required
                        maxLength={120}
                        autoComplete="name"
                        placeholder="Ex.: Maria Oliveira"
                      />
                    </div>
                    <fieldset className="fulfillment-fieldset">
                      <legend>COMO VOCÊ PREFERE?</legend>
                      <input
                        type="hidden"
                        name="fulfillment"
                        value={fulfillment}
                      />
                      <div className="fulfillment-choice-grid">
                        {fulfillmentOptions.map((option) => (
                          <button
                            type="button"
                            key={option.value}
                            className={`fulfillment-choice ${fulfillment === option.value ? "selected" : ""}`}
                            aria-pressed={fulfillment === option.value}
                            onClick={() => setFulfillment(option.value)}
                          >
                            <b>{option.label}</b>
                            <small>{option.detail}</small>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {fulfillment === "dine_in" && (
                      <div className="field">
                        <label>NÚMERO OU NOME DA MESA</label>
                        <input
                          name="table_label"
                          required
                          maxLength={40}
                          defaultValue={
                            qrTable?.table_number || tableNumber || ""
                          }
                          placeholder="Ex.: 12 ou Varanda 3"
                        />
                      </div>
                    )}
                    {fulfillment === "delivery" && (
                      <div className="delivery-address-grid">
                        <div className="field field-wide">
                          <label>RUA</label>
                          <input name="delivery_street" required maxLength={120} autoComplete="address-line1" placeholder="Ex.: Rua das Flores" />
                        </div>
                        <div className="field">
                          <label>NÚMERO</label>
                          <input name="delivery_number" required maxLength={20} placeholder="Ex.: 125" />
                        </div>
                        <div className="field">
                          <label>COMPLEMENTO (OPCIONAL)</label>
                          <input name="delivery_complement" maxLength={120} autoComplete="address-line2" placeholder="Ex.: Apto. 202" />
                        </div>
                        <div className="field">
                          <label>BAIRRO</label>
                          <input name="delivery_neighborhood" required maxLength={80} autoComplete="address-level3" placeholder="Ex.: Centro" onChange={() => { setDeliveryQuote(null); setQuoteMessage(""); }} />
                        </div>
                        <div className="field field-wide">
                          <label>PONTO DE REFERÊNCIA (OPCIONAL)</label>
                          <input name="delivery_reference" maxLength={160} placeholder="Ex.: Portão azul" />
                        </div>
                        <button className="button outline field-wide" type="button" disabled={quoteLoading} onClick={() => void quoteDelivery()}>
                          {quoteLoading ? "Calculando..." : "Calcular taxa de entrega"}
                        </button>
                        {(deliveryQuote || quoteMessage) && (
                          <div className="delivery-quote-card field-wide" aria-live="polite">
                            {deliveryQuote ? (
                              <>
                                <div><span>Subtotal</span><b>{money(total)}</b></div>
                                <div><span>Entrega{deliveryQuote.zone_name ? ` · ${deliveryQuote.zone_name}` : ""}</span><b>{deliveryQuote.fee_cents ? money(deliveryQuote.fee_cents) : "Grátis"}</b></div>
                                <div className="delivery-quote-total"><span>Total</span><strong>{money(deliveryQuote.total_cents)}</strong></div>
                                <small className="delivery-eta-range">Previsão: <b>{deliveryQuote.estimated_min_minutes || deliveryQuote.estimated_minutes}–{deliveryQuote.estimated_max_minutes || deliveryQuote.estimated_minutes} minutos</b>.</small>
                              </>
                            ) : <small>{quoteMessage}</small>}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="field">
                      <label>FORMA DE PAGAMENTO</label>
                      <select
                        name="payment"
                        value={paymentMethod}
                        onChange={(event) => {
                          setPaymentMethod(event.target.value);
                          if (event.target.value !== "cash")
                            setCashReceived("");
                        }}
                      >
                        {paymentOptions.map((method) => (
                          <option value={method.value} key={method.value}>
                            {method.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {paymentMethod === "cash" && (
                      <div className="public-cash-payment">
                        <div className="public-cash-total">
                          <span>Valor da compra</span>
                          <strong>{money(checkoutTotal)}</strong>
                        </div>
                        <div className="field">
                          <label>VALOR QUE VAI PAGAR (R$)</label>
                          <input
                            name="cash_received"
                            value={cashReceived}
                            onChange={(event) =>
                              setCashReceived(event.target.value)
                            }
                            inputMode="decimal"
                            placeholder="Ex.: 100,00"
                            required
                          />
                        </div>
                        <div className="public-cash-change">
                          <span>Troco</span>
                          <strong>
                            {money(
                              Math.max(
                                0,
                                (Number.isFinite(
                                  moneyInputToCents(cashReceived),
                                )
                                  ? moneyInputToCents(cashReceived)
                                  : 0) - checkoutTotal,
                              ),
                            )}
                          </strong>
                        </div>
                      </div>
                    )}
                    <div className="field optional-contact">
                      <label>WHATSAPP {fulfillment === "delivery" ? "" : "(OPCIONAL)"}</label>
                      <input
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        required={fulfillment === "delivery"}
                        placeholder="(21) 99999-9999"
                      />
                      <small>
                        {fulfillment === "delivery"
                          ? "Usaremos este contato somente para localizar você e entregar o pedido."
                          : "Se sair do estabelecimento, deixe seu contato para receber o aviso quando o pedido estiver pronto."}
                      </small>
                    </div>
                    {message && <div className="form-message">{message}</div>}
                    <button className="button dark wide" disabled={orderSubmitting}>
                      {orderSubmitting ? "Validando capacidade..." : `Enviar para a cozinha · ${money(checkoutTotal)}`}
                    </button>
                  </form>
                ) : (
                  <button
                    className="button menu-checkout-button wide"
                    onClick={() => setCheckoutStep(true)}
                  >
                    Continuar · {money(total)}
                  </button>
                )}
              </>
            ) : (
              <div className="empty-bag">
                <span>▢</span>
                <h3>Sua sacola está vazia</h3>
                <p>Adicione um produto para começar.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {waiterOpen && (
        <div className="checkout-overlay" onClick={() => setWaiterOpen(false)}>
          <aside
            className="waiter-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="checkout-close"
              onClick={() => setWaiterOpen(false)}
            >
              ×
            </button>
            <span className="kicker">ATENDIMENTO NA MESA</span>
            <h2>Chamar garçom</h2>
            <form className="form" onSubmit={callWaiter}>
              {!qrTable && (
                <div className="field">
                  <label>NÚMERO OU NOME DA MESA</label>
                  <input
                    name="table_label"
                    required
                    maxLength={40}
                    placeholder="Ex.: 12 ou Varanda 3"
                  />
                </div>
              )}
              <div className="field">
                <label>MOTIVO (OPCIONAL)</label>
                <textarea
                  name="note"
                  maxLength={300}
                  placeholder="Ex.: Preciso de mais guardanapos."
                />
              </div>
              {waiterMessage && (
                <div
                  className={
                    waiterMessage.includes("chamado")
                      ? "form-message form-success"
                      : "form-message"
                  }
                >
                  {waiterMessage}
                </div>
              )}
              <button className="button dark wide">Confirmar chamado</button>
            </form>
          </aside>
        </div>
      )}
    </main>
  );
}
