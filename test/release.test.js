import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {checkRelease} from '../scripts/check-release.mjs';
test('release guard rejects mismatches, off-main commits and dirty checkouts',()=>{
 const cwd=mkdtempSync(path.join(os.tmpdir(),'goldfish-release-'));
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
 try{
  git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  writeFileSync(path.join(cwd,'file'),'one');git('add','.');git('commit','-m','initial');git('update-ref','refs/remotes/origin/main','HEAD');git('tag','v0.1.0');
  assert.equal(checkRelease({cwd,tag:'v0.1.0',version:'0.1.0'}),git('rev-parse','HEAD'));
  assert.throws(()=>checkRelease({cwd,tag:'v0.2.0',version:'0.1.0'}),/match/);
  assert.throws(()=>checkRelease({cwd,tag:'v0.1.0-beta.1',version:'0.1.0-beta.1'}),/Stable/);
  writeFileSync(path.join(cwd,'file'),'two');assert.throws(()=>checkRelease({cwd,tag:'v0.1.0',version:'0.1.0'}),/clean/);
  git('add','.');git('commit','-m','unmerged');git('tag','v0.2.0');
  assert.throws(()=>checkRelease({cwd,tag:'v0.1.0',version:'0.1.0'}),/checked revision/);
  assert.throws(()=>checkRelease({cwd,tag:'v0.2.0',version:'0.2.0'}));
 }finally{rmSync(cwd,{recursive:true,force:true});}
});

test('automatic release versions advance tags and respect explicit version bumps',async()=>{
 const {nextVersion}=await import('../scripts/prepare-release.mjs');
 assert.equal(nextVersion('0.1.1',['v0.1.0','v0.1.1']),'0.1.2');
 assert.equal(nextVersion('0.1.1',['v0.1.9','v0.1.10','v1.0.0-beta.1']),'0.1.11');
 assert.equal(nextVersion('0.2.0',['v0.1.9']),'0.2.0');
 assert.equal(nextVersion('0.1.1',[]),'0.1.1');
 assert.equal(nextVersion('0.1.1',['v1.0.0']),'1.0.1');
 assert.throws(()=>nextVersion('1.0.0-beta.1',[]),/stable/);
});

test('automatic release pushes matching version, runtime and tag and resumes on rerun',()=>{
 const cwd=mkdtempSync(path.join(os.tmpdir(),'goldfish-auto-release-'));
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
 try{
  git('init','--bare',path.join(cwd,'remote.git'));
  git('clone',path.join(cwd,'remote.git'),path.join(cwd,'work'));
  const work=path.join(cwd,'work');
  const run=(...args)=>execFileSync('git',args,{cwd:work,stdio:'pipe',encoding:'utf8'}).trim();
  run('config','user.email','fixture@example.invalid');run('config','user.name','Fixture');
  run('switch','-c','main');
  execFileSync(process.execPath,['-e',`require('fs').mkdirSync('src/review',{recursive:true})`],{cwd:work});
  writeFileSync(path.join(work,'package.json'),'{"version":"0.1.1"}\n');
  writeFileSync(path.join(work,'src/review/core.js'),"export const packageVersion='0.1.1';\n");
  run('add','.');run('commit','-m','initial');run('tag','v0.1.1');run('push','origin','main','--tags');
  writeFileSync(path.join(work,'feature'),'merged change');run('add','.');run('commit','-m','feature');run('push','origin','main');
  const script=new URL('../scripts/prepare-release.mjs',import.meta.url);
  const invoke=()=>execFileSync(process.execPath,[fileURLToPath(script)],{cwd:work,stdio:'pipe'});
  invoke();const revision=run('rev-parse','HEAD');
  assert.equal(run('show','v0.1.2:package.json'),'{\n  "version": "0.1.2"\n}');
  assert.match(run('show','v0.1.2:src/review/core.js'),/packageVersion='0.1.2'/);
  assert.equal(run('rev-parse','origin/main'),revision);
  assert.equal(run('rev-parse','v0.1.2'),revision);
  invoke();assert.equal(run('rev-parse','HEAD'),revision);
  assert.equal(run('status','--porcelain'),'');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
