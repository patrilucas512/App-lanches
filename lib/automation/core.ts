/* eslint-disable @typescript-eslint/no-explicit-any */
export type RiskLevel="low"|"medium"|"high"|"critical";
export type WorkflowNodeType="trigger"|"condition"|"action"|"delay"|"approval"|"branch"|"stop";
export type WorkflowNode={id:string;node_type:WorkflowNodeType;config:Record<string,unknown>;position?:Record<string,number>};
export type WorkflowEdge={source_node_id:string;target_node_id:string;branch_key?:string|null};

export const FEATURE_MANAGEMENT_AUTOMATION_TRIGGERS=["feature.rollout_started","feature.rollout_paused","feature.rollout_health_degraded","feature.override_expiring","feature.override_expired","feature.kill_switch_activated","feature.cleanup_overdue"] as const;
export const FEATURE_MANAGEMENT_AUTOMATION_ACTIONS={pause_rollout:{risk:"high",permission:"feature_management:manage_rollouts",humanApproval:true},advance_rollout:{risk:"high",permission:"feature_management:manage_rollouts",humanApproval:true},rollback_rollout:{risk:"critical",permission:"feature_management:manage_rollouts",humanApproval:true},activate_kill_switch:{risk:"critical",permission:"feature_management:kill_switch",humanApproval:true},revoke_override:{risk:"high",permission:"feature_management:manage_overrides",humanApproval:true}} as const;

