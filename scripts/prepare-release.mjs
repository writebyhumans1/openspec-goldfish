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
 const head=git('rev-parse','HEAD');
 const tags=git('tag','--list').split('\n');
 const requestedVersion=pkg.version,currentTag=`v${requestedVersion}`;
 const currentTagged=tags.includes(currentTag)&&git('rev-parse',`${currentTag}^{commit}`)===head;
 const next=currentTagged?requestedVersion:nextVersion(requestedVersion,tags);
 const needsVersionPr=!currentTagged&&next!==requestedVersion;
 const tag=`v${needsVersionPr?next:requestedVersion}`;
 const nextTag=tag;
 const existingTag=tags.includes(tag);
 if(existingTag&&git('rev-parse',`${tag}^{commit}`)!==head&&!needsVersionPr)throw new Error(`Release tag ${tag} already points to another revision`);
 let mode='publish',revision=head,branch='';
 if(needsVersionPr){
  // A version bump must enter protected main through a reviewed PR.
  branch=`release/${nextTag}-${head.slice(0,7)}`;
  const remote=git('ls-remote','--heads','origin',`refs/heads/${branch}`).split('\t')[0];
  if(remote){
   git('fetch','origin',`refs/heads/${branch}:refs/remotes/origin/${branch}`);
   revision=git('rev-parse',`refs/remotes/origin/${branch}`);
  }else{
   pkg.version=next;
   writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
   let lock;
   try{lock=JSON.parse(readFileSync('package-lock.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(lock){
    lock.version=pkg.version;
    if(lock.packages?.[''])lock.packages[''].version=pkg.version;
    writeFileSync('package-lock.json',JSON.stringify(lock,null,2)+'\n');
   }
   const core='src/review/core.js';
   const source=readFileSync(core,'utf8');
   if(!/packageVersion='[^']+'/.test(source))throw new Error('Runtime version default not found');
   writeFileSync(core,source.replace(/packageVersion='[^']+'/,`packageVersion='${pkg.version}'`));
   git('add','package.json',...(lock?['package-lock.json']:[]),core);
   git('commit','-m',`chore: release ${nextTag}`);
   revision=git('rev-parse','HEAD');
   git('push','origin',`HEAD:refs/heads/${branch}`);
  }
  mode='pr';
 }else if(!existingTag){
  // The release-version PR is already merged; tag its exact main revision.
  git('tag',tag);
  git('push','origin',`refs/tags/${tag}`);
 }
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`mode=${mode}\ntag=${tag}\nrevision=${revision}\nrelease_branch=${branch}\n`);
 console.log(`${mode} ${tag} ${revision}${branch?` ${branch}`:''}`);
}
