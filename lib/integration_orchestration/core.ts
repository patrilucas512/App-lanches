import { createHash } from "node:crypto";

export const CONNECTOR_CATEGORIES=["erp","accounting","crm","fiscal","supplier","hr","marketplace","payments","logistics","commerce","generic","internal","messaging","storage","file_transfer","custom_approved"]as const;
export const CONNECTOR_TYPES=["rest_api","webhook","oauth_api","file_import","file_export","sftp","queue","event_bus","database_readonly_adapter","custom_managed_connector"]as const;
export const AUTH_TYPES=["none","api_key_ref","bearer_ref","oauth2_ref","basic_ref","mtls_ref","ssh_key_ref","managed_secret_ref","webhook_signature_ref"]as const;
export const FLOW_TRIGGERS=["event","schedule","webhook","polling","file_arrival","manual_preview"]as const;
export const NODE_TYPES=["trigger","contract_validate","map","transform","mdm_resolve","filter","route","connector_action","action_intent","reconcile","delay_bounded","end"]as const;
export const TRANSFORMATIONS=["rename","pick","omit","constant","coalesce","concat","split","trim","lowercase","uppercase","date_format","number_format","boolean_cast","lookup_table","enum_map","default","mask","hash","array_map_fields"]as const;
export const RUN_STATUSES=["queued","running","succeeded","partially_succeeded","failed","dead_lettered","cancelled","timed_out","reconciling"]as const;
export const ERROR_CATEGORIES=["validation","authentication","authorization","rate_limit","timeout","network","contract","mapping","identity","conflict","provider","policy","internal"]as const;
export const INTEGRATION_ORCHESTRATION_PERMISSIONS=["integration_orchestration:view","integration_orchestration:manage_connectors","integration_orchestration:manage_connections","integration_orchestration:manage_flows","integration_orchestration:publish_flows","integration_orchestration:execute_preview","integration_orchestration:replay_dlq","integration_orchestration:run_reconciliation","integration_orchestration:manage_governance","integration_orchestration:view_sensitive_metadata"]as const;
export const COPILOT_TOOLS=["getIntegrationHealth","getFlowRun","explainIntegrationFailure","previewMapping","getDLQItems","previewDLQReplay","getReconciliationStatus","analyzeFlowImpact"]as const;
export const REPORT_DATASETS=["integration_connectors","integration_connections","integration_flows","integration_runs","integration_run_steps","integration_dead_letters","integration_reconciliation","integration_health","integration_costs"]as const;
export const OBSERVABILITY_METRICS=["integration_run_latency","integration_run_success_rate","integration_step_error_rate","integration_retry_count","integration_dlq_depth","integration_reconciliation_mismatch","integration_connector_health","integration_circuit_state","integration_rate_limit_wait","integration_payload_bytes"]as const;

type NodeType=typeof NODE_TYPES[number];
type TransformType=typeof TRANSFORMATIONS[number];
export type FlowNode={id:string;type:NodeType;config:Record<string,unknown>;contractVersion?:string};
export type FlowEdge={from:string;to:string;condition?:"success"|"failure"|"always"|"matched"|"unmatched"};
export type FlowDefinition={nodes:FlowNode[];edges:FlowEdge[];maxRuntimeSeconds?:number;maxSteps?:number};
const stable=(value:unknown):string=>{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;return JSON.stringify(value)};
export const stableHash=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");

export class ConnectorRegistryService{
 register(input:{key:string;name:string;category:string;authType:string;capabilities:string[];allowedHosts?:string[];schemaVersion:string;connectorType?:string;provider?:string;riskLevel?:"low"|"medium"|"high"|"critical"}){if(!/^[a-z][a-z0-9_.-]{2,79}$/.test(input.key))throw new Error("INVALID_CONNECTOR_KEY");if(!CONNECTOR_CATEGORIES.includes(input.category as never))throw new Error("CONNECTOR_CATEGORY_NOT_ALLOWED");if(!AUTH_TYPES.includes(input.authType as never))throw new Error("CONNECTOR_AUTH_NOT_ALLOWED");const connectorType=input.connectorType||"rest_api";if(!CONNECTOR_TYPES.includes(connectorType as never))throw new Error("CONNECTOR_TYPE_NOT_ALLOWED");if(!input.schemaVersion||!input.capabilities.length)throw new Error("CONNECTOR_CONTRACT_REQUIRED");const hosts=[...new Set(input.allowedHosts||[])].map(x=>x.trim().toLowerCase()).filter(Boolean);if(["custom_approved","generic"].includes(input.category)&&!hosts.length)throw new Error("CONNECTOR_ALLOWLIST_REQUIRED");return{...input,connectorType,provider:input.provider||input.key.split(".")[0],riskLevel:input.riskLevel||"medium",allowedHosts:hosts,status:"draft",credentialsStored:false,arbitraryHttpAllowed:false,versionImmutableAfterPublish:true}}
}