export const AUTOMATION_PERMISSIONS=["automation:view","automation:create","automation:edit","automation:publish","automation:pause","automation:execute_manual","automation:view_history","automation:manage_critical_actions","automation:manage_templates","automation:manage_network"] as const;
export const CONDITION_OPERATORS=["equals","not_equals","greater_than","less_than","contains","in","not_in","exists","boolean","date_before","date_after","time_window"] as const;
export const EVENT_REGISTRY={
  "order.created":{version:1,module:"orders",fields:{"order.id":"string","order.number":"string","order.total":"number","order.channel":"enum","store.id":"string"}},
  "order.delayed":{version:1,module:"orders",fields:{"order.id":"string","order.number":"string","order.delay_minutes":"number","store.id":"string"}},
  "order.completed":{version:1,module:"orders",fields:{"order.id":"string","customer.id":"string","store.id":"string"}},
  "inventory.low":{version:1,module:"inventory",fields:{"item.id":"string","item.name":"string","item.category":"string","item.stock":"number","item.minimum":"number","store.id":"string"}},
  "inventory.stockout_risk":{version:1,module:"inventory",fields:{"item.id":"string","item.stock":"number","item.risk":"enum","store.id":"string"}},
  "payment.failed":{version:1,module:"payments",sensitive:true,fields:{"payment.id":"string","payment.amount":"number","order.id":"string","store.id":"string"}},
  "payment.completed":{version:1,module:"payments",sensitive:true,fields:{"payment.id":"string","payment.amount":"number","order.id":"string","store.id":"string"}},
  "customer.inactive":{version:1,module:"crm",sensitive:true,fields:{"customer.id":"string","customer.days_inactive":"number","customer.segment":"string","store.id":"string"}},
  "customer.risk_changed":{version:1,module:"customer_success",sensitive:true,fields:{"customer.id":"string","customer.health":"enum","store.id":"string"}},
  "support.ticket_created":{version:1,module:"support",fields:{"ticket.id":"string","ticket.priority":"enum","store.id":"string"}},
  "support.sla_breached":{version:1,module:"support",fields:{"ticket.id":"string","ticket.minutes_overdue":"number","store.id":"string"}},
  "quality.nonconformity_created":{version:1,module:"quality",fields:{"nonconformity.id":"string","nonconformity.severity":"enum","store.id":"string"}},
  "quality.lot_blocked":{version:1,module:"quality",fields:{"lot.id":"string","item.id":"string","store.id":"string"}},
  "maintenance.asset_failed":{version:1,module:"assets",fields:{"asset.id":"string","asset.criticality":"enum","store.id":"string"}},
  "maintenance.work_order_overdue":{version:1,module:"assets",fields:{"work_order.id":"string","work_order.priority":"enum","store.id":"string"}},
  "document.expiring":{version:1,module:"documents",fields:{"document.id":"string","document.expires_at":"date","store.id":"string"}},
  "document.expired":{version:1,module:"documents",fields:{"document.id":"string","document.expires_at":"date","store.id":"string"}},
  "sales.opportunity_stalled":{version:1,module:"sales",fields:{"opportunity.id":"string","opportunity.days_stalled":"number","store.id":"string"}},
  "cs.health_changed":{version:1,module:"customer_success",fields:{"customer.id":"string","customer.health":"enum","store.id":"string"}},
  "security.incident_created":{version:1,module:"security",sensitive:true,fields:{"incident.id":"string","incident.severity":"enum","store.id":"string"}},
  "release.failed":{version:1,module:"operations",fields:{"release.id":"string","release.environment":"enum"}},
  "delivery.delayed":{version:1,module:"delivery",fields:{"delivery.id":"string","delivery.delay_minutes":"number","store.id":"string"}},
  "kitchen.overload":{version:1,module:"kitchen",fields:{"kitchen.active_orders":"number","kitchen.capacity":"number","store.id":"string"}},
  "reservation.no_show":{version:1,module:"dining",fields:{"reservation.id":"string","customer.id":"string","store.id":"string"}},
  "franchise.period_ready":{version:1,module:"franchise_finance",sensitive:true,fields:{"organization.id":"string","profile.id":"string","period.id":"string"}},
  "franchise.assessment_approved":{version:1,module:"franchise_finance",sensitive:true,fields:{"profile.id":"string","assessment.id":"string","assessment.amount":"number"}},
  "franchise.settlement_issued":{version:1,module:"franchise_finance",sensitive:true,fields:{"profile.id":"string","settlement.id":"string","settlement.amount":"number"}},
  "franchise.settlement_overdue":{version:1,module:"franchise_finance",sensitive:true,fields:{"profile.id":"string","settlement.id":"string","settlement.due_date":"date"}},
  "franchise.payment_received":{version:1,module:"franchise_finance",sensitive:true,fields:{"profile.id":"string","settlement.id":"string","payment.amount":"number"}},
  "franchise.dispute_opened":{version:1,module:"franchise_finance",sensitive:true,fields:{"profile.id":"string","dispute.id":"string"}},
  "opening.project_created":{version:1,module:"store_opening",fields:{"organization.id":"string","opening.project_id":"string"}},
  "opening.blocker_created":{version:1,module:"store_opening",fields:{"opening.project_id":"string","blocker.id":"string","blocker.severity":"enum"}},
  "opening.milestone_completed":{version:1,module:"store_opening",fields:{"opening.project_id":"string","milestone.id":"string"}},
  "opening.go_live_ready":{version:1,module:"store_opening",fields:{"opening.project_id":"string"}},
  "opening.go_live_failed":{version:1,module:"store_opening",sensitive:true,fields:{"opening.project_id":"string","execution.id":"string","execution.failed_step":"string"}},
  "opening.store_live":{version:1,module:"store_opening",fields:{"opening.project_id":"string","store.id":"string"}},
  "geo.territory_conflict":{version:1,module:"geo_management",sensitive:true,fields:{"territory.id":"string","conflict.severity":"enum"}},
  "geo.service_area_changed":{version:1,module:"geo_management",fields:{"service_area.id":"string","store.id":"string"}},
  "geo.address_unserviceable":{version:1,module:"geo_management",sensitive:true,fields:{"store.id":"string","address.city":"string"}},
  "geo.provider_degraded":{version:1,module:"geo_management",fields:{"provider.key":"string","provider.status":"enum"}},
  "geo.delivery_gap_detected":{version:1,module:"geo_management",sensitive:true,fields:{"region.key":"string","gap.volume":"number"}}
  ,"audit.scheduled":{version:1,module:"operational_audit",fields:{"audit.id":"string","audit.scheduled_for":"date"}}
  ,"audit.overdue":{version:1,module:"operational_audit",fields:{"audit.id":"string","store.id":"string"}}
  ,"audit.completed":{version:1,module:"operational_audit",fields:{"audit.id":"string","audit.result":"enum"}}
  ,"audit.critical_finding_created":{version:1,module:"operational_audit",sensitive:true,fields:{"audit.id":"string","finding.id":"string","finding.severity":"enum"}}
  ,"audit.finding_overdue":{version:1,module:"operational_audit",fields:{"finding.id":"string","finding.due_at":"date"}}
  ,"audit.finding_verified":{version:1,module:"operational_audit",fields:{"finding.id":"string","verification.id":"string"}}
  ,"knowledge.article_published":{version:1,module:"knowledge_base",fields:{"article.id":"string","article.version":"number"}}
  ,"knowledge.article_major_updated":{version:1,module:"knowledge_base",fields:{"article.id":"string","article.version":"number"}}
  ,"knowledge.review_due":{version:1,module:"knowledge_base",fields:{"article.id":"string","article.next_review_at":"date"}}
  ,"knowledge.source_stale":{version:1,module:"knowledge_base",fields:{"article.id":"string","source.id":"string"}}
  ,"knowledge.gap_detected":{version:1,module:"knowledge_base",fields:{"gap.id":"string","gap.occurrence_count":"number"}}
  ,"production.requisition_submitted":{version:1,module:"central_production",fields:{"requisition.id":"string","store.id":"string","production_unit.id":"string"}}
  ,"production.material_shortage":{version:1,module:"central_production",fields:{"production_order.id":"string","item.id":"string","shortage.quantity":"number"}}
  ,"production.order_completed":{version:1,module:"central_production",fields:{"production_order.id":"string","batch.id":"string","actual.quantity":"number"}}
  ,"production.batch_quality_hold":{version:1,module:"central_production",fields:{"batch.id":"string","lot.id":"string","production_unit.id":"string"}}
  ,"transfer.dispatched":{version:1,module:"central_production",fields:{"transfer.id":"string","source.id":"string","destination.id":"string"}}
  ,"transfer.delayed":{version:1,module:"central_production",fields:{"transfer.id":"string","delay.minutes":"number","destination.id":"string"}}
  ,"transfer.discrepancy_created":{version:1,module:"central_production",fields:{"transfer.id":"string","discrepancy.id":"string","discrepancy.type":"enum"}}
  ,"transfer.received":{version:1,module:"central_production",fields:{"transfer.id":"string","receipt.id":"string","destination.id":"string"}}
  ,"supply.projected_stockout":{version:1,module:"supply_chain_planning",fields:{"item.id":"string","node.id":"string","risk.severity":"enum","projected.quantity":"number"}}
  ,"supply.excess_detected":{version:1,module:"supply_chain_planning",fields:{"item.id":"string","node.id":"string","excess.quantity":"number","expiry.risk":"enum"}}
  ,"supply.supplier_delay":{version:1,module:"supply_chain_planning",fields:{"supplier.id":"string","destination.id":"string","delay.hours":"number"}}
  ,"supply.production_shortfall":{version:1,module:"supply_chain_planning",fields:{"production_unit.id":"string","item.id":"string","shortage.quantity":"number"}}
  ,"supply.recommendation_created":{version:1,module:"supply_chain_planning",fields:{"recommendation.id":"string","recommendation.type":"enum","item.id":"string","destination.id":"string"}}
  ,"supply.service_level_below_target":{version:1,module:"supply_chain_planning",fields:{"node.id":"string","service.metric":"enum","service.value":"number","service.target":"number"}}
} as const;

