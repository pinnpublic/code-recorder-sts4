const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const key = 'code-recorder.viewer.explorerRatio.v1';
function setup(storage = new Map(), initialWidth = 1006) {
  let width = initialWidth, resize;
  const handlers = {}, attrs = {}, styles = {}, classes = new Set();
  const editor = {getBoundingClientRect: () => ({left:20,width}),
    style:{setProperty:(k,v)=>styles[k]=v},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}};
  const handle = {addEventListener:(k,v)=>handlers[k]=v,setAttribute:(k,v)=>attrs[k]=v,
    setPointerCapture(){},focus(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../player/splitter.js'),'utf8'),{
    document:{getElementById:id=>id==='editor'?editor:handle},window:{innerWidth:1200},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    ResizeObserver:class {constructor(fn){resize=fn;} observe(){}}
  });
  return {attrs,classes,handlers,styles,resize:w=>{width=w;resize();},
    fire:(name,extra={})=>handlers[name]({button:0,pointerId:1,preventDefault(){},...extra})};
}
test('splitter drags, stores its ratio, restores, and clamps small windows without losing preference',()=>{
  const storage=new Map(), ui=setup(storage);
  ui.fire('pointerdown');ui.fire('pointermove',{clientX:423});ui.fire('pointerup');
  assert.equal(ui.styles['--explorer-width'],'400px');
  assert.equal(storage.get(key),'0.4');assert.equal(ui.classes.size,0);
  const restored=setup(storage);assert.equal(restored.styles['--explorer-width'],'400px');
  restored.resize(306);assert.equal(restored.styles['--explorer-width'],'120px');
  restored.resize(1006);assert.equal(restored.styles['--explorer-width'],'400px');
  restored.fire('keydown',{key:'ArrowRight'});assert.equal(storage.get(key),'0.41');
  restored.fire('keydown',{key:'End'});assert.equal(restored.styles['--explorer-width'],'800px');
  restored.fire('keydown',{key:'Home'});assert.equal(restored.styles['--explorer-width'],'120px');
});
test('splitter tolerates hidden startup, corrupt preferences and unavailable storage',()=>{
  const ui=setup(new Map([[key,'broken']]),0);
  ui.resize(1006);assert.equal(ui.styles['--explorer-width'],'230px');
  const blocked=setup({get(){throw Error('blocked');},set(){throw Error('blocked');}});
  blocked.fire('pointerdown');blocked.fire('pointermove',{clientX:523});blocked.fire('pointercancel');
  assert.equal(blocked.styles['--explorer-width'],'500px');assert.equal(blocked.classes.size,0);
});
