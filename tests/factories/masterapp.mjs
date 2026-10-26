import { randomUUID } from "node:crypto";

const sequence = () => randomUUID();
export const createOrganization = (overrides={}) => ({ id:sequence(),name:"Restaurante QA",slug:`qa-${sequence().slice(0,8)}`,is_test_organization:true,test_safety_profile:"staging",...overrides });
export const createStore = (organization=createOrganization(),overrides={}) => ({ id:sequence(),organization_id:organization.id,name:"Unidade QA",slug:`store-${sequence().slice(0,8)}`,active:true,...overrides });
export const createUser = (overrides={}) => ({ id:sequence(),email:`qa-${sequence().slice(0,8)}@example.test`,role:"owner",...overrides });
export const createCustomer = (overrides={}) => ({ id:sequence(),name:"Cliente Sintético",phone:"+5511999990000",email:`customer-${sequence().slice(0,8)}@example.test`,...overrides });
export const createProduct = (store=createStore(),overrides={}) => ({ id:sequence(),establishment_id:store.id,name:"Produto QA",price_cents:2590,active:true,...overrides });
export const createOrder = (store=createStore(),customer=createCustomer(),overrides={}) => ({ id:sequence(),establishment_id:store.id,customer_id:customer.id,status:"pending",total_cents:2590,idempotency_key:`order-${sequence()}`,...overrides });
export const createPayment = (order=createOrder(),overrides={}) => ({ id:sequence(),order_id:order.id,amount_cents:order.total_cents,status:"pending",provider:"mock",idempotency_key:`payment-${order.id}`,...overrides });
export const createConversation = (store=createStore(),customer=createCustomer(),overrides={}) => ({ id:sequence(),establishment_id:store.id,customer_id:customer.id,status:"ai",channel:"whatsapp_sandbox",...overrides });

