import fs from 'node:fs';

const path = 'src/clipboard/element-clipboard.js';
const source = fs.readFileSync(path, 'utf8');
const before = 'PE.workspaceCapabilities.selectAllOnPage = function selectAllOnPage(editor) {';
const after = 'PE.workspaceCapabilities.selectAllOnPage = function selectAllOnPageCapability(editor) {';
if (!source.includes(before)) throw new Error('selectAllOnPage capability pattern not found');
fs.writeFileSync(path, source.replace(before, after));
console.log('Task 7 capability shadowing fix completed');