export class IntegrationConnectionTestService{
 test(input:{authReferencePresent:boolean;connectivity:boolean;requiredScopes:string[];grantedScopes:string[];requiredCapabilities:string[];availableCapabilities:string[];providerStatus:"healthy"|"degraded"|"unavailable";environment:"development"|"staging"|"production"}){const missingScopes=input.requiredScopes.filter(x=>!input.grantedScopes.includes(x)),missingCapabilities=input.requiredCapabilities.filter(x=>!input.availableCapabilities.includes(x)),checks={auth:input.authReferencePresent,connectivity:input.connectivity,scopes:missingScopes.length===0,capabilities:missingCapabilities.length===0,provider:input.providerStatus!=="unavailable"};return{status:Object.values(checks).every(Boolean)?input.providerStatus==="degraded"?"degraded":"healthy":"failing",checks,missingScopes,missingCapabilities,writeTestExecuted:false,credentialReturned:false,environment:input.environment}}
}
export class IntegrationConnectionHealthService{
 derive(samples:Array<{ok:boolean;latencyMs:number;at:string}>,disconnected=false){if(disconnected)return{status:"disconnected",availability:0,latencyP95Ms:null};if(!samples.length)return{status:"unknown",availability:null,latencyP95Ms:null};const availability=Math.round(samples.filter(x=>x.ok).length/samples.length*10000)/100,latencies=samples.map(x=>x.latencyMs).sort((a,b)=>a-b),latencyP95Ms=latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))];return{status:availability>=99?"healthy":availability>=90?"degraded":"failing",availability,latencyP95Ms}}
}

