(()=>{const PE=globalThis.PixelEditor,U=PE.ui;
class Properties{
  constructor(editor,el){
    this.editor=editor;
    this.el=el;
    this.provider=PE.properties?.provider||null;
    if(!this.provider)throw new Error('PixelEditor property provider is not installed');
    this.provider.attach(this);
    this.attachSelectionSession();
    if(typeof MutationObserver==='function'&&this.el){
      this.bindingObserver=new MutationObserver(()=>this.syncBindingMarkers());
      this.bindingObserver.observe(this.el,{childList:true,subtree:true});
    }
  }
  attachSelectionSession(){if(this.editor?.state?.selection)this.editor.state.selection._propertySession=this.session;}
  syncBindingMarkers(){this.el?.querySelectorAll?.('[data-property-bound]').forEach(control=>{control.dataset.liveProperty=control.dataset.propertyBound;});}
  finalizeControls(){
    this.attachSelectionSession();
    this.syncBindingMarkers();
    for(const id of ['propX','propY','propW','propH']){
      const control=this.el?.querySelector?.('#'+id);
      if(!control||control.type!=='number'||control.value==='')continue;
      const value=Number(control.value);
      if(Number.isFinite(value))control.value=String(Math.round(value));
    }
  }
  render(){this.attachSelectionSession();const result=this.provider.render(this);this.finalizeControls();return result;}
  renderPage(page){this.attachSelectionSession();const result=this.provider.renderPage(this,page);this.finalizeControls();return result;}
  renderPreviews(nodes){return this.provider.renderPreviews(this,nodes);}
  bounds(nodes){return this.provider.bounds(this,nodes);}
  general(nodes,locked=false){return this.provider.generalMarkup({properties:this,editor:this.editor,page:this.editor.activePage(),nodes,allLocked:locked});}
  transform(nodes,locked=false){return this.provider.positionMarkup({properties:this,editor:this.editor,page:this.editor.activePage(),nodes,allLocked:locked});}
  typeFields(nodes,locked=false){return this.provider.typeMarkup({properties:this,editor:this.editor,page:this.editor.activePage(),nodes,allLocked:locked,sameType:nodes.every(node=>node.type===nodes[0]?.type)});}
  ditherFields(nodes,locked=false){return this.provider.ditherFields(nodes,locked);}
  patternFields(nodes,locked=false){return this.provider.patternFields(nodes,locked);}
  fillFields(nodes,locked=false,textOnly=false){return this.provider.fillFields(nodes,locked,textOnly);}
  fontOptionsArray(){return this.provider.fontOptionsArray(this);}
  bind(){/* binding is owned by PropertyProvider descriptors */}
  bindPage(){/* binding is owned by PropertyProvider descriptors */}
  bindDither(){/* binding is owned by PropertyProvider descriptors */}
  bindPattern(){/* binding is owned by PropertyProvider descriptors */}
  bindText(){/* binding is owned by PropertyProvider descriptors */}
  bindImage(){/* binding is owned by PropertyProvider descriptors */}
}
U.Properties=Properties;})();
