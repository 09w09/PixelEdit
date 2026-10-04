import { referencedAssetIds, validateProject } from '../model/schema.js';
const P = globalThis.PixelEditor.persistence;
const M = globalThis.PixelEditor.model;
const ProjectSerializer = {
  validate: validateProject,
  referencedAssetIds,
  serialize(project, assets) {
    validateProject(project);
    const output = structuredClone(project);
    output.assets = assets.referenced(referencedAssetIds(project));
    return JSON.stringify(output);
  },
  deserialize(raw) {
    const output = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    validateProject(output);
    const records = output.assets || [];
    delete output.assets;
    return { project: output, assets: new M.AssetStore(records) };
  },
};
P.ProjectSerializer = ProjectSerializer;
export { ProjectSerializer };
