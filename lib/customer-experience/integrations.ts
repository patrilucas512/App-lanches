/* eslint-disable @typescript-eslint/no-explicit-any */
/* Contracts with the rest of the product. Data only here, so Reporting, Workspace and Data Platform can import it without cycles. */
import {CORRELATION_NOTICE} from "./core.ts";

const CX_DIMENSIONS=["date","store","channel"];
export const CX_REPORT_METRICS={
  survey_response_rate:{key:"survey_response_rate",label:"Taxa de resposta das pesquisas",unit:"percent",aggregation:"ratio",additive:false,dimensions:CX_DIMENSIONS},
  review_response_rate:{key:"review_response_rate",label:"Taxa de resposta a avaliações",unit:"percent",aggregation:"ratio",additive:false,dimensions:CX_DIMENSIONS},
  median_response_time:{key:"median_response_time",label:"Tempo mediano de resposta",unit:"hours",aggregation:"semantic",additive:false,dimensions:CX_DIMENSIONS},
  detractor_recovery_rate:{key:"detractor_recovery_rate",label:"Recuperação de detratores",unit:"percent",aggregation:"ratio",additive:false,dimensions:CX_DIMENSIONS},
  recovered_customer_repeat_rate:{key:"recovered_customer_repeat_rate",label:"Recompra após recuperação",unit:"percent",aggregation:"ratio",additive:false,dimensions:CX_DIMENSIONS},
  risk_signal_count:{key:"risk_signal_count",label:"Sinais de risco",unit:"count",aggregation:"count",additive:true,dimensions:CX_DIMENSIONS},
} as const;
export const CX_METRIC_DENOMINATORS={nps:"respostas NPS no período",csat:"respostas CSAT e notas de 1 a 5 no período",survey_response_rate:"pesquisas enviadas",review_response_rate:"avaliações públicas recebidas",median_response_time:"avaliações respondidas",detractor_recovery_rate:"casos de recuperação de detratores encerrados",recovered_customer_repeat_rate:"clientes com caso de recuperação",risk_signal_count:"sem denominador: contagem de sinais"} as const;
export const CX_REPORT_DATASETS=["cx_feedback","cx_survey_responses","external_reviews","review_responses","service_recovery_cases","cx_topics"] as const;
export const CX_REPORT_TEMPLATES=["NPS/CSAT por unidade","Temas de reclamação","Avaliações por item","Tempo de resposta","Recuperação de clientes","Avaliações externas","Sinais de risco"] as const;
export const CX_FACTS=["fact_cx_feedback","fact_cx_survey_responses","fact_cx_external_reviews","fact_cx_review_responses","fact_cx_recovery_cases","fact_cx_topics","fact_cx_risk_signals"] as const;
export const CX_WIDGETS=["cx_store_nps","cx_unanswered_reviews","cx_detractors_waiting","cx_open_risk_signals"] as const;
export const CX_AUTOMATION_TRIGGERS=["cx.feedback_received","cx.detractor_received","cx.risk_signal_detected","cx.public_review_unanswered","cx.nps_drop","cx.recovery_overdue"] as const;
// Automation can prepare work for a person. Publishing a response, refunding and changing a review are not on this list.
export const CX_SAFE_AUTOMATION_ACTIONS=["notify","create_recovery_case","create_occurrence","create_response_draft","add_to_recovery_journey"] as const;
export const CX_FORBIDDEN_ACTIONS=["publish_review_response","grant_refund","edit_review","delete_review","request_review_change"] as const;
export const CX_PLAN_ENTITLEMENTS={basico:["customer_experience_enabled","cx_surveys_enabled"],profissional:["customer_experience_enabled","cx_surveys_enabled"],premium:["customer_experience_enabled","cx_surveys_enabled","cx_external_reviews_enabled","cx_ai_sentiment_enabled","cx_ai_response_drafts_enabled","cx_service_recovery_enabled"],enterprise:["customer_experience_enabled","cx_surveys_enabled","cx_external_reviews_enabled","cx_ai_sentiment_enabled","cx_ai_response_drafts_enabled","cx_service_recovery_enabled"]} as const;
export const CX_COPILOT_TOOLS=["getReputationOverview","getStoreNps","getReviewInbox","getComplaintTopics","getItemFeedback","getRecoveryCases","draftReviewResponse","explainScoreChange"] as const;

const sampleText=(metric:any,label:string)=>metric?.status==="ok"?`${label}: ${metric.value} com ${metric.responses} resposta(s).`:metric?.status==="insufficient_sample"?`${label}: amostra insuficiente (${metric.responses} de ${metric.minimumSample} resposta(s)).`:`${label}: sem respostas no período.`;

// Read-only answer built from the dashboard data. It has no client to write with, which is the guarantee that it cannot publish, refund or edit.
export function cxCopilot(tool:string,data:any){
  if(!(CX_COPILOT_TOOLS as readonly string[]).includes(tool))throw new Error("TOOL_NOT_ALLOWED");
  const reputation=data?.reputation||{},topics=(data?.topics||[]).slice(0,5),findings=data?.rootCause?.findings||[],numbers=[sampleText(reputation.nps,"NPS"),sampleText(reputation.csat,"CSAT")],topicLines=topics.map((x:any)=>`${x.topic_key}: ${x.count} menção(ões)`),causes=findings.map((x:any)=>`${x.statement} (${JSON.stringify(x.volume)}, ${x.period.from} a ${x.period.to})`);
  const base={tool,situation:"",numbers,topics:topicLines,probableCauses:causes,causesNotice:CORRELATION_NOTICE,suggestedActions:[] as string[],canPublish:false,canRefund:false,canEditReview:false};
  if(tool==="getReviewInbox")return{...base,situation:`${data?.cards?.unanswered??0} avaliação(ões) sem resposta e ${data?.cards?.openRisks??0} sinal(is) de risco aguardando revisão.`,suggestedActions:["Revise primeiro os sinais de risco.","Responda as avaliações públicas com o prazo vencido."]};
  if(tool==="getRecoveryCases")return{...base,situation:`${data?.cards?.detractorsWaiting??0} detrator(es) sem retorno e ${data?.cards?.recoveriesDone??0} recuperação(ões) concluída(s).`,suggestedActions:["Priorize os casos com prazo vencido.","Não peça ao cliente para mudar a avaliação."]};
  if(tool==="getItemFeedback")return{...base,situation:"Itens com avaliações suficientes para comparar.",numbers:(data?.rootCause?.items||[]).slice(0,5).map((x:any)=>`${x.name}: média ${x.average} em escala de 0 a 1, ${x.responses} resposta(s).`)};
  if(tool==="draftReviewResponse")return{...base,situation:"Abra a avaliação na Caixa de Avaliações e use Criar rascunho. O texto segue para aprovação humana.",suggestedActions:["Revise o rascunho antes de aprovar."]};
  if(tool==="explainScoreChange"){const trend=data?.trend;return{...base,situation:trend?.status==="ok"?`O NPS variou ${trend.change} ponto(s), de ${trend.responses.previous} para ${trend.responses.current} resposta(s).`:"Amostra insuficiente para comparar os períodos.",suggestedActions:causes.length?["Confira os temas e os fatos operacionais ligados antes de concluir."]:["Colete mais respostas antes de concluir."]}}
  if(tool==="getComplaintTopics")return{...base,situation:topics.length?"Temas mais citados nas avaliações do período.":"Nenhum tema registrado no período."};
  return{...base,situation:`Reputação do período, com ${reputation.volume??0} avaliação(ões).`,suggestedActions:(data?.cards?.openRisks||0)>0?["Revise os sinais de risco abertos."]:[]};
}
