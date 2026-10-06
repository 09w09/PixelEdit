import { pageById } from '../model/project.js';
import { TreeModel } from '../model/tree-model.js';
import { SelectionSet } from '../model/selection-set.js';
import { normalizeNodeGeometry } from '../model/invariants.js';

function pageOf(state,id){return pageById(state.project,id||state.project.activePageId);}
function moveNodeGeometry(node,dx,dy){dx=Math.round(dx);dy=Math.round(dy);if(node.type==='line'){node.x1+=dx;node.y1+=dy;node.x2+=dx;node.y2+=dy;}else if(node.type==='polygon'){for(const point of node.points){point.x+=dx;point.y+=dy;}}else{node.x=(node.x||0)+dx;node.y=(node.y||0)+dy;}normalizeNodeGeometry(node);return true;}
function moveNodeTree(page,id,dx,dy,tree=new TreeModel(page)){const node=tree.node(id);if(!node)return;moveNodeGeometry(node,dx,dy);for(const child of tree.childrenOf(id))moveNodeTree(page,child.id,dx,dy,tree);}
class MoveSelectionCommand{constructor(ids,dx,dy,pageId=null,{mergeKey=null}={}){this.ids=[...ids];this.dx=Math.round(dx);this.dy=Math.round(dy);this.pageId=pageId;this.label='移动选择';this.mergeKey=mergeKey;}get mergeDescriptor(){return{operation:'move',targets:this.ids,channel:'geometry'};}execute(state){if(!this.dx&&!this.dy)return false;const page=pageOf(state,this.pageId),tree=new TreeModel(page),selection=new SelectionSet(this.ids),roots=selection.transformRoots(tree).filter(id=>{const node=tree.node(id);return node&&!tree.isEffectivelyLocked(id);});if(!roots.length)return false;for(const id of roots)moveNodeTree(page,id,this.dx,this.dy,tree);return true;}}

export { MoveSelectionCommand, moveNodeTree, moveNodeGeometry };