export class IntegrationFlowValidationService{
 validate(definition:FlowDefinition){const errors:string[]=[],ids=new Set<string>();if(!definition.nodes.length)errors.push("FLOW_EMPTY");for(const node of definition.nodes){if(ids.has(node.id))errors.push(`DUPLICATE_NODE:${node.id}`);ids.add(node.id);if(!NODE_TYPES.includes(node.type))errors.push(`NODE_TYPE_NOT_ALLOWED:${node.type}`);const serialized=JSON.stringify(node.config).toLowerCase();if(/javascript:|\beval\b|\bsql\b|\bshell\b|\bexec\b|https?:\/\//.test(serialized))errors.push(`ARBITRARY_EXECUTION_BLOCKED:${node.id}`)}for(const edge of definition.edges)if(!ids.has(edge.from)||!ids.has(edge.to))errors.push(`INVALID_EDGE:${edge.from}:${edge.to}`);const incoming=new Map([...ids].map(x=>[x,0]));for(const e of definition.edges)incoming.set(e.to,(incoming.get(e.to)||0)+1);const queue=[...incoming].filter(([,n])=>n===0).map(([id])=>id),visited:string[]=[];while(queue.length){const id=queue.shift()!;visited.push(id);for(const e of definition.edges.filter(x=>x.from===id)){incoming.set(e.to,(incoming.get(e.to)||0)-1);if(incoming.get(e.to)===0)queue.push(e.to)}}if(visited.length!==ids.size)errors.push("FLOW_CYCLE_BLOCKED");if(definition.nodes.filter(x=>x.type==="trigger").length!==1)errors.push("SINGLE_TRIGGER_REQUIRED");const maxSteps=definition.maxSteps??100,maxRuntimeSeconds=definition.maxRuntimeSeconds??300;if(maxSteps<1||maxSteps>500)errors.push("MAX_STEPS_OUT_OF_RANGE");if(maxRuntimeSeconds<1||maxRuntimeSeconds>3600)errors.push("MAX_RUNTIME_OUT_OF_RANGE");return{valid:errors.length===0,errors,topologicalOrder:visited,maxSteps,maxRuntimeSeconds,definitionHash:stableHash(definition),sideEffectsExecuted:0}}
 impact(before:FlowDefinition,after:FlowDefinition){const beforeNodes=new Map(before.nodes.map(x=>[x.id,x])),afterNodes=new Map(after.nodes.map(x=>[x.id,x]));const added=[...afterNodes.keys()].filter(x=>!beforeNodes.has(x)),removed=[...beforeNodes.keys()].filter(x=>!afterNodes.has(x)),changed=[...afterNodes].filter(([id,n])=>beforeNodes.has(id)&&stableHash(beforeNodes.get(id))!==stableHash(n)).map(([id])=>id);return{added,removed,changed,breaking:removed.length>0||changed.some(id=>beforeNodes.get(id)?.type==="contract_validate"),requiresContractCheck:true,requiresApproval:removed.length+changed.length>0}}
}

export class SafeTransformationService{
 apply(type:TransformType,value:unknown,config:Record<string,unknown>={}){if(!TRANSFORMATIONS.includes(type))throw new Error("TRANSFORMATION_NOT_ALLOWED");switch(type){case"trim":return String(value??"").trim();case"lowercase":return String(value??"").toLowerCase();case"uppercase":return String(value??"").toUpperCase();case"default":return value??config.value;case"constant":return config.value;case"coalesce":return [value,...(Array.isArray(config.values)?config.values:[])].find(x=>x!==null&&x!==undefined);case"concat":return [value,...(Array.isArray(config.values)?config.values:[])].join(String(config.separator??""));case"split":return String(value??"").split(String(config.separator??","));case"boolean_cast":return [true,"true","1",1,"yes","sim"].includes(value as never);case"number_format":{const n=Number(value);if(!Number.isFinite(n))throw new Error("INVALID_NUMBER");return Number(n.toFixed(Math.min(6,Math.max(0,Number(config.decimals??2)))))}case"date_format":{const d=new Date(String(value));if(!Number.isFinite(d.getTime()))throw new Error("INVALID_DATE");return d.toISOString()}case"enum_map":case"lookup_table":{const table=(config.table||{})as Record<string,unknown>;const key=String(value);if(!(key in table)&&!("default" in config))throw new Error("LOOKUP_MISS");return table[key]??config.default}case"mask":return String(value??"").replace(/.(?=.{4})/g,"*");case"hash":return createHash("sha256").update(String(value??"")).digest("hex");case"rename":case"pick":case"omit":case"array_map_fields":throw new Error("OBJECT_TRANSFORMATION_REQUIRES_MAPPING_SERVICE")}}
}

export type FieldMapping={source:string;target:string;required?:boolean;transform?:TransformType;config?:Record<string,unknown>};
export class IntegrationMappingService{
 map(input:Record<string,unknown>,mappings:FieldMapping[]){const out:Record<string,unknown>={},errors:string[]=[];for(const m of mappings){const raw=m.source.split(".").reduce<unknown>((v,k)=>v&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,input);if((raw===undefined||raw===null)&&m.required){errors.push(`${m.source}:required`);continue}try{out[m.target]=m.transform?new SafeTransformationService().apply(m.transform,raw,m.config):raw}catch(error){errors.push(`${m.source}:${error instanceof Error?error.message:"transform_failed"}`)}}return{valid:errors.length===0,output:out,errors,inputMutated:false,mappingHash:stableHash(mappings)}}
}

export class IntegrationRoutingService{
 select(routes:Array<{id:string;priority:number;enabled:boolean;predicate:{field:string;operator:"eq"|"in"|"exists";value?:unknown}}>,payload:Record<string,unknown>){const matched=routes.filter(x=>x.enabled).sort((a,b)=>a.priority-b.priority).filter(r=>{const v=payload[r.predicate.field];return r.predicate.operator==="exists"?v!==undefined:r.predicate.operator==="in"&&Array.isArray(r.predicate.value)?r.predicate.value.includes(v):v===r.predicate.value});return{route:matched[0]?.id||null,ambiguous:matched.length>1&&matched[0].priority===matched[1].priority,evaluated:routes.length,externalCall:false}}
}

export class IntegrationConflictResolutionService{
 resolve(input:{organizationId:string;sourceOrganizationId:string;field:string;authorityMode:"masterapp_authoritative"|"external_authoritative"|"latest_allowed"|"manual_resolution"|"read_only";masterChanged:boolean;externalChanged:boolean;masterReceivedAt?:string;externalReceivedAt?:string;critical?:boolean}){if(input.organizationId!==input.sourceOrganizationId)throw new Error("CROSS_TENANT_CONFLICT_BLOCKED");if(input.masterChanged&&input.externalChanged&&(input.critical||input.authorityMode==="manual_resolution"||input.authorityMode==="latest_allowed"))return{status:"conflict",decision:"manual_review",silentLastWriteWins:false};if(input.authorityMode==="read_only")return{status:"blocked",decision:"no_write",silentLastWriteWins:false};if(input.authorityMode==="masterapp_authoritative")return{status:"resolved",decision:"masterapp_wins",silentLastWriteWins:false};if(input.authorityMode==="external_authoritative")return{status:"resolved",decision:"external_wins",silentLastWriteWins:false};return{status:"unchanged",decision:"none",silentLastWriteWins:false}}
}

export class IntegrationImpactAnalysisService{
 analyze(input:{connectorVersion:string;flows:Array<{id:string;connectorVersion:string;status:string;contracts:string[];stores:string[]}>;mappingIds:string[];contractBreaking:boolean}){const affected=input.flows.filter(x=>x.connectorVersion===input.connectorVersion&&x.status!=="retired");return{affectedFlows:affected.map(x=>x.id),affectedStores:[...new Set(affected.flatMap(x=>x.stores))],contracts:[...new Set(affected.flatMap(x=>x.contracts))],mappings:input.mappingIds,breaking:input.contractBreaking||affected.length>0,publicationAllowed:false,source:"phase76_lineage_and_registered_dependencies"}}
}

export class IntegrationConnectionResolver{
 resolve(input:{organizationId:string;storeId?:string|null;environment:"sandbox"|"production";connectorKey:string},connections:Array<{id:string;organizationId:string;storeId?:string|null;environment:string;connectorKey:string;status:string;priority:number}>){const candidates=connections.filter(x=>x.organizationId===input.organizationId&&x.connectorKey===input.connectorKey&&x.environment===input.environment&&x.status==="active"&&(x.storeId===input.storeId||x.storeId==null)).sort((a,b)=>Number(b.storeId===input.storeId)-Number(a.storeId===input.storeId)||a.priority-b.priority);return{connectionId:candidates[0]?.id||null,scope:candidates[0]?.storeId?"store":"organization",fallbackUsed:Boolean(candidates[0]&&!candidates[0].storeId&&input.storeId),crossTenant:false}}
}

export class IntegrationIdempotencyService{
 key(input:{organizationId:string;flowVersionId:string;triggerId:string;sourceEventId:string;operation:string}){if(Object.values(input).some(x=>!x))throw new Error("IDEMPOTENCY_INPUT_REQUIRED");return`${input.organizationId}:${stableHash(input).slice(0,48)}`}
 decide(existing:{status:string;responseRef?:string|null}|null){if(!existing)return{action:"execute",duplicate:false};if(["succeeded","partially_succeeded"].includes(existing.status))return{action:"return_recorded_result",duplicate:true,responseRef:existing.responseRef||null};return{action:"join_or_reject_inflight",duplicate:true}}
}

export class IntegrationRetryService{
 schedule(input:{attempt:number;maxAttempts:number;baseMs:number;maxMs:number;jitterRatio:number;category:string;retryAfterMs?:number}){const retryable=["rate_limit","timeout","network","provider"].includes(input.category);if(!retryable||input.attempt>=input.maxAttempts)return{retry:false,nextDelayMs:null,deadLetter:true};const raw=input.retryAfterMs??Math.min(input.maxMs,input.baseMs*2**Math.max(0,input.attempt-1)),jitter=Math.round(raw*Math.min(.5,Math.max(0,input.jitterRatio))*.5);return{retry:true,nextDelayMs:raw+jitter,deadLetter:false,deterministicJitterBound:true}}
}

export class IntegrationCircuitBreakerService{
 evaluate(input:{state:"closed"|"open"|"half_open";failures:number;threshold:number;openedAt?:string;cooldownMs:number;now?:number}){const now=input.now??Date.now();if(input.state==="open"&&input.openedAt&&now-Date.parse(input.openedAt)>=input.cooldownMs)return{state:"half_open",allowProbe:true};if(input.state==="closed"&&input.failures>=input.threshold)return{state:"open",allowProbe:false};return{state:input.state,allowProbe:input.state!=="open"}}
}

export class IntegrationRateLimitService{
 consume(input:{limit:number;windowSeconds:number;used:number;requested?:number}){const requested=Math.max(1,input.requested||1),remaining=Math.max(0,input.limit-input.used);return{allowed:remaining>=requested,remaining:Math.max(0,remaining-requested),retryAfterSeconds:remaining>=requested?0:Math.max(1,input.windowSeconds),queueInsteadOfDrop:remaining<requested}}
}

export class IntegrationDLQService{
 previewReplay(item:{organizationId:string;status:string;payloadRef?:string|null;errorCategory:string;attempts:number},request:{organizationId:string;reason:string;flowVersionActive:boolean;contractCompatible:boolean}){if(item.organizationId!==request.organizationId)throw new Error("CROSS_TENANT_REPLAY_BLOCKED");const blockers=[...(!item.payloadRef?["PAYLOAD_REFERENCE_MISSING"]:[]),...(!request.flowVersionActive?["FLOW_VERSION_INACTIVE"]:[]),...(!request.contractCompatible?["CONTRACT_INCOMPATIBLE"]:[]),...(item.status==="resolved"?["ALREADY_RESOLVED"]:[])];return{allowed:blockers.length===0,blockers,reason:request.reason,executionStarted:false,newIdempotencyKeyRequired:false,originalAttempts:item.attempts,errorCategory:item.errorCategory}}
}

export class IntegrationReconciliationService{
 compare(source:Array<{key:string;hash:string;amount?:number}>,target:Array<{key:string;hash:string;amount?:number}>){const a=new Map(source.map(x=>[x.key,x])),b=new Map(target.map(x=>[x.key,x])),keys=[...new Set([...a.keys(),...b.keys()])].sort();const items=keys.map(key=>{const x=a.get(key),y=b.get(key);return{key,status:!x?"missing_source":!y?"missing_target":x.hash!==y.hash?"mismatch":"matched",sourceAmount:x?.amount??null,targetAmount:y?.amount??null}});return{total:items.length,matched:items.filter(x=>x.status==="matched").length,mismatches:items.filter(x=>x.status!=="matched"),automaticCorrection:false,requiresDomainActionIntent:true}}
}

export class IntegrationFileService{
 register(input:{organizationId:string;fileName:string;size:number;sha256:string;contractVersion:string;maxBytes:number}){if(input.size<=0||input.size>input.maxBytes)throw new Error("FILE_SIZE_NOT_ALLOWED");if(!/^[a-f0-9]{64}$/i.test(input.sha256))throw new Error("INVALID_FILE_HASH");if(!/^[\w .-]+\.(csv|jsonl|xml|xlsx|zip)$/i.test(input.fileName))throw new Error("FILE_TYPE_NOT_ALLOWED");return{...input,status:"registered",contentStoredInline:false,streamingRequired:input.size>5_000_000,malwareScanRequired:true,contractValidationRequired:true}}
}

export class IntegrationObservabilityService{
 summarize(runs:Array<{status:string;latencyMs:number;attempts:number;bytes?:number}>){const completed=runs.filter(x=>RUN_STATUSES.includes(x.status as never)),success=completed.filter(x=>["succeeded","partially_succeeded"].includes(x.status)).length,latencies=completed.map(x=>x.latencyMs).sort((a,b)=>a-b);return{runs:completed.length,successRate:completed.length?Math.round(success/completed.length*10000)/100:null,p95LatencyMs:latencies.length?latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))]:null,retries:completed.reduce((n,x)=>n+Math.max(0,x.attempts-1),0),bytes:completed.reduce((n,x)=>n+(x.bytes||0),0),opaqueScore:false}}
}

export class IntegrationHealthService{
 check(input:{registry:boolean;contracts:boolean;secrets:boolean;workers:boolean;dlq:boolean;reconciliation:boolean;coreIndependent:boolean}){const failed=Object.entries(input).filter(([,v])=>!v).map(([k])=>k);return{status:failed.length?"degraded":"healthy",failed,coreOperationalIndependent:input.coreIndependent,failClosedForWrites:true,externalOutageDoesNotBlockCore:true}}
}
