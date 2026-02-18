// Email Sorter AI - Sidebar v3.6.0
// FIX: closeSidebar uses window.parent.postMessage for iframe communication

const DEFAULT_SETTINGS = {
  autoScanEnabled:true,rulesEngineEnabled:true,aiClassificationEnabled:true,parseAttachments:false,
  aiProvider:'openai',openaiKey:'',claudeKey:'',openaiModel:'gpt-4o-mini',claudeModel:'claude-sonnet-4-20250514',
  rules:[],parentLabel:'EMAIL_SORTER',confidenceThreshold:0.75,maxEmailsPerScan:50,scanIntervalMinutes:10,whitelist:'',blacklist:''
};

let currentSettings = {}, editingRuleIndex = -1;

document.addEventListener('DOMContentLoaded', () => { loadSettings(); setupEvents(); });

function loadSettings() {
  chrome.runtime.sendMessage({action:'getSettings'}, r => {
    if(chrome.runtime.lastError){showToast('Chyba nacitani','error');return;}
    currentSettings = r || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    updateUI();
  });
  chrome.runtime.sendMessage({action:'getStats'}, s => {
    if(chrome.runtime.lastError||!s) return;
    setText('overviewProcessed',s.processed||0);
    setText('overviewRules',s.rulesMatched||0);
    setText('overviewAI',s.aiMatched||0);
  });
}

function updateUI() {
  const s=currentSettings;
  setRadio('providerOpenAI',s.aiProvider==='openai');
  setRadio('providerClaude',s.aiProvider==='claude');
  setVal('openaiKey',s.openaiKey||'');setVal('claudeKey',s.claudeKey||'');
  setVal('openaiModel',s.openaiModel||'gpt-4o-mini');setVal('claudeModel',s.claudeModel||'claude-sonnet-4-20250514');
  setVal('parentLabel',s.parentLabel||'EMAIL_SORTER');
  setVal('confidenceThreshold',s.confidenceThreshold||0.75);updateThreshold();
  setVal('maxEmails',s.maxEmailsPerScan||50);setVal('scanInterval',s.scanIntervalMinutes||10);
  setVal('whitelist',s.whitelist||'');setVal('blacklist',s.blacklist||'');
  renderRules();
}

function updateThreshold() { const e=document.getElementById('confidenceThreshold'),d=document.getElementById('thresholdValue'); if(e&&d) d.textContent=parseFloat(e.value).toFixed(2); }

function renderRules() {
  const rules=currentSettings.rules||[], c=document.getElementById('rulesList');
  if(!c) return;
  if(!rules.length){c.innerHTML='<div class="empty-state">Zadna pravidla</div>';return;}
  c.innerHTML=rules.map((r,i)=>'<div class="rule-item"><div class="rule-item-info"><h4>'+esc(r.name||'?')+'</h4><p>'+esc(r.type||'')+' • '+esc(r.label||'')+' '+(r.active?'✅':'❌')+'</p></div><div class="rule-item-actions"><button class="rule-edit-btn" data-i="'+i+'">Upravit</button><button class="rule-delete-btn" data-i="'+i+'">Smazat</button></div></div>').join('');
  c.querySelectorAll('.rule-edit-btn').forEach(b=>b.addEventListener('click',e=>editRule(+e.target.dataset.i)));
  c.querySelectorAll('.rule-delete-btn').forEach(b=>b.addEventListener('click',e=>deleteRule(+e.target.dataset.i)));
}

function setupEvents() {
  // FIX v3.6.0: Close button uses postMessage to communicate with parent Gmail page
  onClick('closeBtn', closeSidebar);
  onClick('addRuleBtn', ()=>{editingRuleIndex=-1;setText('modalTitle','Nove pravidlo');clearForm();showModal(true);});
  onClick('modalClose',()=>showModal(false));onClick('modalCancel',()=>showModal(false));
  onClick('modalSave',saveRule);onClick('saveBtn',saveAll);onClick('processBtn',processEmails);
  onClick('testOpenAIBtn',()=>testAPI('openai'));onClick('testClaudeBtn',()=>testAPI('claude'));
  onChange('providerOpenAI',()=>{currentSettings.aiProvider='openai';});
  onChange('providerClaude',()=>{currentSettings.aiProvider='claude';});
  onChange('openaiKey',e=>{currentSettings.openaiKey=e.target.value;});
  onChange('claudeKey',e=>{currentSettings.claudeKey=e.target.value;});
  onChange('openaiModel',e=>{currentSettings.openaiModel=e.target.value;});
  onChange('claudeModel',e=>{currentSettings.claudeModel=e.target.value;});
  onChange('parentLabel',e=>{currentSettings.parentLabel=e.target.value;});
  onInput('confidenceThreshold',e=>{currentSettings.confidenceThreshold=parseFloat(e.target.value);updateThreshold();});
  onChange('maxEmails',e=>{currentSettings.maxEmailsPerScan=parseInt(e.target.value)||50;});
  onChange('scanInterval',e=>{currentSettings.scanIntervalMinutes=parseInt(e.target.value)||10;});
  onChange('whitelist',e=>{currentSettings.whitelist=e.target.value;});
  onChange('blacklist',e=>{currentSettings.blacklist=e.target.value;});
  const fwd=document.getElementById('ruleForwardEmail');
  if(fwd) fwd.addEventListener('change',e=>{const g=document.getElementById('forwardGroup');if(g)g.style.display=e.target.checked?'block':'none';});
  const cal=document.getElementById('ruleCalendar');
  if(cal) cal.addEventListener('change',e=>{const g=document.getElementById('calendarGroup');if(g)g.style.display=e.target.checked?'block':'none';});
}

