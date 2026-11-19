import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Exercise the actual CLI in a child process, providing only deterministic
// OpenSpec discovery metadata. Finalization, snapshots, and IO are not mocked.
export async function exerciseFinalization(runtime,{packageVersion}={}){
 const cwd=await mkdtemp(path.join(os.tmpdir(),'goldfish-finalize-cli-'));
 const changeRoot=path.join(cwd,'change');await mkdir(changeRoot);
 const plan=path.join(changeRoot,'plan.md');await writeFile(plan,'Export profile');
 const status={changeRoot,schemaName:'custom',applyRequires:['plan'],artifacts:[{id:'plan',status:'done',requires:[]}],artifactPaths:{plan:{existingOutputPaths:[plan]}}};
 const hook=path.join(cwd,'metadata.mjs');
 const crossSpawn=createRequire(runtime).resolve('cross-spawn');
 await writeFile(hook,`import crossSpawn from ${JSON.stringify(pathToFileURL(crossSpawn).href)};
import {writeSync} from 'node:fs';
const original=crossSpawn.sync;
crossSpawn.sync=(cmd,args,opts)=>{
 if(cmd!=='openspec')return original(cmd,args,opts);
 const status=${JSON.stringify(status)};
 const value=args[0]==='context'?{root:{path:${JSON.stringify(cwd)}}}:args[0]==='list'?{changes:[{name:'sample'}]}:args[0]==='status'?status:{state:'ready',progress:{complete:0}};
 writeSync(opts.stdio[1],JSON.stringify(value));return {status:0};
};`);
 const invoke=(args)=>{
  const out=path.join(cwd,'stdout'),err=path.join(cwd,'stderr'),fds=[openSync(out,'w'),openSync(err,'w')];
  let r;try{r=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,runtime,...args],{cwd,stdio:['ignore',...fds]});}finally{fds.forEach(closeSync);}
  assert.ifError(r.error);return {status:r.status,stdout:readFileSync(out,'utf8'),stderr:readFileSync(err,'utf8')};
 };
 const start=()=>{const r=invoke(['start','--change','sample','--harness','devin','--harness-version','test']);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).dir;};
 const role=name=>({role:name,status:'complete',reconstruction:'Export profile',coverage:['plan.md'],evidence:[{path:'plan.md',reference:'all'}],findings:[]});
 const results={'cold-reader':role('cold-reader'),'adversarial-reviewer':role('adversarial-reviewer')};
 const file=path.join(cwd,'candidate.json');await writeFile(file,JSON.stringify(results));
 const dir=start();
 if(packageVersion)assert.equal(JSON.parse(await readFile(path.join(dir,'inputs.json'))).packageVersion,packageVersion);
 const finalize=(run,...extra)=>invoke(['finalize','--run',run,'--results',file,...extra]);
 let r=finalize(dir);assert.equal(r.status,1);assert.match(r.stderr,/Missing adjudicator/);assert.match(r.stderr,/Await pending roles/);
 assert.deepEqual((await readdir(dir)).sort(),['cold-packet.json','inputs.json']);
 for(const args of [['--incomplete-reason'],['--incomplete-reason',''],['--incomplete-reason','   ']]){
  r=finalize(dir,...args);assert.equal(r.status,1);assert.match(r.stderr,/value pairs|nonempty string/);
  assert.deepEqual((await readdir(dir)).sort(),['cold-packet.json','inputs.json']);
 }
 results.adjudicator=role('adjudicator');await writeFile(file,JSON.stringify(results));
 r=finalize(dir,'--incomplete-reason','failure');assert.equal(r.status,1);assert.match(r.stderr,/normal finalization/);
 assert.deepEqual((await readdir(dir)).sort(),['cold-packet.json','inputs.json']);
 for(const field of ['coverage','evidence']){
  const previous=results.adjudicator[field];results.adjudicator[field]=[];
  await writeFile(file,JSON.stringify(results));
  r=finalize(dir);assert.equal(r.status,1);assert.match(r.stderr,new RegExp(`adjudicator.*${field}`));
  assert.deepEqual((await readdir(dir)).sort(),['cold-packet.json','inputs.json']);
  results.adjudicator[field]=previous;
 }
 await writeFile(file,JSON.stringify(results));
 r=finalize(dir);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).completion,'complete');
 const report=await readFile(path.join(dir,'report.json'),'utf8');
 r=finalize(dir);assert.equal(r.status,1);assert.match(r.stderr,/EEXIST/);assert.equal(await readFile(path.join(dir,'report.json'),'utf8'),report);
 const failed=start();delete results.adjudicator;await writeFile(file,JSON.stringify(results));
 r=finalize(failed,'--incomplete-reason','  Adjudicator timed out  ');assert.equal(r.status,0,r.stderr);
 const saved=JSON.parse(await readFile(path.join(failed,'report.json')));
 assert.equal(saved.completion,'incomplete');assert.equal(saved.readiness,'undetermined');assert.equal(saved.incompleteReason,'Adjudicator timed out');
 assert.match(saved.coverageLimits.join(),/Missing adjudicator/);
 assert.match(await readFile(path.join(failed,'report.md'),'utf8'),/Incomplete reason: Adjudicator timed out/);
 assert.deepEqual(JSON.parse(await readFile(path.join(failed,'results.json'))),results);

 // Run the revision boundary checks through the installed CLI as well as core tests.
 const revisionRun=start();
 const finding=id=>({id,severity:'major',location:'plan.md',scenario:'Export times out',impact:'Retry behavior is undefined',resolution:'Specify retry limit'});
 results['cold-reader'].findings=[finding('C1'),finding('C2')];
 results.adjudicator={...role('adjudicator'),findings:results['cold-reader'].findings.map(f=>({...f,disposition:f.id==='C1'?'accepted':'dismissed',reason:'Checked the export contract'}))};
 await writeFile(file,JSON.stringify(results));
 r=finalize(revisionRun);assert.equal(r.status,0,r.stderr);
 const offer=path.join(cwd,'offer.json'),acceptance=path.join(cwd,'acceptance.json'),outcomes=path.join(cwd,'outcomes.json');
 await writeFile(offer,JSON.stringify({runId:JSON.parse(r.stdout).runId,edits:[{findingId:'C1',path:'plan.md',description:'Specify retry limit'}]}));
 const prepare=()=>invoke(['prepare-revision','--run',revisionRun,'--offer',offer,'--acceptance',acceptance]);
 await writeFile(acceptance,JSON.stringify({explicitAcceptance:'false',acceptedIds:['C1']}));
 r=prepare();assert.equal(r.status,1);assert.match(r.stderr,/explicitAcceptance must be a boolean/);
 await writeFile(acceptance,JSON.stringify({explicitAcceptance:false,acceptedIds:['C1']}));
 r=prepare();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),[]);
 await writeFile(acceptance,JSON.stringify({explicitAcceptance:true,acceptedIds:['C1']}));
 r=prepare();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout)[0].findingId,'C1');
 const record=()=>invoke(['record-revision','--run',revisionRun,'--outcomes',outcomes]);
 const before=await readdir(revisionRun);
 await writeFile(outcomes,JSON.stringify({acceptedIds:['C2'],outcomes:[{id:'C2',status:'applied',paths:['plan.md'],reason:'Incorrectly approved dismissed finding'}]}));
 r=record();assert.equal(r.status,1);assert.match(r.stderr,/not actionable/);
 assert.deepEqual(await readdir(revisionRun),before);
 await writeFile(plan,'Export profile. Retry at most twice.');
 await writeFile(outcomes,JSON.stringify({acceptedIds:['C1'],outcomes:[{id:'C1',status:'applied',paths:['plan.md'],reason:'User chose two retries'}]}));
 r=record();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).freshness,'stale');
}