export const ACTION_REGISTRY={
  send_notification:{risk:"low",module:"notifications",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:30}},
  create_internal_task:{risk:"low",module:"internal_work",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:30}},
  create_support_ticket:{risk:"low",module:"support",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:60}},
  create_recovery_case:{risk:"medium",module:"customer_success",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  create_purchase_order_draft:{risk:"medium",module:"procurement",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  create_campaign_draft:{risk:"medium",module:"marketing",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  assign_owner:{risk:"medium",module:"operations",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:60}},
  update_tag:{risk:"low",module:"crm",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:30}},
  add_customer_to_segment:{risk:"medium",module:"crm",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:60}},
  create_attention_item:{risk:"low",module:"executive",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:30}},
  request_approval:{risk:"medium",module:"approvals",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:60}},
  send_email:{risk:"medium",module:"notifications",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:120}},
  send_whatsapp_template:{risk:"medium",module:"whatsapp",permission:"automation:edit",idempotent:true,retry:{max:3,backoffSeconds:120}},
  create_document_renewal:{risk:"medium",module:"documents",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  create_maintenance_work_order:{risk:"medium",module:"assets",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  create_quality_nonconformity:{risk:"medium",module:"quality",permission:"automation:edit",idempotent:true,retry:{max:2,backoffSeconds:120}},
  pause_campaign:{risk:"high",module:"marketing",permission:"automation:manage_critical_actions",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true},
  pause_channel:{risk:"high",module:"operations",permission:"automation:manage_critical_actions",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true},
  assign_driver:{risk:"high",module:"delivery",permission:"automation:manage_critical_actions",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true},
  reprioritize_order:{risk:"high",module:"orders",permission:"automation:manage_critical_actions",idempotent:true,retry:{max:1,backoffSeconds:30},actionEngine:true},
  send_registered_webhook:{risk:"high",module:"integrations",permission:"automation:manage_critical_actions",idempotent:true,retry:{max:3,backoffSeconds:300},registeredDestinationOnly:true}
  ,run_report:{risk:"low",module:"reporting",permission:"reports:view",idempotent:true,retry:{max:3,backoffSeconds:60}}
  ,create_report_snapshot:{risk:"medium",module:"reporting",permission:"reports:create",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,send_report_notification:{risk:"medium",module:"reporting",permission:"reports:schedule",idempotent:true,retry:{max:3,backoffSeconds:120}}
  ,send_journey_message:{risk:"medium",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:3,backoffSeconds:120}}
  ,issue_journey_offer:{risk:"high",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,journey_add_tag:{risk:"low",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,journey_remove_tag:{risk:"low",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,journey_create_task:{risk:"low",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,journey_request_feedback:{risk:"medium",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:3,backoffSeconds:120}}
  ,journey_loyalty_action:{risk:"high",module:"customer_journeys",permission:"journeys:publish",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,catalog_notify_manager:{risk:"low",module:"catalog_management",permission:"catalog:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,catalog_create_task:{risk:"low",module:"catalog_management",permission:"catalog:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,catalog_create_approval_request:{risk:"high",module:"catalog_management",permission:"catalog:publish",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,catalog_create_attention_item:{risk:"low",module:"catalog_management",permission:"catalog:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,capacity_notify_manager:{risk:"low",module:"capacity_management",permission:"capacity:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,capacity_create_task:{risk:"low",module:"capacity_management",permission:"capacity:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,capacity_create_attention_item:{risk:"low",module:"capacity_management",permission:"capacity:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,capacity_create_incident_candidate:{risk:"medium",module:"capacity_management",permission:"capacity:manage_policies",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,capacity_apply_policy_action:{risk:"high",module:"capacity_management",permission:"capacity:pause_channels",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,franchise_notify_finance:{risk:"low",module:"franchise_finance",permission:"franchise_finance:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,franchise_create_task:{risk:"low",module:"franchise_finance",permission:"franchise_finance:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,franchise_create_approval:{risk:"high",module:"franchise_finance",permission:"franchise_finance:approve",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,franchise_generate_statement:{risk:"medium",module:"franchise_finance",permission:"franchise_finance:export",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,franchise_create_attention_item:{risk:"low",module:"franchise_finance",permission:"franchise_finance:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,opening_notify_owner:{risk:"low",module:"store_opening",permission:"opening:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,opening_create_task:{risk:"low",module:"store_opening",permission:"opening:manage_project",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,opening_request_approval:{risk:"high",module:"store_opening",permission:"opening:approve_go_live",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,opening_create_communication_draft:{risk:"medium",module:"store_opening",permission:"opening:manage_project",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,opening_create_incident_candidate:{risk:"high",module:"store_opening",permission:"opening:execute_go_live",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,opening_update_attention_item:{risk:"low",module:"store_opening",permission:"opening:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,geo_notify_manager:{risk:"low",module:"geo_management",permission:"geo:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,geo_create_task:{risk:"low",module:"geo_management",permission:"geo:manage_territories",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,geo_request_approval:{risk:"high",module:"geo_management",permission:"geo:publish_territories",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,geo_create_attention_item:{risk:"low",module:"geo_management",permission:"geo:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,audit_notify_owner:{risk:"low",module:"operational_audit",permission:"audits:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,audit_create_task:{risk:"low",module:"operational_audit",permission:"audits:manage_findings",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,audit_create_work_order:{risk:"medium",module:"operational_audit",permission:"audits:manage_findings",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,audit_create_nonconformity:{risk:"medium",module:"operational_audit",permission:"audits:manage_findings",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,audit_create_incident_candidate:{risk:"high",module:"operational_audit",permission:"audits:manage_findings",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,audit_create_attention_item:{risk:"low",module:"operational_audit",permission:"audits:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,audit_create_communication_draft:{risk:"medium",module:"operational_audit",permission:"audits:manage_findings",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,knowledge_notify_owner:{risk:"low",module:"knowledge_base",permission:"knowledge:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,knowledge_create_task:{risk:"low",module:"knowledge_base",permission:"knowledge:edit",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,knowledge_create_communication_draft:{risk:"medium",module:"knowledge_base",permission:"knowledge:edit",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,knowledge_create_training_review_task:{risk:"medium",module:"knowledge_base",permission:"knowledge:edit",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,knowledge_request_approval:{risk:"high",module:"knowledge_base",permission:"knowledge:publish",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,marketplace_sync_catalog_preview:{risk:"low",module:"marketplace_integrations",permission:"marketplaces:sync_catalog",idempotent:true,retry:{max:3,backoffSeconds:60}}
  ,marketplace_pause_channel:{risk:"high",module:"marketplace_integrations",permission:"marketplaces:manage_settings",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,marketplace_reprocess_order:{risk:"high",module:"marketplace_integrations",permission:"marketplaces:manage_orders",idempotent:true,retry:{max:3,backoffSeconds:120},actionEngine:true}
  ,production_notify:{risk:"low",module:"central_production",permission:"central_production:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,production_create_task:{risk:"low",module:"central_production",permission:"central_production:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,production_create_procurement_recommendation:{risk:"medium",module:"central_production",permission:"central_production:plan",idempotent:true,retry:{max:2,backoffSeconds:120}}
  ,production_create_attention_item:{risk:"low",module:"central_production",permission:"central_production:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,production_create_incident_candidate:{risk:"medium",module:"central_production",permission:"central_production:manage_settings",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,production_request_approval:{risk:"medium",module:"central_production",permission:"central_production:plan",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,production_release_order:{risk:"high",module:"central_production",permission:"central_production:release_order",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,production_dispatch_transfer:{risk:"high",module:"central_production",permission:"central_production:dispatch",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,production_release_quality_batch:{risk:"critical",module:"central_production",permission:"quality:release_lot",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,supply_notify:{risk:"low",module:"supply_chain_planning",permission:"supply_chain:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,supply_create_task:{risk:"low",module:"supply_chain_planning",permission:"supply_chain:view",idempotent:true,retry:{max:3,backoffSeconds:30}}
  ,supply_request_approval:{risk:"medium",module:"supply_chain_planning",permission:"supply_chain:review_recommendations",idempotent:true,retry:{max:2,backoffSeconds:120},actionEngine:true}
  ,supply_prepare_purchase_draft:{risk:"high",module:"supply_chain_planning",permission:"supply_chain:approve_recommendations",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,supply_prepare_transfer_draft:{risk:"high",module:"supply_chain_planning",permission:"supply_chain:approve_recommendations",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
  ,supply_prepare_production_draft:{risk:"high",module:"supply_chain_planning",permission:"supply_chain:approve_recommendations",idempotent:true,retry:{max:1,backoffSeconds:60},actionEngine:true}
} as const;

const get=(obj:Record<string,unknown>,path:string)=>path.split(".").reduce<unknown>((v,k)=>v&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,obj);
export function evaluateCondition(condition:any,context:Record<string,unknown>):boolean{const value=get(context,String(condition.field||"")),target=condition.value;switch(condition.operator){case"equals":return value===target;case"not_equals":return value!==target;case"greater_than":return Number(value)>Number(target);case"less_than":return Number(value)<Number(target);case"contains":return Array.isArray(value)?value.includes(target):String(value??"").includes(String(target));case"in":return Array.isArray(target)&&target.includes(value);case"not_in":return Array.isArray(target)&&!target.includes(value);case"exists":return value!==null&&value!==undefined;case"boolean":return Boolean(value)===Boolean(target);case"date_before":return new Date(String(value)).getTime()<new Date(String(target)).getTime();case"date_after":return new Date(String(value)).getTime()>new Date(String(target)).getTime();case"time_window":{const h=new Date(String(value)).getUTCHours(),a=Number(target?.start),b=Number(target?.end);return a<=b?h>=a&&h<=b:h>=a||h<=b}default:return false}}
export function evaluateGroup(group:any,context:Record<string,unknown>){const results=(group.conditions||[]).map((c:any)=>c.conditions?evaluateGroup(c,context):evaluateCondition(c,context));return String(group.combinator||"AND").toUpperCase()==="OR"?results.some(Boolean):results.every(Boolean)}
export function validateGraph(nodes:WorkflowNode[],edges:WorkflowEdge[]){const errors:string[]=[];const ids=new Set(nodes.map(n=>n.id)),triggers=nodes.filter(n=>n.node_type==="trigger");if(triggers.length!==1)errors.push("O workflow precisa de exatamente um trigger.");for(const n of nodes){if(n.node_type==="action"&&!String(n.config.action_type||""))errors.push(`Ação ${n.id} sem configuração.`);if(n.node_type!=="trigger"&&!edges.some(e=>e.target_node_id===n.id))errors.push(`Nó órfão: ${n.id}.`)}for(const e of edges)if(!ids.has(e.source_node_id)||!ids.has(e.target_node_id))errors.push("Edge referencia nó inexistente.");const visiting=new Set<string>(),done=new Set<string>();const walk=(id:string)=>{if(visiting.has(id)){errors.push("Loops não são permitidos.");return}if(done.has(id))return;visiting.add(id);for(const e of edges.filter(x=>x.source_node_id===id))walk(e.target_node_id);visiting.delete(id);done.add(id)};if(triggers[0])walk(triggers[0].id);return{valid:errors.length===0,errors}}
export function validateTriggerConfig(config:any){if(config.kind==="event")return Boolean((EVENT_REGISTRY as any)[config.event_name]);if(config.kind==="schedule")return["daily","weekly","monthly","specific_datetime"].includes(config.schedule_type);if(config.kind==="manual")return true;if(config.kind==="webhook")return Boolean(config.integration_id)&&!config.url;return false}
export function redactPayload(value:any):any{if(Array.isArray(value))return value.map(redactPayload);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[/password|secret|token|authorization|cpf|card|email|phone/i.test(k)?k:k,/password|secret|token|authorization|cpf|card|email|phone/i.test(k)?"[REDACTED]":redactPayload(v)]));return value}
export function executionKey(workflowVersionId:string,eventId:string){return`${workflowVersionId}:${eventId}`}
export function actionKey(executionId:string,nodeId:string){return`${executionId}:${nodeId}`}
export function recursionAllowed(depth:number,originWorkflowId:string|null,currentWorkflowId:string,maxDepth=5){return depth<maxDepth&&(!originWorkflowId||originWorkflowId!==currentWorkflowId)}
export function shouldCircuitBreak(runsLastHour:number,failuresLastHour:number,limit=1000,failureRate=.5){return runsLastHour>limit||(runsLastHour>=20&&failuresLastHour/runsLastHour>=failureRate)}
export const AutomationCopilotTools=["getWorkflows","getWorkflowHealth","getFailedExecutions","getAutomationUsage","getRecentExecutions"] as const;
export const forbiddenAutomationCapabilities=["eval","custom_javascript","arbitrary_sql","arbitrary_http","plaintext_secret","automatic_financial_transfer","automatic_refund"] as const;

export const WMS_AUTOMATION_TRIGGERS=["wms.receiving_arrived","wms.receiving_discrepancy","wms.putaway_overdue","wms.pick_short","wms.wave_completed","wms.packing_failed","wms.shipment_handed_off","wms.count_variance","wms.location_locked","wms.offline_conflict"] as const;
export const WMS_AUTOMATION_ACTIONS=["wms_create_task","wms_assign_task","wms_create_exception","wms_notify_team","wms_request_recount","wms_prepare_adjustment_approval","wms_print_label","wms_refresh_location_read_model"] as const;
export const TRANSPORT_AUTOMATION_TRIGGERS=["transport.load_ready","transport.trip_dispatched","transport.stop_arrived","transport.pod_recorded","transport.occurrence_reported","transport.trip_delayed","transport.cost_divergence","transport.offline_conflict"] as const;
export const TRANSPORT_AUTOMATION_ACTIONS=["transport_notify_team","transport_create_task","transport_request_approval","transport_create_incident_candidate","transport_prepare_route_review","transport_prepare_cost_review"] as const;
export const IBP_AUTOMATION_TRIGGERS=['ibp.cycle_started','ibp.demand_review_completed','ibp.critical_constraint_detected','ibp.plan_submitted','ibp.plan_approved','ibp.plan_published','ibp.variance_threshold_breached']as const;
export const MDM_AUTOMATION_TRIGGERS=['mdm.duplicate_candidate_detected','mdm.identifier_conflict','mdm.critical_quality_issue','mdm.merge_completed','mdm.reconciliation_failed','mdm.change_request_submitted']as const;
export const DATA_GOVERNANCE_AUTOMATION_TRIGGERS=['data.contract_breaking_change_detected','data.schema_drift_detected','data.freshness_slo_breached','data.quality_check_failed','data.incident_candidate_created','data.asset_deprecated']as const;
export const DATA_GOVERNANCE_AUTOMATION_ACTIONS=['data_governance_notify_owner','data_governance_create_task','data_governance_request_review','data_governance_create_incident_candidate','data_governance_prepare_documentation_draft']as const;
export const ENTERPRISE_RISK_AUTOMATION_TRIGGERS=['risk.became_critical','risk.outside_appetite','risk.review_due','risk.control_failed','risk.treatment_overdue','risk.acceptance_expiring','risk.kri_breached','risk.third_party_critical']as const;
export const ENTERPRISE_RISK_AUTOMATION_ACTIONS=['risk_notify','risk_create_task','risk_request_review','risk_create_treatment_draft','risk_create_incident_candidate']as const;
export const CHANGE_MANAGEMENT_AUTOMATION_TRIGGERS=['change.created','change.approval_required','change.conflict_detected','change.started','change.validation_failed','change.rollback_started','change.completed','change.emergency_created','change.review_overdue']as const;
export const CHANGE_MANAGEMENT_AUTOMATION_ACTIONS=['change_notify','change_create_task','change_request_approval','change_create_incident_candidate','change_schedule_post_review']as const;
export const PROCESS_INTELLIGENCE_AUTOMATION_TRIGGERS=['process.coverage_degraded','process.bottleneck_detected','process.rework_spike','process.major_deviation','process.analysis_completed','process.improvement_accepted']as const;
export const PROCESS_INTELLIGENCE_AUTOMATION_ACTIONS=['process_notify_owner','process_create_review_task','process_create_improvement_draft','process_request_data_quality_review','process_create_change_draft']as const;
export const ENTERPRISE_ARCHITECTURE_AUTOMATION_TRIGGERS=['architecture.critical_gap_detected','architecture.deprecated_system_in_use','architecture.single_dependency_exposure','architecture.owner_missing','architecture.standard_violation','architecture.review_due','architecture.drift_detected']as const;
export const ENTERPRISE_ARCHITECTURE_AUTOMATION_ACTIONS=['architecture_notify_owner','architecture_create_task','architecture_request_review','architecture_create_risk_candidate','architecture_create_change_draft']as const;
export const IBP_AUTOMATION_ACTIONS=['ibp_notify','ibp_create_task','ibp_request_approval','ibp_create_meeting_agenda_draft','ibp_create_attention_item','ibp_create_execution_draft']as const;
