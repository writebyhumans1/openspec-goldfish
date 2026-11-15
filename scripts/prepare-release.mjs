import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function nextVersion(version,tags) {
 if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Automatic releases require a stable package version');
 const compare=(a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
 const current=version.split('.').map(Number);
 const released=tags.filter(t=>/^v\d+\.\d+\.\d+$/.test(t)).map(t=>t.slice(1).split('.').map(Number)).sort(compare).at(-1);
 if(!released||compare(current,released)>0)return version;
 released[2]++;return released.join('.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 if(git('status','--porcelain'))throw new Error('Release checkout must be clean');
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 let tag=`v${pkg.version}`;
 const head=git('rev-parse','HEAD');
 const tags=git('tag','--list').split('\n');
 // A rerun after a tag push resumes the same immutable candidate.
 const tagged=tags.includes(tag)&&git('rev-parse',`${tag}^{commit}`)===head;
 if(!tagged){
  pkg.version=nextVersion(pkg.version,tags);tag=`v${pkg.version}`;
  writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
  const core='src/review/core.js';
  const source=readFileSync(core,'utf8');
  if(!/packageVersion='[^']+'/.test(source))throw new Error('Runtime version default not found');
  writeFileSync(core,source.replace(/packageVersion='[^']+'/,`packageVersion='${pkg.version}'`));
  if(git('status','--porcelain')){
   git('add','package.json',core);
   git('commit','-m',`chore: release ${tag}`);
  }
  git('tag',tag);
  // Refuse concurrent main changes rather than overwrite them. Publish nothing on failure.
  git('push','--atomic','origin','HEAD:main',`refs/tags/${tag}`);
 }
 const revision=git('rev-parse','HEAD');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`tag=${tag}\nrevision=${revision}\n`);
 console.log(`${tag} ${revision}`);
}
