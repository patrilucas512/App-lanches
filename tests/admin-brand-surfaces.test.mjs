import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
const bridge=css.slice(css.indexOf('/* Complete legacy-to-brand bridge.'));
test('Legacy administration surfaces use saved colors as foreground/background pairs',()=>{
 for(const selector of ['.printer-manager-form','.register-chip-list span','.custom-role-form','.custom-member-form','.team-member-row','.team-summary article','.waiter-admin-form','.catalog-addon-card','.setting-toggle','.weekly-day-card','.delivery-operational-alerts.all-clear']) {
  const rule=[...bridge.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(([,selectors,body])=>selectors.includes(selector)&&body.includes('background:var(--op-surface)'));
  assert.ok(rule,selector);
  assert.match(rule[2],/color:var\(--op-text\)/,selector);
 }
 assert.match(bridge,/--surface-soft:var\(--op-surface\)/);
 assert.ok(css.lastIndexOf('/* Complete legacy-to-brand bridge.')>css.lastIndexOf('.printer-manager-form{'));
});
test('Status colors and actions inherit identity while printed paper stays readable',()=>{
 assert.match(bridge,/--admin-success:var\(--op-link\)/);
 assert.match(bridge,/--admin-warning:var\(--op-link\)/);
 assert.match(bridge,/--admin-danger:var\(--op-link\)/);
 assert.match(bridge,/color:var\(--op-on-accent\)/);
 assert.match(bridge,/\.printer-test-preview \{ background:#fff;/);
 assert.match(bridge,/color:#000; -webkit-text-fill-color:#000/);
 assert.match(bridge,/@media screen/);
});
test('Production refresh removes legacy pale and green overrides from operational panels',()=>{
 assert.match(bridge,/Production design refresh/);
 assert.match(bridge,/\.connector-status-dot\.online \{ background:var\(--op-accent\)/);
 assert.match(bridge,/\.delivery-group-suggestions/);
 assert.match(bridge,/\.driver-finance-form/);
 assert.match(bridge,/data-design-revision|dashboard-content/);
 assert.match(bridge,/\.delivery-driver-card,.dispatch-card,.delivery-operations-stats article/);
 assert.match(bridge,/\.delivery-driver-card\.status-available/);
 assert.match(bridge,/\.driver-dot\.status-available/);
 assert.match(bridge,/background-color:var\(--op-surface\)/);
});
