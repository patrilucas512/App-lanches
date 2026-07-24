"use client";

import { useMemo, useState } from "react";

type MenuItem = {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  badge?: string;
};

const categories = ["Destaques", "Hambúrgueres", "Massas", "Leves", "Sobremesas"];

const menuItems: MenuItem[] = [
  {
    id: 1,
    name: "Brasa Nobre",
    description: "Blend de 180g, queijo meia cura, cebola caramelizada e aioli defumado.",
    price: 42.9,
    category: "Hambúrgueres",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=85",
    badge: "Mais pedido",
  },
  {
    id: 2,
    name: "Trufa & Funghi",
    description: "Fettuccine fresco, mix de cogumelos, parmesão e azeite trufado.",
    price: 54.9,
    category: "Massas",
    image: "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=85",
    badge: "Chef recomenda",
  },
  {
    id: 3,
    name: "Burrata do Campo",
    description: "Tomates confitados, pesto de manjericão, rúcula e focaccia artesanal.",
    price: 46.9,
    category: "Leves",
    image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=85",
  },
  {
    id: 4,
    name: "Costela 12 Horas",
    description: "Costela desfiada, purê rústico, molho roti e farofa crocante.",
    price: 62.9,
    category: "Destaques",
    image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85",
    badge: "Edição especial",
  },
  {
    id: 5,
    name: "Crispy Garden",
    description: "Burger vegetal, cheddar, picles agridoce e maionese de ervas.",
    price: 39.9,
    category: "Hambúrgueres",
    image: "https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=900&q=85",
  },
  {
    id: 6,
    name: "Ravioli Dourado",
    description: "Ravioli de abóbora, manteiga de sálvia, amêndoas e parmesão.",
    price: 49.9,
    category: "Massas",
    image: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&w=900&q=85",
  },
  {
    id: 7,
    name: "Cítrico da Casa",
    description: "Mousse de limão siciliano, merengue tostado e crocante de castanhas.",
    price: 24.9,
    category: "Sobremesas",
    image: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=900&q=85",
  },
  {
    id: 8,
    name: "Cacau Intenso",
    description: "Brownie 70%, creme inglês, caramelo salgado e sorvete de baunilha.",
    price: 28.9,
    category: "Sobremesas",
    image: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85",
  },
];

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("Destaques");
  const [cart, setCart] = useState<Record<number, number>>({});

  const visibleItems = activeCategory === "Destaques"
    ? menuItems.slice(0, 4)
    : menuItems.filter((item) => item.category === activeCategory);

  const cartItems = useMemo(
    () => menuItems
      .filter((item) => cart[item.id])
      .map((item) => ({ ...item, quantity: cart[item.id] })),
    [cart],
  );

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const delivery = subtotal > 80 || subtotal === 0 ? 0 : 7.9;
  const total = subtotal + delivery;

  function updateCart(id: number, delta: number) {
    setCart((current) => {
      const next = Math.max(0, (current[id] || 0) + delta);
      const updated = { ...current };
      if (next === 0) delete updated[id];
      else updated[id] = next;
      return updated;
    });
  }

  function sendOrder() {
    const lines = cartItems.map((item) =>
      `${item.quantity}x ${item.name} — ${currency.format(item.price * item.quantity)}`,
    );
    const message = [
      "Olá! Quero fazer este pedido na Mesa Viva:",
      "",
      ...lines,
      "",
      `Total: ${currency.format(total)}`,
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Mesa Viva, início">
          <span className="brand-mark">M</span>
          <span><b>MESA VIVA</b><small>cozinha contemporânea</small></span>
        </a>
        <div className="top-actions">
          <span className="open-status"><i /> Aberto agora</span>
          <a className="bag-button" href="#pedido" aria-label={`Ver pedido com ${itemCount} itens`}>
            <span>Pedido</span><b>{itemCount}</b>
          </a>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-content">
          <span className="eyebrow">SABORES QUE FICAM NA MEMÓRIA</span>
          <h1>Seu momento merece<em>algo extraordinário.</em></h1>
          <p>Ingredientes selecionados, receitas autorais e uma experiência criada para transformar qualquer refeição em celebração.</p>
          <a className="primary-cta" href="#cardapio">Explorar cardápio <span>↓</span></a>
        </div>
        <div className="hero-plate" aria-hidden="true">
          <div className="plate-image" />
          <span className="floating-card floating-rating"><b>4,9 ★</b><small>+2 mil avaliações</small></span>
          <span className="floating-card floating-delivery"><b>25–35 min</b><small>entrega estimada</small></span>
        </div>
      </section>

      <section className="trust-strip" aria-label="Diferenciais">
        <div><b>✦</b><span><strong>Ingredientes frescos</strong><small>Seleção diária de produtores locais</small></span></div>
        <div><b>⌁</b><span><strong>Entrega cuidadosa</strong><small>Embalagens que preservam cada detalhe</small></span></div>
        <div><b>♜</b><span><strong>Cozinha autoral</strong><small>Receitas assinadas pelo nosso chef</small></span></div>
      </section>

      <section className="menu-section" id="cardapio">
        <div className="section-heading">
          <div><span className="eyebrow">NOSSO CARDÁPIO</span><h2>Escolha seu próximo favorito.</h2></div>
          <p>Pratos preparados no momento, com ingredientes que respeitam a estação.</p>
        </div>

        <div className="category-tabs" role="tablist" aria-label="Categorias do cardápio">
          {categories.map((category) => (
            <button
              key={category}
              className={activeCategory === category ? "active" : ""}
              onClick={() => setActiveCategory(category)}
              role="tab"
              aria-selected={activeCategory === category}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="menu-layout">
          <div className="menu-grid">
            {visibleItems.map((item) => (
              <article className="dish-card" key={item.id}>
                <div className="dish-image" style={{ backgroundImage: `url("${item.image}")` }} role="img" aria-label={item.name}>
                  {item.badge && <span className="dish-badge">{item.badge}</span>}
                </div>
                <div className="dish-body">
                  <div className="dish-title"><h3>{item.name}</h3><strong>{currency.format(item.price)}</strong></div>
                  <p>{item.description}</p>
                  <div className="dish-footer">
                    <span>Serve 1 pessoa</span>
                    {cart[item.id] ? (
                      <div className="quantity" aria-label={`Quantidade de ${item.name}`}>
                        <button onClick={() => updateCart(item.id, -1)} aria-label="Diminuir quantidade">−</button>
                        <b>{cart[item.id]}</b>
                        <button onClick={() => updateCart(item.id, 1)} aria-label="Aumentar quantidade">+</button>
                      </div>
                    ) : (
                      <button className="add-button" onClick={() => updateCart(item.id, 1)}>Adicionar <span>+</span></button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className="cart-card" id="pedido">
            <div className="cart-heading">
              <div><span className="eyebrow">SEU PEDIDO</span><h3>{itemCount ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}` : "Comece por aqui"}</h3></div>
              {itemCount > 0 && <button onClick={() => setCart({})}>Limpar</button>}
            </div>
            {cartItems.length === 0 ? (
              <div className="empty-cart"><span>◌</span><p>Seu pedido ainda está vazio.</p><small>Adicione um prato e ele aparecerá aqui.</small></div>
            ) : (
              <>
                <div className="cart-items">
                  {cartItems.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <div><b>{item.quantity}× {item.name}</b><small>{currency.format(item.price * item.quantity)}</small></div>
                      <div className="mini-quantity">
                        <button onClick={() => updateCart(item.id, -1)} aria-label={`Remover um ${item.name}`}>−</button>
                        <button onClick={() => updateCart(item.id, 1)} aria-label={`Adicionar um ${item.name}`}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="totals">
                  <p><span>Subtotal</span><b>{currency.format(subtotal)}</b></p>
                  <p><span>Entrega</span><b>{delivery ? currency.format(delivery) : "Grátis"}</b></p>
                  <p className="grand-total"><span>Total</span><b>{currency.format(total)}</b></p>
                </div>
                <button className="checkout-button" onClick={sendOrder}>Finalizar no WhatsApp <span>↗</span></button>
                <small className="secure-note">Pedido sem compromisso • pagamento na entrega</small>
              </>
            )}
          </aside>
        </div>
      </section>

      <section className="saas-banner">
        <div>
          <span className="eyebrow">FEITO PARA RESTAURANTES QUE QUEREM CRESCER</span>
          <h2>Este cardápio pode ter a sua marca.</h2>
          <p>Receba pedidos sem comissão, atualize preços em segundos e transforme visitantes em clientes fiéis.</p>
        </div>
        <div className="saas-offer">
          <small>A partir de</small>
          <strong><span>R$</span> 99<small>/mês</small></strong>
          <a href="https://wa.me/?text=Quero%20um%20card%C3%A1pio%20digital%20para%20meu%20restaurante" target="_blank" rel="noreferrer">
            Quero meu cardápio <span>↗</span>
          </a>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">M</span><span><b>MESA VIVA</b><small>cardápios que vendem</small></span></div>
        <p>Uma experiência digital criada para restaurantes memoráveis.</p>
        <span>© 2026 Mesa Viva</span>
      </footer>

      {itemCount > 0 && (
        <a className="mobile-cart" href="#pedido"><span><b>{itemCount}</b> Ver pedido</span><strong>{currency.format(total)}</strong></a>
      )}
    </main>
  );
}
