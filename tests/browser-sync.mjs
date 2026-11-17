import {chromium} from 'playwright';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/');
await fs.mkdir(root+'/work',{recursive:true});
const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(root+'/index.html'));});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const pageUrl=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.DAYLOOM_CHROME||undefined,headless:true});
const errors=[],docs=new Map();let rpcCount=0,delayRPC=null,casInterfere=null;
const uid='10000000-0000-4000-8000-000000000001';
const jwt=id=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.');
const token=jwt(uid),account={id:uid,email:'sync-test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
async function device(mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1040},isMobile:mobile,hasTouch:mobile,timezoneId:'Asia/Shanghai'});
 await context.route('https://*.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/auth/v1/token')return reply({access_token:token,refresh_token:'qa-refresh',expires_in:3600,token_type:'bearer',user:account});
  if(path==='/auth/v1/user')return reply(account);
  if(path==='/auth/v1/logout')return route.fulfill({status:204});
  if(path==='/auth/v1/health')return reply({name:'mock'});
  assert.equal(req.headers().authorization,'Bearer '+token);
  if(path==='/rest/v1/dayloom_documents')return reply(docs.has(uid)?[structuredClone(docs.get(uid))]:[]);
  if(path==='/rest/v1/rpc/dayloom_save'){
   rpcCount++;const input=req.postDataJSON();
   if(delayRPC){const delay=delayRPC;delayRPC=null;await delay();}
   if(casInterfere){casInterfere();casInterfere=null;}
   const row=docs.get(uid)||{revision:0,data:null};
   if(input.expected_revision!==row.revision)return reply({applied:false,...row});
   const next={revision:row.revision+1,data:input.new_data};docs.set(uid,next);return reply({applied:true,...next});
  }
  throw Error('Unexpected request '+path);
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pageUrl);await page.waitForFunction(()=>window.DayloomSync);
 return {context,page};
}
const state=p=>p.evaluate(()=>Dayloom.getState());
const status=p=>p.evaluate(()=>DayloomSync.getStatus());
const sync=p=>p.evaluate(()=>DayloomSync.sync());
async function edit(p,change){await p.evaluate(change);await p.locator('h1').first().click();}
async function login(p,mode='merge'){
 await p.locator('#cloud-button').click();await p.locator('#cloud-login-form [name=email]').fill(account.email);await p.locator('#cloud-login-form [name=password]').fill('qa-only-password');await p.locator('#cloud-login-form button[type=submit]').click();
 await p.locator(mode==='merge'?'#cloud-merge-first':'#cloud-use-remote').click();
 await p.waitForFunction(()=>DayloomSync.getStatus().status==='已同步');
}
async function checkCalendarUpgrade(){
 const {context,page}=await device();
 const date='2026-11-18',next='2026-11-19',legacy=await state(page);
 delete legacy.settings.slotDefaultsVersion;
 legacy.settings.slots.morning=['09:00','11:30'];
 legacy.settings.slots.evening=['20:00','22:30'];
 legacy.tasks.push({id:'legacy',title:'原有任务',date,slot:'morning',priority:'high',due:'',done:false,note:'已有备注',minutes:600});
 legacy.milestones.push({id:'exam',title:'期中考试',date:next,type:'exam',done:false,note:''});
 await page.evaluate(plan=>localStorage.setItem('dayloom-planner-v1',JSON.stringify(plan)),legacy);
 await page.reload();
 await page.locator('#plan-date').fill(date);
 let plan=await state(page);
 assert.deepEqual(plan.settings.slots,{morning:['08:30','11:30'],afternoon:['14:00','16:30'],evening:['19:30','22:30']});
 assert.deepEqual(plan.tasks,legacy.tasks);assert.deepEqual(plan.milestones,legacy.milestones);
 assert.equal(await page.locator('[data-view=settings]').innerText(),'');
 assert.doesNotMatch(await page.locator('body').innerText(),/预计时长|600 分钟|自己的节奏|专注计划|当前待办/);
 await page.locator('[data-task-id=legacy]').dragTo(page.locator(`[data-drop-date="${next}"][data-drop-slot=evening]`));
 assert.equal((await state(page)).tasks[0].date,next);assert.equal((await state(page)).tasks[0].slot,'evening');
 await page.locator(`[data-action=exercise][data-date="${next}"]`).click();
 assert.deepEqual((await state(page)).exerciseDone,{[next]:true});
 await page.locator('[data-action=calendar-mode][data-mode=month]').click();
 assert.equal(await page.locator('.month-summary').innerText(),'0/1 项');
 await page.locator(`.month-summary[data-date="${next}"]`).click();
 assert.equal(await page.locator('#plan-date').inputValue(),next);
 await page.getByRole('checkbox',{name:'完成 原有任务',exact:true}).click();
 await page.getByRole('button',{name:'原有任务',exact:true}).click();
 assert.equal(await page.locator('#task-form [name=minutes]').count(),0);
 await page.locator('#task-form [name=note]').fill('更新备注');await page.locator('#task-form button[type=submit]').click();
 assert.equal((await state(page)).tasks[0].minutes,600);

 // A restored custom range and a neighboring exercise block must both survive migration.
 const backup=structuredClone(legacy);
 backup.tasks[0].date='';backup.tasks[0].slot='evening';
 backup.settings.slots.morning=['08:45','11:15'];backup.settings.exercise=['18:00','19:45'];
 await page.locator('[data-view=settings]').click();
 await page.locator('#import-file').setInputFiles({name:'v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await page.locator('#confirm-action').click();
 plan=await state(page);
 assert.deepEqual(plan.settings.slots.morning,backup.settings.slots.morning);
 assert.deepEqual(plan.settings.slots.evening,backup.settings.slots.evening);
 assert.deepEqual(plan.settings.exercise,backup.settings.exercise);
 await page.locator('[name=morning-start]').fill('09:00');await page.locator('[name=morning-end]').fill('11:30');
 await page.locator('#settings-form button[type=submit]').click();
 const downloading=page.waitForEvent('download');await page.locator('.settings-actions [data-action=export]').click();
 const exported=JSON.parse(await fs.readFile(await (await downloading).path(),'utf8'));
 assert.equal(exported.tasks[0].minutes,600);assert.deepEqual(exported.settings.slots.morning,['09:00','11:30']);
 await page.reload();assert.deepEqual((await state(page)).settings.slots.morning,['09:00','11:30']);
 const target=await page.locator('#plan-date').inputValue();
 await page.locator('[data-view=tasks]').click();await page.locator('[data-action=auto-plan]').click();await page.locator('#confirm-action').click();
 plan=await state(page);assert.equal(plan.tasks[0].date,target);assert.equal(plan.tasks[0].slot,'evening');
 await context.close();

 docs.set(uid,{revision:1,data:legacy});
 const cloud=await device(true);await login(cloud.page,'remote');
 plan=await state(cloud.page);assert.deepEqual(plan.tasks,legacy.tasks);
 assert.deepEqual(plan.settings.slots.morning,['08:30','11:30']);assert.deepEqual(plan.settings.slots.evening,['19:30','22:30']);
 await cloud.context.close();
 console.log('PASS: legacy local, backup and cloud plans, custom ranges, drag, exercise and month-to-week navigation');
}
try{
 const a=await device(),p=a.page;
 assert.deepEqual((await state(p)).settings.slots,{morning:['08:30','11:30'],afternoon:['14:00','16:30'],evening:['19:30','22:30']});
 assert.equal(await p.locator('#main > :not(.calendar-panel)').count(),0);
 const selected=await p.locator('#plan-date').inputValue();
 await p.locator(`.cell-add[data-slot=morning][data-date="${selected}"]`).click();
 assert.equal(await p.locator('#task-form [name=minutes]').count(),0);
 await p.locator('#task-form [name=title]').fill('细胞生物学复习');await p.locator('#task-form button[type=submit]').click();
 await login(p);assert.equal(docs.get(uid).data.tasks.length,1);assert.equal('minutes' in docs.get(uid).data.tasks[0],false);
 const b=await device(true),q=b.page;await login(q,'remote');assert.equal((await state(q)).tasks[0].title,'细胞生物学复习');
 await q.getByRole('checkbox',{name:'完成 细胞生物学复习',exact:true}).click();await sync(q);await sync(p);assert.equal((await state(p)).tasks[0].done,true);
 console.log('PASS: login, first upload/download, phone completion reaches desktop');
 await p.reload();await p.waitForFunction(()=>DayloomSync.getStatus().enabled);await sync(p);assert.equal((await state(p)).tasks[0].done,true);
 await a.context.setOffline(true);await b.context.setOffline(true);
 for(const [page,title] of [[p,'电脑离线任务'],[q,'手机离线任务']]){await page.locator('[data-view=tasks]').click();await page.locator('#quick-task input').fill(title);await page.locator('#quick-task button').click();}
 assert.match((await status(q)).status,/离线/);
 await a.context.setOffline(false);await b.context.setOffline(false);await Promise.all([sync(p),sync(q)]);await sync(p);await sync(q);
 assert.equal((await state(p)).tasks.length,3);assert.equal((await state(q)).tasks.length,3);assert.equal(docs.get(uid).data.tasks.length,3);
 console.log('PASS: offline edits on both devices merge, concurrent CAS retry');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].title='电脑修改标题';Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].priority='high';Dayloom.applySync(s);});
 await Promise.all([sync(p),sync(q)]);await sync(p);await sync(q);
 assert.equal((await state(q)).tasks[0].title,'电脑修改标题');assert.equal((await state(p)).tasks[0].priority,'high');
 console.log('PASS: changes to independent fields survive');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].title='电脑版本';Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].title='手机版本';Dayloom.applySync(s);});
 await sync(p);await sync(q);assert.equal((await status(q)).pending,true);assert.equal(docs.get(uid).data.tasks[0].title,'电脑版本');
 await q.locator('#cloud-button').click();await q.locator('[data-sync=resolve]').click();await q.locator('[name=conflict-0][value=local]').check();await q.locator('#cloud-conflict-form button[type=submit]').click();await sync(q);await sync(p);
 assert.equal((await state(p)).tasks[0].title,'手机版本');assert.equal((await status(q)).pending,false);
 console.log('PASS: conflicting title waits for explicit choice and then converges');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks=s.tasks.slice(1);Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].note='保留此修改';Dayloom.applySync(s);});
 await sync(p);await sync(q);assert.equal((await status(q)).pending,true);
 await q.locator('#cloud-button').click();await q.locator('[data-sync=resolve]').click();await q.locator('[name=conflict-0][value=local]').check();await q.locator('#cloud-conflict-form button[type=submit]').click();await sync(q);await sync(p);
 assert.equal((await state(p)).tasks.length,3);assert.equal((await state(p)).tasks.find(t=>t.title==='手机版本').note,'保留此修改');
 console.log('PASS: deletion versus edit offers recovery');
 let release,started;const waitStarted=new Promise(r=>started=r);delayRPC=async()=>{started();await new Promise(r=>release=r);};
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].note='发送中的修改';Dayloom.applySync(s);});
 const inFlight=sync(p);await waitStarted;
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].slot='evening';Dayloom.applySync(s);});release();await inFlight;await sync(p);
 assert.equal(docs.get(uid).data.tasks[0].slot,'evening');
 console.log('PASS: local edits while upload is pending survive');
 await p.locator('#quick-task input').fill('尚未提交的输入');
 docs.get(uid).data.tasks[0].note='云端新备注';docs.get(uid).revision++;
 await sync(p);assert.equal(await p.locator('#quick-task input').inputValue(),'尚未提交的输入');
 await p.locator('#quick-task input').fill('');await p.locator('h1').click();await sync(p);assert.equal((await state(p)).tasks[0].note,'云端新备注');
 await p.locator('[data-view=settings]').click();await p.locator('[name=morning-start]').fill('09:15');await p.locator('h1').click();await sync(p);assert.equal(await p.locator('[name=morning-start]').inputValue(),'09:15');await p.locator('#settings-form button[type=submit]').click();await sync(p);await sync(q);assert.equal((await state(q)).settings.slots.morning[0],'09:15');
 console.log('PASS: unfinished inputs protected, saved settings sync');
 await p.locator('[data-view=calendar]').click();await q.locator('[data-view=calendar]').click();await p.screenshot({path:root+'/work/sync-desktop.png',fullPage:true});await q.screenshot({path:root+'/work/sync-mobile.png',fullPage:true});
 assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await q.locator('#cloud-button').click();await q.screenshot({path:root+'/work/sync-panel.png'});await q.locator('[data-sync=logout]').click();assert.equal((await status(q)).enabled,false);assert.equal((await state(q)).tasks.length,3);
 await a.context.close();await b.context.close();await checkCalendarUpgrade();
 assert.deepEqual(errors,[]);console.log('PASS: mobile layout, logout retains plan; no browser exceptions. RPC writes: '+rpcCount);
}finally{await browser.close();await new Promise(r=>server.close(r));}
