(()=>{const M=globalThis.PixelEditor.model;
class TreeModel{
 constructor(page){this.page=page;}
 node(id){return M.nodeById(this.page,id);}
 childrenOf(parentId){return this.page.nodes.filter(n=>n.parentId===parentId);}
 roots(){return this.childrenOf(this.page.id);}
 ancestorsOf(id){const out=[];let n=this.node(id),seen=new Set();while(n&&n.parentId&&n.parentId!==this.page.id){if(seen.has(n.parentId))throw new Error('cycle');seen.add(n.parentId);n=this.node(n.parentId);if(!n)throw new Error('orphan parent');out.push(n);}if(n&&n.parentId!==this.page.id)throw new Error('layer must descend from page');return out;}
 descendantsOf(id){const out=[];const walk=x=>{for(const c of this.childrenOf(x)){out.push(c);walk(c.id);}};walk(id);return out;}
 isAncestor(a,b){return this.ancestorsOf(b).some(n=>n.id===a);}
 validateHierarchy(){const ids=new Set();for(const n of this.page.nodes){if(n.type==='background')throw new Error('background node is forbidden in V17');if(ids.has(n.id))throw new Error('duplicate node id');ids.add(n.id);}for(const n of this.page.nodes){if(!n.parentId)throw new Error('layer must have parent');let pid=n.parentId,seen=new Set([n.id]);while(pid!==this.page.id){if(seen.has(pid))throw new Error('cycle');seen.add(pid);const p=this.node(pid);if(!p)throw new Error('orphan parent');pid=p.parentId;}}return true;}
 validateAcyclic(){return this.validateHierarchy();}
 isInheritedLocked(id){const n=this.node(id);if(!n)return false;return !!this.page.locked||this.ancestorsOf(id).some(a=>a.locked);} isEffectivelyLocked(id){const n=this.node(id);return !!n&&(!!n.locked||this.isInheritedLocked(id));}
 isEffectivelyVisible(id){const n=this.node(id);if(!n)return false;if(n.visible===false)return false;return !this.ancestorsOf(id).some(a=>a.visible===false);}
 reparent(id,newParentId,index=null){const n=this.node(id);if(!n)throw new Error('missing node');newParentId=newParentId||this.page.id;if(id===newParentId)throw new Error('self parent');if(newParentId!==this.page.id&&!this.node(newParentId))throw new Error('missing parent');if(newParentId!==this.page.id&&this.isAncestor(id,newParentId))throw new Error('parent cycle');n.parentId=newParentId;this.reorder(id,index==null?this.childrenOf(newParentId).length-1:index);return n;}
 reorder(id,index){const n=this.node(id);if(!n)throw new Error('missing node');const siblings=this.childrenOf(n.parentId).filter(x=>x.id!==id),target=Math.max(0,Math.min(siblings.length,index==null?siblings.length:index)),ordered=[...siblings.slice(0,target),n,...siblings.slice(target)],ids=new Set(ordered.map(x=>x.id)),positions=this.page.nodes.map((x,i)=>ids.has(x.id)?i:-1).filter(i=>i>=0);if(positions.length!==ordered.length)return ordered;for(let i=0;i<ordered.length;i++)this.page.nodes[positions[i]]=ordered[i];return ordered;}
 visualOrder(){const out=[];const walk=pid=>{for(const c of this.childrenOf(pid)){out.push(c);walk(c.id);}};walk(this.page.id);return out;}
}
M.TreeModel=TreeModel;})();
