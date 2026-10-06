import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
async function sourceFiles(root = ROOT) { const files=[]; for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())files.push(...await sourceFiles(path));else if(entry.isFile()&&entry.name.endsWith('.js'))files.push(path);} return files; }
async function sources(){return Promise.all((await sourceFiles()).map(async path=>({path,name:relative(ROOT,path).replaceAll('\\','/'),source:await readFile(path,'utf8')})));}
function locations(records,pattern,{exclude=[]}={}){const out=[];for(const record of records){if(exclude.includes(record.name))continue;for(const match of record.source.matchAll(pattern))out.push(`${record.name}:${record.source.slice(0,match.index).split('\n').length}`);}return out;}
async function exists(url){try{await readFile(url,'utf8');return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}

test('production source does not depend on the PixelEditor global service locator',async()=>{const records=await sources();const offenders=locations(records,/\b(?:globalThis|window)\.PixelEditor\b/g,{exclude:['debug/debug-api.js']});expect(offenders).toEqual([]);});
test('production source has no runtime installers or side-effect service registration',async()=>{const records=await sources();const installers=locations(records,/\b(?:function\s+)?install[A-Za-z0-9_$]*Runtime\b/g);const iifeRegistrations=locations(records,/\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,240}\bPixelEditor\b/g);const namespaceWrites=locations(records,/\b(?:PE|P|M|C|R|I|U|PixelEditor)\.[A-Za-z_$][\w$]*\s*=\s*/g,{exclude:['debug/debug-api.js']});expect({installers,iifeRegistrations,namespaceWrites}).toEqual({installers:[],iifeRegistrations:[],namespaceWrites:[]});});
test('main is explicit bootstrap without runtime installation ordering',async()=>{const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');expect(main).not.toMatch(/install[A-Za-z0-9_$]*Runtime/);expect(main).not.toContain("import './core/index.js'");expect(main).toMatch(/bootstrapPixelEdit/);});
test('BinaryImagePipeline has a single production construction site',async()=>{const records=await sources();const creations=[];for(const record of records){for(const match of record.source.matchAll(/\bcreateBinaryImagePipeline\s*\(/g)){const before=record.source.slice(Math.max(0,match.index-24),match.index);if(/function\s*$/.test(before))continue;creations.push(`${record.name}:${record.source.slice(0,match.index).split('\n').length}`);}}expect(creations).toHaveLength(1);});
test('image geometry and raster decoding have one canonical production helper each',async()=>{const records=await sources();const geometryDefinitions=locations(records,/\bfunction\s+(?:imageGeometry|computeImageGeometry)\s*\(/g);const decodeDefinitions=locations(records,/\bfunction\s+(?:decodeImage|decodeRasterImage)\s*\(/g);expect(geometryDefinitions).toHaveLength(1);expect(decodeDefinitions).toHaveLength(1);});

test('legacy PixelEditor test compatibility facade is removed',async()=>{
  expect(await exists(new URL('./debug-compat.js',import.meta.url))).toBe(false);
  expect(await exists(new URL('../vite.test.config.js',import.meta.url))).toBe(false);
  const playwright=await readFile(new URL('../playwright.config.js',import.meta.url),'utf8');
  expect(playwright).not.toContain('vite.test.config.js');
});

test('browser debug boundary exposes app and services without legacy PixelEditor namespace',async({page})=>{
  await page.goto('/');
  await page.waitForFunction(()=>Boolean(window.PixelEditorDebug?.app&&window.PixelEditorDebug?.services&&window.PixelEditorTest?.editor));
  const result=await page.evaluate(()=>({
    hasLegacy:Object.hasOwn(window,'PixelEditor'),
    debugKeys:Object.keys(window.PixelEditorDebug).sort(),
    sameApp:window.PixelEditorDebug.app===window.PixelEditorTest.editor,
    version:window.PixelEditorDebug.services.model.PROJECT_VERSION,
  }));
  expect(result).toEqual({hasLegacy:false,debugKeys:['app','services'],sameApp:true,version:17});
});