// FIX v3.6.0: Use postMessage to tell parent (Gmail content.js) to close sidebar
function closeSidebar() {
  // Method 1: postMessage to parent frame (primary - works for iframe)
  try { window.parent.postMessage({action:'emailSorterClose'}, '*'); } catch(e) {}
  // Method 2: chrome.runtime fallback (background forwards to Gmail tabs)
  try { chrome.runtime.sendMessage({action:'closeSidebar'}); } catch(e) {}
}

function testAPI(provider) {
  const btnId=provider==='openai'?'testOpenAIBtn':'testClaudeBtn';
  const resId=provider==='openai'?'openaiTestResult':'claudeTestResult';
  const btn=document.getElementById(btnId), res=document.getElementById(resId);
  const keyEl=document.getElementById(provider==='openai'?'openaiKey':'claudeKey');
  const modEl=document.getElementById(provider==='openai'?'openaiModel':'claudeModel');
  const key=keyEl?keyEl.value:'', mod=modEl?modEl.value:'';
  if(!key.trim()){if(res){res.textContent='Zadejte API klic';res.className='api-test-result error';}return;}
  if(btn){btn.disabled=true;btn.textContent='Testuji...';}
  if(res){res.textContent='';res.className='api-test-result';}
  chrome.runtime.sendMessage({action:'testAPI',provider,apiKey:key,model:mod}, response => {
    if(btn){btn.disabled=false;btn.textContent='Otestovat';}
    if(chrome.runtime.lastError){if(res){res.textContent=chrome.runtime.lastError.message;res.className='api-test-result error';}return;}
    if(response&&response.success){if(res){res.textContent=response.message;res.className='api-test-result success';}showToast('API funguje!','success');}
    else{if(res){res.textContent=response?response.error:'Chyba';res.className='api-test-result error';}showToast('Test selhal','error');}
  });
}

function editRule(i) {
  if(i<0||i>=(currentSettings.rules||[]).length) return;
  editingRuleIndex=i; const r=currentSettings.rules[i];
  setText('modalTitle','Upravit pravidlo');
  setVal('ruleName',r.name||'');setVal('ruleType',r.type||'ostatni');setVal('ruleLabel',r.label||'');
  setVal('ruleSenders',(r.senders||[]).join(', '));setVal('ruleSubjectKeys',(r.subjectKeys||[]).join('\n'));setVal('ruleBodyKeys',(r.bodyKeys||[]).join('\n'));
  const a=r.actions||[];
  setChk('ruleStar',a.includes('star'));setChk('rulePriority',a.includes('markImportant'));
  setChk('ruleForwardEmail',a.includes('forward'));setChk('ruleCalendar',a.includes('calendar'));
  setVal('ruleForwardTo',r.forwardTo||'');setVal('ruleCalendarTitle',r.calendarTitle||'');setVal('ruleCalendarDays',r.calendarDays||0);
  const fg=document.getElementById('forwardGroup'),cg=document.getElementById('calendarGroup');
  if(fg)fg.style.display=a.includes('forward')?'block':'none';
  if(cg)cg.style.display=a.includes('calendar')?'block':'none';
  showModal(true);
}

function clearForm() {
  ['ruleName','ruleLabel','ruleSenders','ruleSubjectKeys','ruleBodyKeys','ruleForwardTo','ruleCalendarTitle'].forEach(id=>setVal(id,''));
  setVal('ruleType','ostatni');setVal('ruleCalendarDays',0);
  ['ruleForwardEmail','ruleStar','rulePriority','ruleCalendar'].forEach(id=>setChk(id,false));
  const fg=document.getElementById('forwardGroup'),cg=document.getElementById('calendarGroup');
  if(fg)fg.style.display='none';if(cg)cg.style.display='none';
}

