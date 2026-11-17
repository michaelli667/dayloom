(() => {
'use strict';
const STORAGE='dayloom-planner-v1';
const SLOT_IDS=['morning','afternoon','evening'];
const SLOT_NAMES={morning:'上午',afternoon:'下午',evening:'晚上'};
const DEFAULT_SLOTS={morning:['08:30','11:30'],afternoon:['14:00','16:30'],evening:['19:30','22:30']};
const DATE_TYPES={exam:'考试',deadline:'截止日',other:'目标日'};
const WEEKDAYS=['周一','周二','周三','周四','周五','周六','周日'];
const SECTIONS=[['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],['13:30','14:15'],['14:25','15:10'],['15:30','16:15'],['16:25','17:10']];
const ICONS={
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m6 0h2m-10 4h2"/>',
 list:'<path d="m3 6 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2M10 6h11M10 13h11M10 20h11"/>',
 flag:'<path d="M5 21V3m0 1c4-4 10 4 15 0v11c-5 4-11-4-15 0"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
 check:'<path d="m5 12 4 4L19 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',
 left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||ICONS.list}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const parseDate=s=>new Date(s+'T12:00:00');
const addDays=(s,n)=>{const d=parseDate(s);d.setDate(d.getDate()+n);return localDate(d);};
const dateDiff=(a,b)=>Math.round((Date.UTC(...a.split('-').map((x,i)=>+x-(i===1?1:0)))-Date.UTC(...b.split('-').map((x,i)=>+x-(i===1?1:0))))/86400000);
const weekStart=s=>addDays(s,-((parseDate(s).getDay()+6)%7));
const shortDate=s=>`${+s.slice(5,7)}月${+s.slice(8,10)}日`;
const fullDate=s=>`${s.slice(0,4)}年${shortDate(s)}`;
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone=x=>JSON.parse(JSON.stringify(x));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(parseDate(s))&&localDate(parseDate(s))===s;
const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const defaultSettings=()=>({semester:'2026-09-07',courseHints:true,slots:clone(DEFAULT_SLOTS),slotDefaultsVersion:2,exercise:['18:00','19:00'],exerciseEnabled:true});
const newState=()=>({version:1,tasks:[],milestones:[],exerciseDone:{},settings:defaultSettings()});
let storageError=false,initialError='',upgradeLocal=false;
let state=newState();
try{
 const saved=localStorage.getItem(STORAGE);
 if(saved){
   const raw=JSON.parse(saved);
   state=validateState(raw);
   upgradeLocal=raw.settings.slotDefaultsVersion!==state.settings.slotDefaultsVersion;
 }
}catch(e){storageError=true;initialError='本地数据未能读取，请导出当前数据或从备份恢复。';}
let selected=today(),calendarMode='week',view='calendar',filter='open',search='',quickDraft='',toastTimer,undoState=null,lastToday=today();
const $=s=>document.querySelector(s);
function overlaps(a,b){return a[0]<b[1]&&b[0]<a[1];}
function upgradeSlotDefaults(slots,settings){
 if(settings.slotDefaultsVersion===2)return;
 // Only extend an old default if it still fits alongside the user's other time blocks.
 for(const [id,oldStart] of [['morning','09:00'],['evening','20:00']]){
   const range=DEFAULT_SLOTS[id];
   if(slots[id][0]!==oldStart||slots[id][1]!==range[1])continue;
   if(SLOT_IDS.some(other=>other!==id&&overlaps(range,slots[other])))continue;
   if(settings.exerciseEnabled&&overlaps(range,settings.exercise))continue;
   slots[id]=[...range];
 }
}
function validateState(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.tasks)||!Array.isArray(raw.milestones)||raw.tasks.length>20000||raw.milestones.length>5000)throw Error('不是有效的时序备份文件');
 const text=(v,max=500)=>typeof v==='string'&&v.length<=max;
 const seen=new Set();
 const tasks=raw.tasks.map(t=>{
   if(!t||!text(t.id,100)||seen.has(t.id)||!text(t.title,200)||!t.title.trim()||
      !(t.date===''||validDate(t.date))||!SLOT_IDS.includes(t.slot)||!['high','normal','low'].includes(t.priority)||
      !(t.due===''||validDate(t.due))||typeof t.done!=='boolean'||!text(t.note,3000))throw Error('任务数据格式不正确');
   seen.add(t.id);
   const task={id:t.id,title:t.title.trim(),date:t.date,slot:t.slot,priority:t.priority,due:t.due,done:t.done,note:t.note};
   // Keep historical estimates intact when a v1 plan is backed up again.
   if(Number.isInteger(t.minutes)&&t.minutes>=5&&t.minutes<=600)task.minutes=t.minutes;
   return task;
 });
 const milestones=raw.milestones.map(m=>{if(!m||!text(m.id,100)||seen.has(m.id)||!text(m.title,200)||!m.title.trim()||!validDate(m.date)||!['exam','deadline','other'].includes(m.type)||typeof m.done!=='boolean'||!text(m.note,3000))throw Error('倒数日数据格式不正确');seen.add(m.id);return {id:m.id,title:m.title.trim(),date:m.date,type:m.type,done:m.done,note:m.note};});
 const s=raw.settings;if(!s||!validDate(s.semester)||parseDate(s.semester).getDay()!==1||typeof s.courseHints!=='boolean'||typeof s.exerciseEnabled!=='boolean')throw Error('设置数据格式不正确');
 const slots={};let previousEnd='';for(const id of SLOT_IDS){const pair=s.slots?.[id];if(!Array.isArray(pair)||pair.length!==2||!pair.every(validTime)||pair[1]<=pair[0]||pair[0]<previousEnd)throw Error('任务时段需按顺序排列，且不能重叠');previousEnd=pair[1];slots[id]=[...pair];}
 if(!Array.isArray(s.exercise)||s.exercise.length!==2||!s.exercise.every(validTime)||s.exercise[0]>=s.exercise[1])throw Error('锻炼时间格式不正确');
 if(s.exerciseEnabled&&SLOT_IDS.some(id=>overlaps(s.exercise,slots[id])))throw Error('锻炼时间不能与任务时段重叠');
 upgradeSlotDefaults(slots,s);
 const exerciseDone={};if(raw.exerciseDone&&typeof raw.exerciseDone==='object')for(const [date,done]of Object.entries(raw.exerciseDone)){if(validDate(date)&&done===true)exerciseDone[date]=true;}
 return {version:1,tasks,milestones,settings:{semester:s.semester,courseHints:s.courseHints,slots,slotDefaultsVersion:2,exercise:[...s.exercise],exerciseEnabled:s.exerciseEnabled},exerciseDone};
}
function save(notify=true){try{localStorage.setItem(STORAGE,JSON.stringify(state));storageError=false;}catch(e){storageError=true;toast('浏览器无法保存，请立即导出备份。');}updateSaveLabel();if(notify)document.dispatchEvent(new Event('dayloom:change'));}
function updateSaveLabel(){$('#save-status').hidden=!storageError;}
function mutate(fn,message,undo=true){if(undo)undoState={state:clone(state),selected};fn();save();render();if(message)toast(message,undo);}
function toast(message,undo=false){clearTimeout(toastTimer);$('#toast').innerHTML=`<span>${esc(message)}</span>${undo?'<button data-action="undo">撤销</button>':''}`;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),6500);}
function courseEvents(date){if(!state.settings.courseHints)return [];const week=Math.floor(dateDiff(date,state.settings.semester)/7)+1;const day=(parseDate(date).getDay()+6)%7+1;return (window.COURSE_DATA||[]).filter(c=>c.day===day&&c.weeks.includes(week)&&c.end<=8&&!c.name.includes('实验'));}
const tasksIn=date=>state.tasks.filter(t=>t.date===date);
function sortedTasks(tasks){return [...tasks].sort((a,b)=>(a.done-b.done)||((a.due||'9999').localeCompare(b.due||'9999'))||({high:0,normal:1,low:2}[a.priority]-{high:0,normal:1,low:2}[b.priority]));}
function allDates(){return [...state.milestones.filter(m=>!m.done).map(m=>({...m,kind:'milestone'})),...state.tasks.filter(t=>t.due&&!t.done).map(t=>({id:t.id,title:t.title,date:t.due,type:'deadline',kind:'task',done:false,note:t.note}))].sort((a,b)=>a.date.localeCompare(b.date));}
function byDate(items){
 const days=new Map();
 for(const item of items){
   if(!days.has(item.date))days.set(item.date,[]);
   days.get(item.date).push(item);
 }
 return days;
}
function deadlineLabel(date){const n=dateDiff(date,today());return n===0?'今天截止':n<0?`已逾期 ${-n} 天`:`还有 ${n} 天`;}
function taskCheck(task){
 return `<button class="check ${task.done?'checked':''}" role="checkbox" aria-checked="${task.done}" aria-label="${task.done?'取消完成':'完成'} ${esc(task.title)}" data-action="toggle-task" data-id="${esc(task.id)}">${task.done?icon('check'):''}</button>`;
}
function taskLine(task){
 const id=esc(task.id),priority={high:'高',normal:'普通',low:'低'}[task.priority];
 return `<div class="task-line ${task.done?'completed':''}">
   ${taskCheck(task)}
   <button class="task-content" data-action="edit-task" data-id="${id}">
     <span class="task-title">${esc(task.title)}</span>
     <span class="task-meta"><i class="priority-dot ${task.priority}" role="img" aria-label="${priority}优先级" title="${priority}优先级"></i>${task.date?`${shortDate(task.date)} ${SLOT_NAMES[task.slot]}`:'待安排'}
       ${task.due?`<span class="${task.due<today()&&!task.done?'overdue-text':''}">· ${deadlineLabel(task.due)}</span>`:''}
     </span>
   </button>
   ${task.done?'':`<button class="text-button" data-action="${task.date?'tomorrow':'schedule-task'}" data-id="${id}">${task.date?'顺延':'安排'}</button>`}
 </div>`;
}
const PAGES={calendar:['日历计划','calendar'],tasks:['任务清单','list'],milestones:['重要日子','flag'],settings:['偏好设置','settings']};
function render(){
 const previousScroll=$('.calendar-scroll');
 const scrollLeft=previousScroll?.dataset.date===selected?previousScroll.scrollLeft:null;
 $('#navigation').innerHTML=Object.entries(PAGES).map(([id,[name,symbol]])=>`<button class="nav-item ${view===id?'active':''}" data-action="nav" data-view="${id}" aria-label="${name}" title="${name}" ${view===id?'aria-current="page"':''}>${icon(symbol)}</button>`).join('');
 $('#page-title').textContent=PAGES[view][0];
 const create=$('#create-item');
 create.hidden=view==='settings';
 create.dataset.action=view==='milestones'?'new-milestone':'new-task';
 create.textContent=view==='milestones'?'＋ 添加倒数日':'＋ 新建任务';
 updateSaveLabel();
 const events=byDate(allDates());
 renderMini(events);
 $('#main').innerHTML=view==='calendar'?renderCalendar(events):view==='tasks'?renderTasks():view==='milestones'?renderMilestones():renderSettings();
 const scroll=$('.calendar-scroll');
 if(scroll&&scroll.scrollWidth>scroll.clientWidth){
   const header=scroll.querySelector('.week-header.selected');
   const gutter=scroll.querySelector('.week-time').offsetWidth;
   scroll.scrollLeft=scrollLeft??header.offsetLeft-(scroll.clientWidth+gutter-header.offsetWidth)/2;
 }
 document.dispatchEvent(new Event('dayloom:render'));
}
function renderMini(events){
 const d=parseDate(selected),first=localDate(new Date(d.getFullYear(),d.getMonth(),1)),start=weekStart(first),current=today();
 $('#mini-calendar').innerHTML=`<div class="mini-title"><b>${d.getFullYear()}年 ${d.getMonth()+1}月</b><div>
   <button class="icon-button" data-action="mini-month" data-delta="-1" aria-label="上个月">${icon('left')}</button><button class="icon-button" data-action="mini-month" data-delta="1" aria-label="下个月">${icon('right')}</button>
 </div></div><div class="mini-grid">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}${Array.from({length:42},(_,i)=>{
   const date=addDays(start,i);
   return `<button class="mini-day ${date===selected?'selected':''} ${date===current?'today':''} ${date.slice(0,7)!==first.slice(0,7)?'out':''} ${events.has(date)?'has-event':''}" data-action="select-date" data-date="${date}" aria-label="${fullDate(date)}" aria-pressed="${date===selected}">${+date.slice(-2)}</button>`;
 }).join('')}</div>`;
}
function renderCalendar(events){
 const week=calendarMode==='week',start=weekStart(selected),end=addDays(start,6);
 const endLabel=start.slice(0,7)===end.slice(0,7)?`${+end.slice(-2)}日`:start.slice(0,4)===end.slice(0,4)?shortDate(end):fullDate(end);
 const title=week?`${fullDate(start)} – ${endLabel}`:`${selected.slice(0,4)}年${+selected.slice(5,7)}月`;
 const tasks=byDate(state.tasks);
 return `<section class="calendar-panel" aria-labelledby="calendar-title">
   <header class="calendar-toolbar">
     <div class="calendar-title"><h2 id="calendar-title">${title}</h2><label class="date-jump" title="跳转日期">${icon('calendar')}<input id="plan-date" type="date" aria-label="跳转日期" value="${selected}"></label></div>
     <div class="calendar-controls">
       <button class="icon-button" aria-label="上一${week?'周':'月'}" data-action="calendar-prev">${icon('left')}</button>
       <button class="button small" data-action="today">今天</button>
       <button class="icon-button" aria-label="下一${week?'周':'月'}" data-action="calendar-next">${icon('right')}</button>
       <div class="segmented"><button aria-pressed="${week}" data-action="calendar-mode" data-mode="week">周</button><button aria-pressed="${!week}" data-action="calendar-mode" data-mode="month">月</button></div>
     </div>
   </header>
   ${week?renderWeek(start,tasks,events):renderMonth(tasks,events)}
 </section>`;
}
function calendarEvent(event,showType){
 const label=`${DATE_TYPES[event.type]} · ${esc(event.title)}`;
 return `<button class="cell-deadline" title="${label}" data-action="${event.kind==='task'?'edit-task':'edit-milestone'}" data-id="${esc(event.id)}">${showType?label:esc(event.title)}</button>`;
}
function weekCell(date,slot,tasks,events,courses){
 const selectedClass=date===selected?'selected':'';
 if(slot==='exercise'){
   const done=!!state.exerciseDone[date],label=`${done?'取消':'完成'}${shortDate(date)}锻炼`;
   return `<div class="week-cell exercise-cell ${selectedClass}"><button class="check ${done?'checked':''}" role="checkbox" aria-label="${label}" title="${label}" aria-checked="${done}" data-action="exercise" data-date="${date}">${done?icon('check'):''}</button></div>`;
 }
 const range=state.settings.slots[slot];
 return `<div class="week-cell ${selectedClass}" data-drop-date="${date}" data-drop-slot="${slot}">
   ${slot==='morning'?events.map(event=>calendarEvent(event,true)).join(''):''}
   ${courses.filter(c=>overlaps(range,[SECTIONS[c.start-1][0],SECTIONS[c.end-1][1]])).map(c=>`<span class="course-hint" title="${SECTIONS[c.start-1][0]}–${SECTIONS[c.end-1][1]}">${esc(c.name)}</span>`).join('')}
   ${tasks.filter(task=>task.slot===slot).map(task=>`<div class="week-task ${slot} ${task.done?'done':''}" draggable="true" data-task-id="${esc(task.id)}">
     ${taskCheck(task)}<button class="week-task-title" data-action="edit-task" data-id="${esc(task.id)}">${esc(task.title)}</button>
   </div>`).join('')}
   <button class="cell-add" data-action="new-task" data-date="${date}" data-slot="${slot}" aria-label="添加${shortDate(date)}${SLOT_NAMES[slot]}任务">${icon('plus')}</button>
 </div>`;
}
function renderWeek(start,tasks,events){
 const days=Array.from({length:7},(_,i)=>addDays(start,i)),current=today();
 const courses=days.map(courseEvents),ranges={...state.settings.slots};
 if(state.settings.exerciseEnabled)ranges.exercise=state.settings.exercise;
 const rows=Object.entries(ranges).sort(([,a],[,b])=>a[0].localeCompare(b[0]));
 return `<div class="calendar-scroll" data-date="${selected}"><div class="week-grid">
   <div class="week-header corner"></div>
   ${days.map((date,i)=>`<button class="week-header ${date===selected?'selected':''} ${date===current?'today':''}" data-action="select-date" data-date="${date}" aria-label="${fullDate(date)} ${WEEKDAYS[i]}" aria-pressed="${date===selected}">${WEEKDAYS[i]}<b>${+date.slice(-2)}</b></button>`).join('')}
   ${rows.map(([slot,range])=>`<div class="week-time ${slot}"><b>${SLOT_NAMES[slot]||'锻炼'}</b><span>${range.join('–')}</span></div>${days.map((date,i)=>weekCell(date,slot,tasks.get(date)||[],events.get(date)||[],courses[i])).join('')}`).join('')}
 </div></div>`;
}
function renderMonth(tasks,events){
 const first=selected.slice(0,7)+'-01',start=weekStart(first),current=today();
 return `<div class="month-grid">${WEEKDAYS.map(x=>`<div class="month-weekday">${x}</div>`).join('')}${Array.from({length:42},(_,i)=>{
   const date=addDays(start,i),items=tasks.get(date)||[],done=items.filter(task=>task.done).length;
   return `<div class="month-cell ${date===selected?'selected':''} ${date.slice(0,7)!==first.slice(0,7)?'out':''}">
     <button class="month-date ${date===current?'today':''}" data-action="select-date" data-mode="week" data-date="${date}" aria-label="查看${fullDate(date)}的周历">${+date.slice(-2)}</button>
     ${(events.get(date)||[]).slice(0,2).map(event=>calendarEvent(event,false)).join('')}
     ${items.length?`<button class="month-summary" data-action="select-date" data-mode="week" data-date="${date}" aria-label="查看${shortDate(date)}任务，已完成 ${done} 项，共 ${items.length} 项">${done}/${items.length} 项</button>`:''}
   </div>`;
 }).join('')}</div>`;
}
function renderTasks(){
 const labels={open:'未完成',today:'今天',unscheduled:'待安排',overdue:'已逾期',done:'已完成',all:'全部'},current=today();
 const matches={open:t=>!t.done,today:t=>t.date===current,unscheduled:t=>!t.date&&!t.done,overdue:t=>t.due&&t.due<current&&!t.done,done:t=>t.done,all:()=>true};
 const query=search.toLowerCase();
 const list=state.tasks.filter(t=>matches[filter](t)&&(!query||(t.title+' '+t.note).toLowerCase().includes(query)));
 const pending=state.tasks.some(t=>!t.done&&!t.date),scheduled=tasksIn(selected).some(t=>!t.done);
 return `<div class="view-wide">
   <form id="quick-task" class="quick-entry"><input name="title" aria-label="添加待安排任务" placeholder="添加待安排任务" value="${esc(quickDraft)}" maxlength="200" required><button type="submit" aria-label="添加待安排任务">${icon('plus')}</button></form>
   <div class="filters">${Object.entries(labels).map(([id,label])=>`<button class="filter" aria-pressed="${filter===id}" data-action="filter" data-filter="${id}">${label}</button>`).join('')}<input class="search-input" id="task-search" type="search" placeholder="搜索任务或备注" aria-label="搜索任务或备注" value="${esc(search)}"></div>
   <div class="task-table">${list.length?sortedTasks(list).map(taskLine).join(''):`<p class="empty-large">${search?'没有匹配的任务':'暂无任务'}</p>`}</div>
   ${pending||scheduled?`<div class="list-actions">${pending?`<button class="button small" data-action="auto-plan">安排待办到 ${shortDate(selected)}</button>`:''}${scheduled?`<button class="button small" data-action="rollover">顺延 ${shortDate(selected)}未完成任务</button>`:''}</div>`:''}
 </div>`;
}
function renderMilestones(){
 const items=allDates(),completed=state.milestones.filter(m=>m.done);
 return `<div class="view-wide">${items.length?`<div class="milestone-grid">${items.map(m=>{
   const n=dateDiff(m.date,today());
   return `<article class="milestone-card"><span class="tag">${DATE_TYPES[m.type]}</span><button class="icon-button" data-action="${m.kind==='task'?'edit-task':'edit-milestone'}" data-id="${esc(m.id)}" aria-label="编辑${esc(m.title)}">${icon('edit')}</button>
     <h2>${esc(m.title)}</h2><div class="large-number ${n<0?'overdue-text':''}">${n===0?'今天':`${Math.abs(n)}<small>${n<0?'天前':'天后'}</small>`}</div><p>${fullDate(m.date)}</p>
     ${m.note?`<p class="notes-text">${esc(m.note)}</p>`:''}</article>`;
 }).join('')}</div>`:`<p class="panel empty-large">暂无待办的重要日子</p>`}
 ${completed.length?`<details class="settings-card"><summary>已完成（${completed.length}）</summary>${completed.map(m=>`<div class="countdown"><button class="countdown-info" data-action="edit-milestone" data-id="${esc(m.id)}"><strong>${esc(m.title)}</strong><small>${fullDate(m.date)}</small></button></div>`).join('')}</details>`:''}</div>`;
}
function renderSettings(){
 const s=state.settings;
 return `<div class="view-wide"><form id="settings-form">
   <section class="settings-card"><h2>日历时段 <small>北京时间</small></h2>
     ${SLOT_IDS.map(id=>`<div class="settings-row"><label for="${id}-start">${SLOT_NAMES[id]}</label><div class="time-pair">
       <input id="${id}-start" name="${id}-start" aria-label="${SLOT_NAMES[id]}开始时间" type="time" value="${s.slots[id][0]}" required><span>至</span>
       <input name="${id}-end" aria-label="${SLOT_NAMES[id]}结束时间" type="time" value="${s.slots[id][1]}" required></div></div>`).join('')}
     <div class="settings-row"><label for="exercise-start">锻炼</label><div class="time-pair">
       <input id="exercise-start" aria-label="锻炼开始时间" type="time" name="exercise-start" value="${s.exercise[0]}" required><span>至</span>
       <input aria-label="锻炼结束时间" type="time" name="exercise-end" value="${s.exercise[1]}" required></div></div>
     <label class="setting-switch"><input type="checkbox" name="exerciseEnabled" ${s.exerciseEnabled?'checked':''}>在周历中显示锻炼</label>
   </section>
   <section class="settings-card"><h2>课表</h2>
     <label class="setting-switch"><input type="checkbox" name="courseHints" ${s.courseHints?'checked':''}>在周历中显示课程</label>
     <div class="settings-row"><label for="semester">第 1 周的周一</label><input type="date" id="semester" name="semester" value="${s.semester}" required></div>
     <details><summary>课表参考</summary><div class="course-list">2026–2027 学年第 1 学期 · 第 1–8 节，排除实验课<br>${[...new Set((window.COURSE_DATA||[]).map(c=>c.name))].map(esc).join('、')}<br>${SECTIONS.map((p,i)=>`第 ${i+1} 节 ${p.join('–')}`).join(' / ')}</div></details>
   </section>
   <div class="settings-footer"><div class="form-error" id="settings-error" role="alert"></div><button class="button primary" type="submit">保存设置</button></div>
 </form><section class="settings-card"><h2>数据与备份</h2><div class="settings-actions"><button class="button" data-action="export">${icon('download')} 导出备份</button><button class="button" data-action="import">从备份恢复</button></div></section></div>`;
}
function showDialog(title,body,footer){$('#dialog-content').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" aria-label="关闭" data-action="close-dialog">${icon('close')}</button></div>${body}${footer||''}`;if(!$('#editor').open)$('#editor').showModal();}
function taskEditor(id,defaults={}){
 const old=state.tasks.find(t=>t.id===id);
 const t=old||{id:'',title:'',date:defaults.date??selected,slot:defaults.slot||'morning',priority:'normal',due:'',note:''};
 showDialog(old?'编辑任务':'新建任务',`<form id="task-form"><div class="dialog-body">
   <input type="hidden" name="id" value="${esc(t.id)}">
   <label class="field"><span>任务名称</span><input name="title" maxlength="200" value="${esc(t.title)}" required autofocus></label>
   <div class="field-grid">
     <label class="field"><span>计划日期（留空待安排）</span><input type="date" name="date" value="${t.date}"></label>
     <label class="field"><span>时段</span><select name="slot">${SLOT_IDS.map(slot=>`<option value="${slot}" ${slot===t.slot?'selected':''}>${SLOT_NAMES[slot]} ${state.settings.slots[slot].join('–')}</option>`).join('')}</select></label>
     <label class="field"><span>截止日期（可选）</span><input type="date" name="due" value="${t.due}"></label>
     <label class="field"><span>优先级</span><select name="priority">${[['high','高'],['normal','普通'],['low','低']].map(([value,label])=>`<option value="${value}" ${value===t.priority?'selected':''}>${label}</option>`).join('')}</select></label>
   </div>
   <label class="field"><span>备注</span><textarea name="note" maxlength="3000">${esc(t.note)}</textarea></label>
   <p id="task-date-warning" class="form-help" hidden>计划日期晚于截止日期。</p><div class="form-error" id="task-error" role="alert"></div>
 </div><div class="dialog-footer">${old?`<button class="button danger" type="button" data-action="delete-task" data-id="${esc(t.id)}">删除</button>`:''}
   <button class="button" type="button" data-action="close-dialog">取消</button><button class="button primary" type="submit">${old?'保存修改':'添加任务'}</button>
 </div></form>`);
 const form=$('#task-form');
 const checkDates=()=>{const {date,due}=form.elements;$('#task-date-warning').hidden=!due.value||date.value<=due.value;};
 form.addEventListener('input',checkDates);
 checkDates();
}
function milestoneEditor(id){const old=state.milestones.find(m=>m.id===id),m=old||{id:'',title:'',date:'',type:'exam',done:false,note:''};showDialog(old?'编辑重要日子':'添加倒数日',`<form id="milestone-form"><div class="dialog-body"><input type="hidden" name="id" value="${esc(m.id)}"><label class="field"><span>名称</span><input name="title" maxlength="200" value="${esc(m.title)}" required autofocus></label><div class="field-grid"><label class="field"><span>日期</span><input type="date" name="date" value="${m.date}" required></label><label class="field"><span>类型</span><select name="type">${[['exam','考试'],['deadline','截止日'],['other','目标日']].map(([id,label])=>`<option value="${id}" ${id===m.type?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="field"><span>备注 · 可选</span><textarea name="note" maxlength="3000" >${esc(m.note)}</textarea></label><label class="checkbox-field"><input name="done" type="checkbox" ${m.done?'checked':''}>已完成</label><div class="form-error" id="milestone-error"></div></div><div class="dialog-footer">${old?`<button class="button danger" type="button" data-action="delete-milestone" data-id="${esc(m.id)}">删除</button>`:''}<button class="button" type="button" data-action="close-dialog">取消</button><button class="button primary" type="submit">${old?'保存修改':'添加日期'}</button></div></form>`);}
function confirmDialog(title,text,action,label='确认'){showDialog(title,`<div class="dialog-body"><p style="font-size:13px;line-height:1.9">${esc(text)}</p></div><div class="dialog-footer"><button class="button" data-action="close-dialog">取消</button><button class="button primary" id="confirm-action">${label}</button></div>`);$('#confirm-action').onclick=()=>{$('#editor').close();action();};}
function scheduleTask(id,date=selected,slot){
 const task=state.tasks.find(t=>t.id===id);
 if(!task)return;
 const targetSlot=slot||task.slot;
 mutate(()=>{task.date=date;task.slot=targetSlot;},`已安排到 ${shortDate(date)}${SLOT_NAMES[targetSlot]}`);
}
function autoPlan(){
 const pending=state.tasks.filter(t=>!t.done&&!t.date&&(!t.due||t.due>=selected));
 if(!pending.length){toast('没有可安排到这一天的待办任务');return;}
 confirmDialog('安排待办',`将 ${pending.length} 项待办安排到 ${shortDate(selected)}各自选定的时段。`,()=>mutate(()=>{
   for(const task of pending)task.date=selected;
   view='calendar';calendarMode='week';
 },`已安排 ${pending.length} 项任务`),'确认安排');
}
function exportBackup(){const data=JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`时序备份-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('备份已导出，可在其他设备导入');}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const {action,id,date,slot}=b.dataset;
 switch(action){
 case 'nav':view=b.dataset.view;render();window.scrollTo(0,0);break;
 case 'new-task':taskEditor(null,{date:date===undefined?selected:date,slot});break;
 case 'edit-task':taskEditor(id);break;
 case 'toggle-task':mutate(()=>{const t=state.tasks.find(t=>t.id===id);t.done=!t.done;},'任务状态已更新');break;
 case 'new-milestone':milestoneEditor();break;
 case 'edit-milestone':milestoneEditor(id);break;
 case 'close-dialog':$('#editor').close();break;
 case 'delete-task':confirmDialog('删除任务','删除后可通过底部的「撤销」恢复。',()=>mutate(()=>{state.tasks=state.tasks.filter(t=>t.id!==id);},'任务已删除'),'删除任务');break;
 case 'delete-milestone':confirmDialog('删除倒数日','删除后可通过底部的「撤销」恢复。',()=>mutate(()=>{state.milestones=state.milestones.filter(t=>t.id!==id);},'倒数日已删除'),'删除日期');break;
 case 'exercise':mutate(()=>{if(state.exerciseDone[date])delete state.exerciseDone[date];else state.exerciseDone[date]=true;},state.exerciseDone[date]?'已取消锻炼打卡':'已完成锻炼');break;
 case 'select-date':
   if(validDate(date)){selected=date;view='calendar';if(b.dataset.mode)calendarMode=b.dataset.mode;render();}
   break;
 case 'today':selected=today();render();break;
 case 'mini-month':
 case 'calendar-prev':
 case 'calendar-next':{
   const mini=action==='mini-month',delta=mini?Number(b.dataset.delta):action==='calendar-next'?1:-1;
   if(!mini&&calendarMode==='week')selected=addDays(selected,7*delta);
   else{const d=parseDate(selected);selected=localDate(new Date(d.getFullYear(),d.getMonth()+delta,1));}
   view='calendar';render();break;
 }
 case 'calendar-mode':calendarMode=b.dataset.mode;render();break;
 case 'filter':filter=b.dataset.filter;render();break;
 case 'schedule-task':scheduleTask(id);break;
 case 'tomorrow':{const t=state.tasks.find(t=>t.id===id);scheduleTask(id,addDays(t.date||selected,1),t.slot);break;}
 case 'rollover':{const tasks=tasksIn(selected).filter(t=>!t.done);if(!tasks.length){toast('这天没有需要顺延的任务');break;}const next=addDays(selected,1);confirmDialog('把未完成任务顺延一天',`将 ${tasks.length} 项任务移到 ${shortDate(next)}，保留原时段。`,()=>mutate(()=>{for(const t of tasks)t.date=next;selected=next;},`已顺延 ${tasks.length} 项任务`),'确认顺延');break;}
 case 'auto-plan':autoPlan();break;
 case 'undo':if(undoState){state=undoState.state;selected=undoState.selected;undoState=null;save();render();toast('已撤销上一步修改');}break;
 case 'export':exportBackup();break;
 case 'import':$('#import-file').click();break;
 }
});
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();view='calendar';selected=today();render();});
document.addEventListener('change',e=>{if(e.target.id==='plan-date'&&validDate(e.target.value)){selected=e.target.value;render();}});
document.addEventListener('input',e=>{
 if(e.target.matches('#quick-task [name="title"]'))quickDraft=e.target.value;
 if(e.target.id==='task-search'){
   search=e.target.value;
   const pos=e.target.selectionStart;
   $('#main').innerHTML=renderTasks();
   $('#task-search').focus();
   $('#task-search').setSelectionRange(pos,pos);
 }
});
document.addEventListener('submit',e=>{const form=e.target;const formId=form.getAttribute('id');if(!['task-form','milestone-form','settings-form','quick-task'].includes(formId))return;e.preventDefault();const f=new FormData(form);
 if(formId==='quick-task'){const title=String(f.get('title')).trim();if(!title)return;quickDraft='';mutate(()=>state.tasks.push({id:uid(),title,date:'',slot:'morning',priority:'normal',due:'',done:false,note:''}),'已加入待安排');return;}
 if(formId==='task-form'){const old=state.tasks.find(t=>t.id===f.get('id'));const t={id:old?.id||uid(),title:String(f.get('title')).trim(),date:String(f.get('date')),slot:String(f.get('slot')),priority:String(f.get('priority')),due:String(f.get('due')),note:String(f.get('note')).trim(),done:old?.done||false};try{validateState({...state,tasks:[...state.tasks.filter(x=>x.id!==t.id),t]});}catch(err){$('#task-error').textContent=err.message;return;}$('#editor').close();mutate(()=>{if(old)Object.assign(old,t);else state.tasks.push(t);},old?'任务已更新':t.date?'已添加到日历':'已加入待安排');return;}
 if(formId==='milestone-form'){const old=state.milestones.find(m=>m.id===f.get('id'));const m={id:old?.id||uid(),title:String(f.get('title')).trim(),date:String(f.get('date')),type:String(f.get('type')),note:String(f.get('note')).trim(),done:f.has('done')};try{validateState({...state,milestones:[...state.milestones.filter(x=>x.id!==m.id),m]});}catch(err){$('#milestone-error').textContent=err.message;return;}$('#editor').close();mutate(()=>{if(old)Object.assign(old,m);else state.milestones.push(m);},'重要日期已保存');return;}
 if(formId==='settings-form'){const s={...state.settings,semester:String(f.get('semester')),courseHints:f.has('courseHints'),exerciseEnabled:f.has('exerciseEnabled'),exercise:[String(f.get('exercise-start')),String(f.get('exercise-end'))],slots:Object.fromEntries(SLOT_IDS.map(id=>[id,[String(f.get(id+'-start')),String(f.get(id+'-end'))]]))};try{validateState({...state,settings:s});}catch(err){$('#settings-error').textContent=err.message;return;}mutate(()=>{state.settings=s;},'设置已保存');}
});
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>15*1024*1024)throw Error('备份文件过大');const incoming=validateState(JSON.parse(await file.text()));confirmDialog('从备份恢复',`备份含 ${incoming.tasks.length} 项任务、${incoming.milestones.length} 个重要日期。将替换当前的 ${state.tasks.length} 项任务和 ${state.milestones.length} 个重要日期。建议先导出当前备份。`,()=>mutate(()=>{state=incoming;},'备份已恢复'),'替换并恢复');}catch(err){toast('无法导入：'+err.message);}});
let draggedId='';document.addEventListener('dragstart',e=>{const task=e.target.closest('[data-task-id]');if(task){draggedId=task.dataset.taskId;e.dataTransfer.setData('text/plain',draggedId);e.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragover',e=>{const target=e.target.closest('[data-drop-date]');if(target&&draggedId){e.preventDefault();target.classList.add('drop-target');}});
document.addEventListener('dragleave',e=>{const target=e.target.closest('[data-drop-date]');if(target&&!target.contains(e.relatedTarget))target.classList.remove('drop-target');});
document.addEventListener('drop',e=>{const target=e.target.closest('[data-drop-date]');if(target&&draggedId){e.preventDefault();scheduleTask(draggedId,target.dataset.dropDate,target.dataset.dropSlot);}draggedId='';document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
document.addEventListener('dragend',()=>{draggedId='';document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
window.addEventListener('storage',e=>{if(e.key===STORAGE&&e.newValue){if($('#editor').open){toast('另一个标签页修改了计划；请先关闭编辑窗口再刷新，以查看最新数据。');return;}try{state=validateState(JSON.parse(e.newValue));undoState=null;render();toast('已更新另一个标签页的修改');}catch{toast('另一个标签页的数据格式异常，请检查备份');}}});
setInterval(()=>{const now=today();if(lastToday!==now){const wasToday=selected===lastToday;lastToday=now;if(wasToday)selected=now;if(!$('#editor').open)render();}},30000);
render();if(upgradeLocal)save(false);if(initialError)toast(initialError);
// Shared helpers for validation, the local planner, and optional cloud synchronization.
document.addEventListener('input',e=>{if(e.target.closest('#settings-form'))$('#settings-form').dataset.dirty='true';});
window.Dayloom={dateDiff,addDays,weekStart,validDate,validateState,defaultSettings,courseEvents,getState:()=>clone(state),emptyState:newState,showDialog,toast,isEditing:()=>$('#editor').open||Boolean($('#quick-task input')?.value.trim())||$('#settings-form')?.dataset.dirty==='true'||Boolean(document.activeElement?.matches('input,textarea,select')),applySync:next=>{const checked=validateState(next);localStorage.setItem(STORAGE,JSON.stringify(checked));state=checked;undoState=null;render();}};
})();
