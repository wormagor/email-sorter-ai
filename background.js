import RulesEngine from './rules-engine.js';
import AIEngine from './ai-engine.js';
import GmailAPI from './gmail-api.js';

const UPDATE_CONFIG = {
  versionUrl: 'https://raw.githubusercontent.com/wormagor/email-sorter-ai/main/version.json',
  releasesUrl: 'https://github.com/wormagor/email-sorter-ai/releases',
  checkIntervalHours: 12
};

const DEFAULT_RULES = [
  {id:'fio-banka',name:'FIO BANKA',type:'banka',active:true,senders:['info@fio.cz','noreply@fio.cz'],label:'PLATBY/FIO',confidence:1.0,actions:['addLabel','markImportant']},
  {id:'revolut',name:'REVOLUT',type:'banka',active:true,senders:['noreply@revolut.com'],bodyKeys:['revolut'],label:'PLATBY/REVOLUT',confidence:1.0,actions:['addLabel']},
  {id:'baseboys',name:'BASEBOYS',type:'objednavka',active:true,senders:['info@baseboys.cz'],bodyKeys:['06612164'],label:'NAKUPY/BASEBOYS',confidence:1.0,actions:['addLabel']},
  {id:'dikycau',name:'DIKYCAU',type:'objednavka',active:true,senders:['objednavky@dikycau.cz'],bodyKeys:['05765579'],label:'NAKUPY/DIKYCAU',confidence:1.0,actions:['addLabel']},
  {id:'majak-zdiby',name:'MAJAK ZDIBY',type:'zprava',active:true,subjectKeys:['MAJAK','ZDIBY'],bodyKeys:['rezervace','pokoj'],label:'DALSI/MAJAK',confidence:0.95,actions:['addLabel']},
  {id:'stillking',name:'STILLKING FEATURES',type:'zprava',active:true,senders:['info@stillking.cz'],subjectKeys:['feature','update'],label:'TECH/STILLKING',confidence:0.9,actions:['addLabel']}
];

const DEFAULT_SETTINGS = {
  autoScanEnabled:true,rulesEngineEnabled:true,aiClassificationEnabled:true,parseAttachments:false,
  scanIntervalMinutes:10,rules:DEFAULT_RULES,parentLabel:'EMAIL_SORTER',confidenceThreshold:0.75,
  maxEmailsPerScan:50,openaiKey:'',openaiModel:'gpt-4o-mini',claudeKey:'',claudeModel:'claude-sonnet-4-20250514',
  aiProvider:'openai',whitelist:'',blacklist:''
};

let currentStatus = {lastRun:null,processed:0,labeled:0,rulesMatched:0,aiMatched:0,skipped:false,error:null};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const {settings=DEFAULT_SETTINGS} = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({settings});
    await chrome.storage.local.set({status:currentStatus});
  }
  await chrome.alarms.create('emailScan',{periodInMinutes:10});
  await chrome.alarms.create('updateCheck',{periodInMinutes:UPDATE_CONFIG.checkIntervalHours*60});
  checkForUpdates();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'emailScan') {
    const {settings=DEFAULT_SETTINGS} = await chrome.storage.sync.get('settings');
    if (settings.autoScanEnabled) await processNewEmails(false, settings);
  }
  if (alarm.name === 'updateCheck') checkForUpdates();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processEmails') {
    processNewEmails(true, message.settings).then(r=>sendResponse({success:true,data:r})).catch(e=>sendResponse({success:false,error:e.message}));
    return true;
  }
  if (message.action === 'getSettings') {
    chrome.storage.sync.get('settings', r => sendResponse(r.settings || DEFAULT_SETTINGS));
    return true;
  }
  if (message.action === 'saveSettings') {
    chrome.storage.sync.set({settings:message.settings}, () => { sendResponse({success:true}); broadcastStatus('settingsUpdated'); });
    return true;
  }
  if (message.action === 'getStats') {
    chrome.storage.local.get('status', r => sendResponse(r.status || currentStatus));
    return true;
  }
  if (message.action === 'getStatus') {
    getLastStatus().then(s => sendResponse(s));
    return true;
  }
  if (message.action === 'testAPI') {
    testAPIKey(message.provider, message.apiKey, message.model).then(r=>sendResponse(r)).catch(e=>sendResponse({success:false,error:e.message}));
    return true;
  }
  if (message.action === 'checkForUpdates') {
    checkForUpdates().then(r=>sendResponse(r)).catch(e=>sendResponse({success:false,error:e.message}));
    return true;
  }
  if (message.action === 'getUpdateInfo') {
    chrome.storage.local.get('updateInfo', r => sendResponse(r.updateInfo || null));
    return true;
  }
  if (message.action === 'downloadUpdate') {
    downloadUpdate(message.url, message.version).then(r=>sendResponse(r)).catch(e=>sendResponse({success:false,error:e.message}));
    return true;
  }
  // FIX v3.6.0: Forward closeSidebar to Gmail tabs (fallback for iframe postMessage)
  if (message.action === 'closeSidebar') {
    chrome.tabs.query({url:'*://mail.google.com/*'}, tabs => {
      tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, {action:'closeSidebar'}).catch(()=>{}));
    });
    return false;
  }
  if (message.action === 'getAuthToken') {
    getValidToken(message.interactive||false).then(t=>sendResponse({success:true,token:t})).catch(e=>sendResponse({success:false,error:e.message}));
    return true;
  }
});

