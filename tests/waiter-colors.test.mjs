import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const postcss = require(require.resolve('postcss', { paths: [require.resolve('vite')] }));
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const css = postcss.parse(await read('app/globals.css'));
const rule = selector => css.nodes.find(node => node.type === 'rule' && node.selector === selector);
const value = (node, property) => node.nodes.find(item => item.prop === property)?.value;
test('Tracker itself, stages and cards no longer retain fixed pale backgrounds', () => {
  for (const selector of ['.waiter-tracker', '.waiter-stage', '.waiter-stage-list article', '.delivery-owner', '.tracker-message', '.stage-ready']) {
    assert.match(value(rule(selector), 'background'), /var\(--op-surface,\s*#151411\)/, selector);
  }
});
test('Tracker base counters pair their background with readable foreground', () => {
  for (const selector of ['.waiter-stage > header > b', '.waiter-alert-controls > span']) {
    assert.match(value(rule(selector), 'background'), /--op-accent/);
    assert.match(value(rule(selector), 'color'), /--op-on-accent/);
  }
});
test('Mobile stages stack without forced horizontal columns', () => {
  let found = false;
  css.walkAtRules('media', media => {
    if (media.params !== '(max-width:700px)') return;
    media.walkRules(node => {
      if (node.selector.includes('.operation-theme .waiter-stage-grid') && value(node,'grid-template-columns') === 'minmax(0,1fr)') found = true;
    });
  });
  assert.ok(found);
});
const compiled = ts.transpileModule(await read('lib/operation-theme.ts'), { compilerOptions: { module:ts.ModuleKind.ESNext } }).outputText;
const { operationTheme } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
function lum(color) {
  const [r,g,b] = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}
function contrast(a,b) { const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
test('Editable dark, light and saturated palettes keep 4.5:1 text contrast', () => {
  for (const background of ['#ffffff','#151411','#ff0000','#00ff00','#0000ff','#777777']) {
    for (const text of ['#ffffff','#000000',background]) {
      const theme=operationTheme({menu_surface_color:background,menu_background_color:background,menu_text_color:text,accent_color:background});
      assert.ok(contrast(background,theme['--op-text'])>=4.5);
      assert.ok(contrast(background,theme['--op-background-text'])>=4.5);
      assert.ok(contrast(background,theme['--op-on-accent'])>=4.5);
    }
  }
});
test('All waiter operational routes receive the editable establishment theme',async()=>{
  for(const route of ['garcom','pedidos','chamados']) {
    const source=await read('app/painel/'+route+'/page.tsx');
    assert.match(source,/operationColors=\{operationTheme\(establishment\)\}/);
  }
  assert.match(await read('components/menu-branding-manager.tsx'),/Prévia das cores da área do garçom/);
});