function saveRule() {
  const name=getVal('ruleName').trim(),label=getVal('ruleLabel').trim();
  if(!name||!label){showToast('Nazev a stitek povinne','error');return;}
  const actions=['addLabel'];
  if(isChk('ruleForwardEmail'))actions.push('forward');if(isChk('ruleStar'))actions.push('star');
  if(isChk('rulePriority'))actions.push('markImportant');if(isChk('ruleCalendar'))actions.push('calendar');
  const rule={
    id:editingRuleIndex>=0?(currentSettings.rules[editingRuleIndex].id||name.toLowerCase().replace(/\s+/g,'-')):name.toLowerCase().replace(/\s+/g,'-'),
    name,type:getVal('ruleType')||'ostatni',active:true,label,confidence:1.0,actions,
    senders:getVal('ruleSenders').split(',').map(s=>s.trim()).filter(s=>s),
    subjectKeys:getVal('ruleSubjectKeys').split('\n').map(s=>s.trim()).filter(s=>s),
    bodyKeys:getVal('ruleBodyKeys').split('\n').map(s=>s.trim()).filter(s=>s)
  };
  if(editingRuleIndex>=0){currentSettings.rules[editingRuleIndex]=rule;showToast('Aktualizovano','success');}
  else{if(!currentSettings.rules)currentSettings.rules=[];currentSettings.rules.push(rule);showToast('Pridano','success');}
  renderRules();showModal(false);
}

function deleteRule(i){if(confirm('Smazat?')){currentSettings.rules.splice(i,1);showToast('Smazano','success');renderRules();}}

function saveAll() {
  const btn=document.getElementById('saveBtn');
  if(btn){btn.disabled=true;btn.textContent='Ukladam...';}
  chrome.runtime.sendMessage({action:'saveSettings',settings:currentSettings}, r => {
    if(btn){btn.disabled=false;btn.textContent='Ulozit nastaveni';}
    if(chrome.runtime.lastError){showToast('Chyba','error');return;}
    showToast('Ulozeno','success');
  });
}

function processEmails() {
  const btn=document.getElementById('processBtn');
  if(btn){btn.disabled=true;btn.textContent='Zpracovavam...';}
  chrome.runtime.sendMessage({action:'processEmails',settings:currentSettings}, r => {
    if(btn){btn.disabled=false;btn.textContent='Zpracovat nyni';}
    if(chrome.runtime.lastError||!r){showToast('Chyba','error');return;}
    if(r.success&&r.data){showToast('Zpracovano '+r.data.processed+', oznaceno '+r.data.labeled,'success');setText('overviewProcessed',r.data.processed||0);setText('overviewRules',r.data.rulesMatched||0);setText('overviewAI',r.data.aiMatched||0);}
    else if(r.success===false) showToast(r.error||'Chyba','error');
  });
}

function setText(id,t){const e=document.getElementById(id);if(e)e.textContent=t;}
function setVal(id,v){const e=document.getElementById(id);if(e)e.value=v;}
function getVal(id){const e=document.getElementById(id);return e?e.value:'';}
function setRadio(id,c){const e=document.getElementById(id);if(e)e.checked=c;}
function setChk(id,c){const e=document.getElementById(id);if(e)e.checked=c;}
function isChk(id){const e=document.getElementById(id);return e?e.checked:false;}
function onClick(id,fn){const e=document.getElementById(id);if(e)e.addEventListener('click',fn);}
function onChange(id,fn){const e=document.getElementById(id);if(e)e.addEventListener('change',fn);}
function onInput(id,fn){const e=document.getElementById(id);if(e)e.addEventListener('input',fn);}
function showModal(s){const m=document.getElementById('ruleModal');if(m){if(s)m.classList.add('show');else{m.classList.remove('show');clearForm();editingRuleIndex=-1;}}}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function showToast(msg,type){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.className='toast show '+(type||'info');setTimeout(()=>t.classList.remove('show'),3000);}

chrome.runtime.onMessage.addListener(req=>{if(req.action==='statusUpdate'){chrome.runtime.sendMessage({action:'getStats'},s=>{if(chrome.runtime.lastError||!s)return;setText('overviewProcessed',s.processed||0);setText('overviewRules',s.rulesMatched||0);setText('overviewAI',s.aiMatched||0);});}});
