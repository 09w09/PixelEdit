import { referencedAssetIds, validateProject } from '../model/schema.js';
import { assertProjectInvariants } from '../model/invariants.js';
import { AssetStore } from '../model/asset-store.js';
import { MAX_ASSETS, MAX_PROJECT_BYTES, assertSize, assertProjectText } from '../model/resource-limits.js';

const ProjectSerializer={
  validate(project){validateProject(project);assertProjectInvariants(project);return project;},
  referencedAssetIds,
  serialize(project,assets){validateProject(project);assertProjectInvariants(project);const output=structuredClone(project);const ids=referencedAssetIds(project);for(const id of ids)if(!assets.has(id))throw new Error('工程引用了不存在的资源');output.assets=assets.referenced(ids);const raw=JSON.stringify(output);assertSize(new Blob([raw]).size,MAX_PROJECT_BYTES,'工程文件');return raw;},
  deserialize(raw){assertProjectText(raw);const output=typeof raw==='string'?JSON.parse(raw):structuredClone(raw);validateProject(output);assertProjectInvariants(output);const records=output.assets||[];if(!Array.isArray(records)||records.length>MAX_ASSETS)throw new Error('资源数量超出范围');const seen=new Set();for(const record of records){if(!record||typeof record.id!=='string'||!record.id.match(/^[a-zA-Z0-9_.:-]{1,128}$/)||seen.has(record.id)||!['font','image'].includes(record.type)||typeof record.dataUrl!=='string'||record.dataUrl.length>MAX_PROJECT_BYTES||!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(record.dataUrl))throw new Error('资源记录无效');seen.add(record.id);}for(const id of referencedAssetIds(output))if(!seen.has(id))throw new Error('工程引用了不存在的资源');delete output.assets;return{project:output,assets:new AssetStore(records)};},
};

export { ProjectSerializer };
