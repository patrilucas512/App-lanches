/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { type CSSProperties, FormEvent, useState } from "react";

const RANGE: Record<string, number[]> = { "0-10": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "1-5": [1, 2, 3, 4, 5], "1-7": [1, 2, 3, 4, 5, 6, 7] };
const ENDS: Record<string, [string, string]> = { nps: ["Não recomendaria", "Recomendaria muito"], csat: ["Muito ruim", "Muito boa"], ces: ["Muito difícil", "Muito fácil"] };
const ERRORS: Record<string, string> = { CX_ALREADY_ANSWERED: "Esta avaliação já foi respondida. Obrigado!", CX_SURVEY_EXPIRED: "Este link venceu.", CX_RATE_LIMITED: "Recebemos muitas respostas deste aparelho. Tente mais tarde.", CX_SCORE_INVALID: "Escolha uma nota para enviar.", CX_SURVEY_UNAVAILABLE: "Esta pesquisa não está disponível." };

export function CustomerSurvey({ slug, token, source, store, survey, initialState }: { slug: string; token: string | null; source: string; store: any; survey: any; initialState: string }) {
  const [score, setScore] = useState<number | null>(null), [comment, setComment] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<any>(null);
  const question = (survey.questions || []).find((x: any) => x.id === "score")?.text || "Como foi sua experiência?", commentLabel = (survey.questions || []).find((x: any) => x.id === "comment")?.text || "Quer contar mais? (opcional)", values = RANGE[survey.scale] || RANGE["1-5"], ends = ENDS[survey.survey_type] || ENDS.csat;
  const style = store.accent_color ? ({ "--accent": store.accent_color } as CSSProperties) : undefined;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (score == null || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/customer-experience", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, token, source, score, comment }) }), body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setResult(body);
    } catch (reason: any) { setError(ERRORS[reason.message] || "Não foi possível enviar. Tente de novo."); } finally { setBusy(false); }
  }
  const brand = <div className="cx-survey-brand">{store.logo_url && <img src={store.logo_url} alt="" />}<strong>{store.name}</strong></div>;
  if (initialState !== "open") return <main className="cx-survey" style={style}><section className="cx-survey-card">{brand}<h1>{initialState === "answered" ? "Esta avaliação já foi respondida. Obrigado!" : "Este link venceu."}</h1></section></main>;
  if (result) return <main className="cx-survey" style={style}><section className="cx-survey-card" role="status">{brand}<h1>Obrigado pela sua resposta!</h1>{result.contact?.show && <p>{result.contact.text}</p>}{result.invite?.show && <><p className="cx-survey-note">Se quiser, conte sua experiência também em público.</p><a className="cx-survey-invite" href={result.invite.url} target="_blank" rel="noopener noreferrer">Avaliar em público</a></>}</section></main>;
  return <main className="cx-survey" style={style}><form className="cx-survey-card" onSubmit={send}>{brand}<h1 id="cx-question">{question}</h1>
    <div><div className="cx-survey-scale" data-size={values.length} role="group" aria-labelledby="cx-question">{values.map(value => <button type="button" key={value} aria-pressed={score === value} aria-label={`Nota ${value}`} onClick={() => setScore(value)}>{value}</button>)}</div><div className="cx-survey-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div></div>
    <label>{commentLabel}<textarea rows={3} maxLength={1000} value={comment} onChange={event => setComment(event.target.value)} /></label>
    {error && <p className="cx-survey-error" role="alert">{error}</p>}
    <button className="cx-survey-send" disabled={score == null || busy}>{busy ? "Enviando…" : "Enviar avaliação"}</button>
    <p className="cx-survey-note">Sua resposta vai para a equipe da loja. Evite colocar dados pessoais no comentário.</p>
  </form></main>;
}