async function testAPIKey(provider, apiKey, model) {
  if (!apiKey || !apiKey.trim()) return {success:false,error:'API klic neni zadan'};
  try {
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
        body:JSON.stringify({model:model||'gpt-4o-mini',messages:[{role:'user',content:'Odpovez jednim slovem: funguje'}],max_tokens:10})
      });
      if (r.ok) { const d=await r.json(); return {success:true,message:'OpenAI OK! Model: '+(model||'gpt-4o-mini')+', odpoved: "'+((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content)||'').trim()+'"'}; }
      if (r.status===401) return {success:false,error:'Neplatny API klic'};
      if (r.status===429) return {success:false,error:'Rate limit'};
      return {success:false,error:'HTTP '+r.status};
    } else if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:model||'claude-sonnet-4-20250514',max_tokens:10,messages:[{role:'user',content:'Odpovez jednim slovem: funguje'}]})
      });
      if (r.ok) { const d=await r.json(); return {success:true,message:'Claude OK! Model: '+(model||'claude-sonnet-4-20250514')+', odpoved: "'+((d.content && d.content[0] && d.content[0].text)||'').trim()+'"'}; }
      if (r.status===401) return {success:false,error:'Neplatny API klic'};
      if (r.status===429) return {success:false,error:'Rate limit'};
      return {success:false,error:'HTTP '+r.status};
    }
    return {success:false,error:'Neznamy provider'};
  } catch(e) { return {success:false,error:'Sitova chyba: '+e.message}; }
}

async function checkForUpdates() {
  try {
    const r = await fetch(UPDATE_CONFIG.versionUrl+'?t='+Date.now(),{cache:'no-store'});
    if (!r.ok) return {success:false,error:'Nelze zkontrolovat'};
    const remote = await r.json();
    const cv = chrome.runtime.getManifest().version;
    const rv = remote.version;
    const hasUpdate = cmpVer(rv,cv)>0;
    const info = {currentVersion:cv,remoteVersion:rv,hasUpdate,changelog:remote.changelog||'',downloadUrl:remote.downloadUrl||UPDATE_CONFIG.releasesUrl,checkedAt:new Date().toISOString()};
    await chrome.storage.local.set({updateInfo:info});
    chrome.action.setBadgeText({text:hasUpdate?'!':''});
    if (hasUpdate) {
      chrome.action.setBadgeBackgroundColor({color:'#ea4335'});
      try { await downloadUpdate(info.downloadUrl, rv); } catch(e) {}
    }
    return {success:true,...info};
  } catch(e) { return {success:false,error:e.message}; }
}

