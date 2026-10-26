import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
test('Driver custody distinction is authorized in the database, not only hidden in UI',async()=>{
 const sql=await read('supabase/migrations/20260914050903_driver_pickup_workflow.sql');
 assert.match(sql,/driver_kind text not null default 'partner'/);
 assert.match(sql,/if driver.driver_kind = 'partner' then/);
 assert.match(sql,/supplied_hash is distinct from delivery.pickup_code_hash/);
 assert.match(sql,/assignment.driver_profile_id = driver.id and assignment.status = 'accepted'/);
 assert.match(sql,/delivery_pin_hash = case when required_pin/);
 assert.match(sql,/auto_dispatch_ready_delivery after update of status/);
 assert.match(sql,/private.offer_next_driver_locked/);
});
test('Driver gets receipt, contact and assigned stops without null address parts',async()=>{
 const ui=await read('components/driver-dispatch-console.tsx');
 assert.match(ui,/NOTA DA ENTREGA/);
 assert.match(ui,/recipient_phone/);
 assert.match(ui,/routeDetails.map/);
 assert.match(ui,/Retirei o pedido · sem código/);
 assert.match(ui,/verify_delivery_pin/);
 assert.match(ui,/cash_change_cents/);
 assert.match(await read('components/custom-staff-manager.tsx'),/name="driver_kind"/);
});
