import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {exerciseFinalization} from './helpers/finalization.mjs';
test('CLI validates finalization, terminal failure and explicit revision acceptance',async()=>{
 await exerciseFinalization(fileURLToPath(new URL('../src/review/tool.js',import.meta.url)));
});
