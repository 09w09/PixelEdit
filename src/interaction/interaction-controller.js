(()=>{const PE=globalThis.PixelEditor,I=PE.interaction,C=PE.commands;
class InteractionController{
constructor({state,bus,hitTest,snapEngine=null,getZoom=()=>1,onOverlay=()=>{},onPan=()=>{},modeKind='pointer'}){this.state=state;this.bus=bus;this.hitTest=hitTest;this.snapEngine=snapEngine;this.getZoom=getZoom;this.onOverlay=onOverlay;this.onPan=onPan;this.modeKind=modeKind==='marquee'?'marquee':'pointer';this.mode='Idle';this.start=null;this.last=null;this.additive=false;this.alt=false;this.panModifier=false;this.candidateHit=null;}
setModeKind(v){this.modeKind=v==='marquee'?'marquee':'pointer';this.reset();}
setPanModifier(v){this.panModifier=!!v;}
reset(){this.mode='Idle';this.start=this.last=null;this.additive=this.alt=false;this.candidateHit=null;this.onOverlay({marquee:null,previewMove:null,smartGuides:[]});}
pointerDown(e){const p={x:Math.round(e.x),y:Math.round(e.y)};this.start=this.last=p;this.additive=!!(e.ctrlKey||e.metaKey);this.alt=!!e.altKey;if(this.panModifier||e.button===1){this.mode='Panning';return this.mode;}const hit=this.hitTest?.topmostAt?.(p.x,p.y,{ignoreLocked:true})||null;
if(this.modeKind==='marquee'){
 this.state.pageSelectedId=null;
 if(this.additive&&hit){this.candidateHit=hit;this.mode='MarqueeClickCandidate';return this.mode;}
 if(!this.additive)this.state.selection.clear();
 this.mode='MarqueeSelecting';this.onOverlay({marquee:{x:p.x,y:p.y,w:1,h:1},previewMove:null,smartGuides:[]});return this.mode;
}
if(hit){this.state.pageSelectedId=null;if(this.additive)this.state.selection.toggle(hit.id);else if(!this.state.selection.has(hit.id))this.state.selection.replace([hit.id]);this.mode=this.alt?'DuplicatingSelection':'Selecting';}
else{this.state.pageSelectedId=null;if(!this.additive)this.state.selection.clear();this.mode='Idle';}
return this.mode;}
pointerMove(e){if(!this.start)return;const p={x:Math.round(e.x),y:Math.round(e.y)},dx=p.x-this.start.x,dy=p.y-this.start.y,prev=this.last||this.start;
if(this.mode==='Panning'){this.onPan({dx:p.x-prev.x,dy:p.y-prev.y});this.last=p;return this.mode;}
this.last=p;
if(this.mode==='MarqueeClickCandidate'&&(dx||dy)){this.mode='MarqueeSelecting';this.onOverlay({marquee:{x:Math.min(this.start.x,p.x),y:Math.min(this.start.y,p.y),w:Math.abs(dx)+1,h:Math.abs(dy)+1},previewMove:null,smartGuides:[]});return this.mode;}
if(this.mode==='Selecting'&&(dx||dy))this.mode=this.alt||e.altKey?'DuplicatingSelection':'MovingSelection';
if(this.mode==='MovingSelection'||this.mode==='DuplicatingSelection'){let sx=dx,sy=dy,smartGuides=[];if(this.snapEngine){const r=this.snapEngine.snapMove({roots:this.state.selection.ids,dx,dy,zoom:this.getZoom(),thresholdPx:5});sx=r.dx;sy=r.dy;smartGuides=r.smartGuides;}this.onOverlay({previewMove:{ids:this.state.selection.ids,dx:sx,dy:sy},marquee:null,smartGuides});}
else if(this.mode==='MarqueeSelecting'){this.onOverlay({marquee:{x:Math.min(this.start.x,p.x),y:Math.min(this.start.y,p.y),w:Math.abs(dx)+1,h:Math.abs(dy)+1},previewMove:null,smartGuides:[]});}
return this.mode;}
pointerUp(e){if(!this.start){this.reset();return false;}const p={x:Math.round(e.x),y:Math.round(e.y)},dx=p.x-this.start.x,dy=p.y-this.start.y;let changed=false,fx=dx,fy=dy;
if((this.mode==='MovingSelection'||this.mode==='DuplicatingSelection')&&this.snapEngine){const r=this.snapEngine.snapMove({roots:this.state.selection.ids,dx,dy,zoom:this.getZoom(),thresholdPx:5});fx=r.dx;fy=r.dy;}
if(this.mode==='MovingSelection'&&(fx||fy))changed=this.bus.execute(new C.MoveSelectionCommand(this.state.selection.ids,fx,fy));
else if(this.mode==='DuplicatingSelection'&&(fx||fy))changed=this.bus.execute(new C.AltDragDuplicateCommand(this.state.selection.ids,fx,fy));
else if(this.mode==='MarqueeClickCandidate'&&this.candidateHit)this.state.selection.toggle(this.candidateHit.id);
else if(this.mode==='MarqueeSelecting'){const rect={x:Math.min(this.start.x,p.x),y:Math.min(this.start.y,p.y),w:Math.abs(dx)+1,h:Math.abs(dy)+1},ids=(this.hitTest?.intersecting?.(rect,{ignoreLocked:true})||[]).map(n=>n.id);if(this.additive)this.state.selection.addMany(ids);else this.state.selection.replace(ids);}
this.reset();return changed;}
cancel(){this.reset();return true;}}
I.InteractionController=InteractionController;})();
