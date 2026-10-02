import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function getChecked(url, check, fetcher=fetch) {
  let last;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetcher(url,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'personal-app-health/1.0'}});
      if(!r.ok)throw Error('HTTP '+r.status);
      const body=await r.text(); if(body.length>3000000)throw Error('Response too large');
      if(check.json){const data=JSON.parse(body);if(check.key&&!Object.hasOwn(data,check.key))throw Error('Missing JSON key: '+check.key);}
      if(check.contains&&!body.includes(check.contains))throw Error('Expected page marker missing');
      return {url,status:'ok'};
    }catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,500*(attempt+1)));}
  }
  throw Error(url+': '+last.message);
}
export function checkAutomationPolicy(directory='.github/workflows'){
  const prohibited=/(?:openai\/codex-action|codex\s+exec|api\.openai\.com|api\.anthropic\.com|anthropic\/claude-code-action|gh\s+copilot)/i;
  for(const file of fs.readdirSync(directory).filter(f=>/\.ya?ml$/.test(f))){
    const source=fs.readFileSync(path.join(directory,file),'utf8').split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
    assert(!prohibited.test(source),'AI invocation is prohibited in scheduled operations: '+file);
    for(const match of source.matchAll(/runs-on:\s*([^\r\n]+)/g))assert(/^(ubuntu-latest|ubuntu-24\.04)$/.test(match[1].trim()),'Use only the configured standard Ubuntu runner');
  }
}
if(process.argv.includes('--self-test')){
  let calls=0;
  await assert.rejects(()=>getChecked('https://example.com',{json:true},async()=>{calls++;return{ok:true,text:async()=>'{broken'};}));
  assert.equal(calls,3);
  await getChecked('https://example.com',{json:true,key:'ok'},async()=>({ok:true,text:async()=>'{"ok":true}'}));
  console.log('Health retry/schema tests passed');
}else{
  checkAutomationPolicy();
  const config=JSON.parse(fs.readFileSync('operations.json','utf8'));
  assert.equal(config.ai,false);assert(config.checks.length>0&&config.checks.length<=8);
  const base=new URL(config.publicUrl);assert.equal(base.protocol,'https:');assert.equal(base.hostname,'longchanp7-hub.github.io');
  const results=[];
  for(const check of config.checks){const u=new URL(check.path,base);assert(u.href.startsWith(base.href),'Health URL outside this app');try{results.push(await getChecked(u.href,check));}catch(e){results.push({url:u.href,status:'failed',message:e.message});}}
  const summary='## '+config.name+' (no AI)\n'+new Date().toISOString()+'\n'+results.map(r=>'- '+r.status+': '+r.url+(r.message?' — '+r.message:'')).join('\n');
  console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
  if(results.some(r=>r.status==='failed'))process.exitCode=1;
}

