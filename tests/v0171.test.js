const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('0.17.1 mobile correction uses full-width fixed intrinsic header and navigation',()=>{
  const css=read('styles.css');
  const block=css.slice(css.lastIndexOf('v0.17.1'));
  assert.match(block,/grid-template-columns:minmax\(0,1fr\) auto!important/);
  assert.match(block,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
  assert.match(block,/min-height:62px!important/);
  assert.match(block,/overflow-x:clip!important/);
  assert.match(block,/\.section-heading[^}]+grid-template-columns:minmax\(0,1fr\)!important/);
});

test('0.17.1 modal close control remains sticky inside a full-screen mobile dialog',()=>{
  const css=read('styles.css');
  const block=css.slice(css.lastIndexOf('v0.17.1'));
  assert.match(block,/dialog\.modal,dialog\.modal\[open\]\{[^}]+inset:0!important/);
  assert.match(block,/\.modal-heading\{[^}]*position:sticky!important/);
  assert.match(block,/\.modal-heading \.close-dialog[^}]+flex:0 0 40px!important/);
});

test('iOS home icon is full bleed and referenced with a cache-busting filename',()=>{
  const html=read('index.html');
  assert.match(html,/apple-touch-icon-v0171\.png/);
  const png=fs.readFileSync(path.join(root,'apple-touch-icon-v0171.png'));
  assert.equal(png.toString('ascii',1,4),'PNG');
  // PNG IHDR color type 2 = RGB (no alpha transparency that causes a white iOS tile).
  assert.equal(png[25],2);
});

test('Open Graph metadata points at the active Hadas domain',()=>{
  const html=read('index.html');
  assert.match(html,/property="og:url" content="https:\/\/hadas-garden\.vercel\.app\/"/);
  assert.match(html,/property="og:image" content="https:\/\/hadas-garden\.vercel\.app\/og-image\.png"/);
});
