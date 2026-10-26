import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const code = ts.transpileModule(await read('lib/operation-theme.ts'), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {operationTheme, readableText} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('Operation preserves saved brand and corrects unreadable text automatically', () => {
  const theme = operationTheme({accent_color:'#f91515',menu_surface_color:'#151411',menu_text_color:'#fffaf1'});
  assert.equal(theme['--op-accent'],'#f91515');
  assert.equal(theme['--op-text'],'#fffaf1');
  assert.equal(readableText('#ffffff','#ffffff'),'#000000');
  assert.equal(readableText('#000000','#000000'),'#ffffff');
  assert.equal(operationTheme({menu_surface_color:'bad'})['--op-surface'],'#151411');
});
test('Finalization no longer asks for an extra browser confirmation',async()=>{
  const source=await read('components/waiter-console.tsx');
  assert.doesNotMatch(source,/confirm\(/);
  assert.match(source,/register_table_payment/);
  assert.match(source,/PixPayment/);
  assert.match(source,/setPaymentOpen\(session\?\.status === "awaiting_payment"/);
  assert.match(source,/open-waiter-table/);
});
test('Kitchen deliveries survive closing hours and history reads paginated real records',async()=>{
  const board=await read('components/kitchen-board.tsx');
  assert.doesNotMatch(board,/isDateInOperatingWindow|window\.confirm/);
  assert.match(board,/<KitchenHistory/);
  const history=await read('components/kitchen-history.tsx');
  assert.match(history,/range\(offset, offset \+ 499\)/);
  assert.match(history,/total_cents/);
  assert.match(history,/ticket\.ready_at \|\| ticket\.delivered_at/);
  assert.match(history,/não representa recebimento no caixa/);
});
