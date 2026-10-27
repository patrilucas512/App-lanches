import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
const read = name => readFile(new URL('../'+name, import.meta.url), 'utf8');
const source = ts.transpileModule(await read('lib/operation-theme.ts'), { compilerOptions: { module:ts.ModuleKind.ESNext } }).outputText;
const { brandName, brandLogo, operationTheme } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('Display identity has one precedence and preserves legacy identity as fallback', () => {
  const brand = {name:'Original',logo_url:'/old.png',menu_display_name:'Minha loja',menu_logo_url:'/new.png'};
  assert.equal(brandName(brand),'Minha loja');
  assert.equal(brandLogo(brand),'/new.png');
  assert.equal(brandName({name:'Original'}),'Original');
  assert.equal(brandLogo({logo_url:'/old.png'}),'/old.png');
});
test('Every dashboard page passes the same establishment identity to the shared shell',async()=>{
  const root=new URL('../app/painel/',import.meta.url);
  const files=await readdir(root,{recursive:true});
  for(const file of files.filter(f=>f.endsWith('page.tsx'))) {
    const text=await readFile(new URL(file.replaceAll('\\','/'),root),'utf8');
    if(text.includes('<DashboardShell')) assert.match(text,/<DashboardShell brand=\{establishment\}/,file);
  }
});
test('Kitchen, cashier and driver use the same persisted branding fields',async()=>{
  for(const area of ['cozinha','caixa','motoboy']) {
    const text=await read('app/'+area+'/page.tsx');
    assert.match(text,/<EstablishmentTheme brand=/);
    for(const field of ['menu_display_name','menu_logo_url','menu_background_color','menu_surface_color','menu_text_color']) assert.ok(text.includes(field),area+':'+field);
  }
});
test('Invalid custom colors safely fall back and public menu shares contrast resolver',async()=>{
  const theme=operationTheme({menu_surface_color:'url(evil)',accent_color:'red'});
  assert.equal(theme['--op-surface'],'#151411');
  assert.equal(theme['--op-accent'],'#ff5a1f');
  assert.match(await read('components/public-menu.tsx'),/operationTheme\(menu.establishment\)/);
  assert.match(await read('components/menu-branding-manager.tsx'),/router.refresh\(\)/);
});