async function downloadUpdate(url, version) {
  if (!url) return {success:false,error:'URL neni k dispozici'};
  try {
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: 'email-sorter-ai-v'+version+'.zip',
      conflictAction: 'uniquify',
      saveAs: false
    });
    await chrome.storage.local.set({lastDownloadedVersion:version,downloadId});
    chrome.notifications.create('update-downloaded',{
      type:'basic',
      iconUrl:'icons/icon128.png',
      title:'Email Sorter AI - Aktualizace stazena!',
      message:'Verze '+version+' byla stazena. Rozbalte ZIP a nahradte soubory rozsireni, pak kliknete "Znovu nacist" na chrome://extensions',
      priority:2,
      requireInteraction:true
    });
    return {success:true,message:'Aktualizace stazena'};
  } catch(e) { return {success:false,error:e.message}; }
}

function cmpVer(a,b) { const pa=a.split('.').map(Number),pb=b.split('.').map(Number); for(let i=0;i<Math.max(pa.length,pb.length);i++){const na=pa[i]||0,nb=pb[i]||0;if(na>nb)return 1;if(na<nb)return -1;} return 0; }

async function getValidToken(interactive) {
  try {
    const result = await chrome.identity.getAuthToken({interactive});
    const token = (typeof result === 'string') ? result : result?.token;
    if (!token) { if(interactive) throw new Error('Token nebyl ziskan'); return null; }
    const r = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile',{headers:{'Authorization':'Bearer '+token}});
    if (!r.ok) { if(r.status===401){await chrome.identity.removeCachedAuthToken({token:token});const r2=await chrome.identity.getAuthToken({interactive});return (typeof r2==='string')?r2:r2?.token||null;} throw new Error('API chyba: '+r.status); }
    return token;
  } catch(e) { if(!interactive) return null; throw e; }
}

async function processNewEmails(interactive, settings) {
  const status = {lastRun:new Date().toISOString(),processed:0,labeled:0,rulesMatched:0,aiMatched:0,skipped:false,error:null};
  try {
    const token = await getValidToken(interactive);
    if (!token) { status.skipped=true; await chrome.storage.local.set({status}); broadcastStatus('scanComplete',status); return status; }
    if (!settings) { const r=await chrome.storage.sync.get('settings'); settings=r.settings||DEFAULT_SETTINGS; }
    const gmail=new GmailAPI(token), rulesEngine=new RulesEngine(settings.rules), aiEngine=new AIEngine(settings);
    const msgs = await gmail.listMessages('is:inbox newer_than:1d -label:EMAIL_SORTER_PROCESSED', settings.maxEmailsPerScan);
    if (!msgs||!msgs.length) { await chrome.storage.local.set({status}); broadcastStatus('scanComplete',status); return status; }
    for (const m of msgs) {
      try {
        const parsed = gmail.parseEmailData(await gmail.getMessage(m.id));
        let label=null;
        if (settings.rulesEngineEnabled) { const rm=rulesEngine.classify(parsed); if(rm){label=rm.label;status.rulesMatched++;} }
        if (!label && settings.aiClassificationEnabled) {
          let att='';
          if (settings.parseAttachments&&parsed.attachments&&parsed.attachments.length>0) for(const a of parsed.attachments){try{att+='\n['+a.filename+']\n'+await gmail.getAttachment(m.id,a.attachmentId)+'\n';}catch(e){}}
          try{const ar=await aiEngine.classify(parsed,att,settings.rules);if(ar&&ar.confidence>=settings.confidenceThreshold){label=ar.label;status.aiMatched++;}}catch(e){}
        }
        if(label){try{await gmail.ensureLabel(label);await gmail.addLabel(m.id,label);status.labeled++;}catch(e){}}
        try{await gmail.ensureLabel('EMAIL_SORTER_PROCESSED');await gmail.addLabel(m.id,'EMAIL_SORTER_PROCESSED');}catch(e){}
        status.processed++;
      } catch(e){continue;}
    }
    await chrome.storage.local.set({status}); broadcastStatus('scanComplete',status); return status;
  } catch(e) { status.error=e.message; await chrome.storage.local.set({status}); broadcastStatus('scanError',status); throw e; }
}

async function getLastStatus() { const r=await chrome.storage.local.get('status'); return r.status||currentStatus; }

function broadcastStatus(event, data) {
  chrome.tabs.query({url:'*://mail.google.com/*'}, tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id,{action:'statusUpdate',event,data:data||currentStatus}).catch(()=>{}));
  });
}

export default {};
