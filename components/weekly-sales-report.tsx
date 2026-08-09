"use client";

import { useRef, useState } from "react";

type SoldItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

type DailyOrder = {
  id: string;
  number: number;
  customer: string;
  location: string | number;
  totalCents: number;
  status: string;
  createdAt: string;
};

type SalesDay = {
  dateKey: string;
  label: string;
  publicCount: number;
  tableCount: number;
  count: number;
  total: number;
  itemTotals: SoldItem[];
  orders: DailyOrder[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function WeeklySalesReport({ days, todayKey }: { days: SalesDay[]; todayKey: string }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const reportRef = useRef<HTMLElement>(null);
  const selectedDay = days.find(day => day.dateKey === selectedKey);
  const weekCount = days.reduce((sum, day) => sum + day.count, 0);
  const weekTotal = days.reduce((sum, day) => sum + day.total, 0);

  function openDay(dateKey: string) {
    setSelectedKey(dateKey);
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return <>
    <section className="panel weekly-orders" id="pedidos-semanais">
      <header className="team-group-head"><div><small>HISTÓRICO ORGANIZADO</small><h2>Pedidos semanais</h2><p>Pedidos da cozinha contabilizados por dia, incluindo balcão, entrega e salão.</p></div><div className="weekly-orders-total"><span>{weekCount} pedidos</span><strong>{money.format(weekTotal / 100)}</strong></div></header>
      <div className="weekly-orders-grid">{days.map(day => <button type="button" className={`weekly-day-card ${day.dateKey === todayKey ? "is-today" : ""} ${day.dateKey === selectedKey ? "is-selected" : ""}`} key={day.dateKey} onClick={() => openDay(day.dateKey)} aria-expanded={day.dateKey === selectedKey}>
        <small>{day.label}</small><b>{day.count}</b><span>{money.format(day.total / 100)}</span><p>{day.publicCount} diretos · {day.tableCount} salão</p><strong>Ver itens vendidos →</strong>
      </button>)}</div>
    </section>

    {selectedDay && <article className="panel daily-sales-report" ref={reportRef}>
      <header className="team-group-head">
        <div><small>ITENS VENDIDOS</small><h2>{selectedDay.label}, {new Date(`${selectedDay.dateKey}T12:00:00`).toLocaleDateString("pt-BR")}</h2><p>Conferência completa dos produtos vendidos no dia selecionado.</p></div>
        <div className="weekly-orders-total"><span>{selectedDay.itemTotals.reduce((sum, item) => sum + item.quantity, 0)} itens</span><strong>{money.format(selectedDay.total / 100)}</strong></div>
      </header>
      {selectedDay.itemTotals.length ? <div className="team-report-scroll"><table className="table">
        <thead><tr><th>PRODUTO</th><th>QUANTIDADE</th><th>VALOR UNITÁRIO</th><th>TOTAL VENDIDO</th></tr></thead>
        <tbody>{selectedDay.itemTotals.map(item => <tr key={`${item.name}-${item.unitPriceCents}`}><td><b>{item.name}</b></td><td>{item.quantity}</td><td>{money.format(item.unitPriceCents / 100)}</td><td><b>{money.format(item.totalCents / 100)}</b></td></tr>)}</tbody>
      </table></div> : <div className="empty"><b>Nenhum item vendido neste dia.</b><span>Selecione outro dia da semana para consultar.</span></div>}

      <div className="daily-orders-section">
        <header><div><small>PEDIDOS DO DIA</small><h3>Conferência pedido por pedido</h3><p>Use esta lista para identificar o cliente, a mesa ou canal e o valor que formou o total do dia.</p></div><span className="status-pill">{selectedDay.orders.length} pedidos</span></header>
        {selectedDay.orders.length ? <div className="team-report-scroll"><table className="table">
          <thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>MESA / CANAL</th><th>VALOR</th><th>STATUS</th><th>DATA</th></tr></thead>
          <tbody>{selectedDay.orders.map(order => <tr key={order.id}><td>#{order.number}</td><td>{order.customer}</td><td>{order.location}</td><td><b>{money.format(order.totalCents / 100)}</b></td><td>{order.status}</td><td>{new Date(order.createdAt).toLocaleDateString("pt-BR")}</td></tr>)}</tbody>
        </table></div> : <div className="empty"><b>Nenhum pedido registrado neste dia.</b></div>}
      </div>
    </article>}
  </>;
}
