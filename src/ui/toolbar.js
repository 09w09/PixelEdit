(()=>{
const PE=globalThis.PixelEditor,U=PE.ui;
function ensureRegistryTools(){
  const registry=PE.tools?.registry;
  if(!registry?.has?.('bucket')||document.querySelector('[data-tool="bucket"]'))return;
  const eraser=document.querySelector('[data-tool="eraser"]'),grid=eraser?.closest('.tool-grid');
  if(!grid)return;
  const button=document.createElement('button');
  button.type='button';button.dataset.tool='bucket';button.className='tool-btn';button.title='油漆桶（B）';
  button.innerHTML='<svg viewBox="0 0 24 24"><path d="M7 4l8 8-6 6-6-6zM7 4l2-2 8 8M14 17h7M18 14l3 3-3 3"/></svg><span>油漆桶</span>';
  eraser.insertAdjacentElement('afterend',button);
}
class Toolbar{
  constructor(editor){this.editor=editor;}
  mount(){
    ensureRegistryTools();
    document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>this.editor.setTool(b.dataset.tool));
    document.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>this.editor.align(b.dataset.align));
    document.querySelectorAll('[data-distribute]').forEach(b=>b.onclick=()=>this.editor.distribute(b.dataset.distribute));
  }
}
U.Toolbar=Toolbar;
})();
