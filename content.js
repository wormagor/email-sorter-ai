// Email Sorter AI - Content Script v3.6.2
// FIX: Listen for postMessage from sidebar iframe for close button
(function() {
  'use strict';
  let panelOpen=false, recentOpen=false, sidebarVisible=false;
  let todayStats={processed:0,labeled:0}, currentStatus='idle';

  function waitForGmail() {
    const check = setInterval(() => {
      if (document.querySelector('[role="banner"]') || document.querySelector('.nH')) {
        clearInterval(check);
        setTimeout(() => { injectWidget(); loadInitialStatus(); startStatusPolling(); }, 1000);
      }
    }, 1000);
  }

  function injectWidget() {
    if (document.getElementById('email-sorter-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'email-sorter-toolbar';
    toolbar.innerHTML = '<button id="es-process-btn" title="Email Sorter AI">\ud83d\udce7 <span id="es-status-text">Pripraven</span></button>';
    document.body.appendChild(toolbar);

    const panel = document.createElement('div');
    panel.id = 'email-sorter-panel';
    panel.innerHTML = '<div id="es-panel-toggle" class="es-panel-header"><span>\ud83d\udce7 Email Sorter AI</span><span id="es-version">v3.6.2</span><span id="es-arrow">\u25bc</span></div><div id="es-panel-body" class="es-panel-body"><div class="es-panel-status"><span class="es-dot es-idle" id="es-dot"></span><span id="es-panel-status-text">Pripraven</span></div><div id="es-panel-stats" class="es-panel-stats">Dnes: 0 zpracovano, 0 oznaceno</div><div id="es-panel-recent" class="es-panel-recent"><div id="es-recent-toggle" class="es-recent-header">Nove oznacene (0) <span id="es-recent-arrow">\u25b6</span></div><div id="es-recent-list" class="es-recent-list"></div></div><div class="es-panel-actions"><button id="es-btn-process" class="es-btn es-btn-primary">\u25b6 Zpracovat</button><button id="es-btn-settings" class="es-btn es-btn-secondary">\u2699 Nastaveni</button></div><div id="es-panel-result" class="es-panel-result"></div></div>';
    document.body.appendChild(panel);
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('es-panel-toggle').addEventListener('click', () => {
      panelOpen = !panelOpen;
      document.getElementById('es-panel-body').style.display = panelOpen ? 'block' : 'none';
      document.getElementById('es-arrow').textContent = panelOpen ? '\u25b2' : '\u25bc';
    });
    document.getElementById('es-recent-toggle').addEventListener('click', (e) => {
      e.stopPropagation(); recentOpen = !recentOpen;
      document.getElementById('es-recent-list').style.display = recentOpen ? 'block' : 'none';
      document.getElementById('es-recent-arrow').textContent = recentOpen ? '\u25bc' : '\u25b6';
    });
    document.getElementById('es-btn-process').addEventListener('click', (e) => { e.stopPropagation(); processNow(); });
    document.getElementById('es-process-btn').addEventListener('click', () => processNow());
    document.getElementById('es-btn-settings').addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); toggleSidebar(); });

    // Listen for chrome.runtime messages from background/popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'statusUpdate') handleStatusUpdate(msg.event, msg.data);
      if (msg.action === 'openSidebar' && !sidebarVisible) openSidebar();
      if (msg.action === 'closeSidebar') closeSidebar();
    });

    // FIX v3.6.1: Listen for postMessage from sidebar iframe (close button)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'emailSorterClose') {
        closeSidebar();
      }
    });
  }

  function toggleSidebar() { sidebarVisible ? closeSidebar() : openSidebar(); }

  function openSidebar() {
    const existing = document.getElementById('email-sorter-sidebar');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'email-sorter-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:10000;';
    overlay.addEventListener('click', closeSidebar);
    document.body.appendChild(overlay);

    const container = document.createElement('div');
    container.id = 'email-sorter-sidebar';
    container.style.cssText = 'position:fixed;top:0;right:0;width:420px;height:100vh;z-index:10001;box-shadow:-5px 0 30px rgba(0,0,0,0.15);background:white;overflow:hidden;';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    try { iframe.src = chrome.runtime.getURL('sidebar.html'); } catch(e) { return; }
    container.appendChild(iframe);
    document.body.appendChild(container);
    sidebarVisible = true;
    container.style.transform = 'translateX(100%)';
    container.style.transition = 'transform 0.3s ease';
    requestAnimationFrame(() => { container.style.transform = 'translateX(0)'; });
  }

  function closeSidebar() {
    const s = document.getElementById('email-sorter-sidebar');
    const o = document.getElementById('email-sorter-overlay');
    if (s) { s.style.transform = 'translateX(100%)'; setTimeout(() => s.remove(), 300); }
    if (o) o.remove();
    sidebarVisible = false;
  }

  async function processNow() {
    setStatus('running', 'Zpracovavam...');
    const btn = document.getElementById('es-btn-process');
    if (btn) btn.disabled = true;
    try {
      const settings = await msg('getSettings');
      const result = await msg('processEmails', {settings});
      if (btn) btn.disabled = false;
      if (result && result.success === false) {
        setStatus('error', result.error || 'Chyba');
        showResult({error: result.error});
        setTimeout(() => { if (currentStatus==='error') setStatus('idle','Pripraven'); }, 30000);
      } else if (result && result.success && result.data) {
        todayStats.processed += result.data.processed||0;
        todayStats.labeled += result.data.labeled||0;
        updateStats(); showResult(result.data); setStatus('idle','Pripraven');
      } else setStatus('idle','Pripraven');
    } catch(e) {
      if (btn) btn.disabled = false;
      setStatus('error','Chyba komunikace');
      setTimeout(() => { if(currentStatus==='error') setStatus('idle','Pripraven'); }, 30000);
    }
  }

  function handleStatusUpdate(event, data) {
    if (!data) return;
    if (event==='scanError'||data.error) {
      if (data.error&&data.error.includes('Token')) return;
      setStatus('error', data.error||'Chyba');
      setTimeout(() => { if(currentStatus==='error') setStatus('idle','Pripraven'); }, 60000);
    } else if (event==='scanComplete') {
      if (!data.skipped) { todayStats.processed+=data.processed||0; todayStats.labeled+=data.labeled||0; updateStats(); }
      setStatus('idle','Pripraven');
    } else setStatus('idle','Pripraven');
  }

  function setStatus(state, text) {
    currentStatus = state;
    const dot=document.getElementById('es-dot'), pt=document.getElementById('es-panel-status-text'), tt=document.getElementById('es-status-text');
    if(dot) dot.className='es-dot es-'+state;
    if(pt) pt.textContent=text;
    if(tt) tt.textContent=text;
  }
  function updateStats() {
    const s=document.getElementById('es-panel-stats');
    if(s) s.textContent='Dnes: '+todayStats.processed+' zpracovano, '+todayStats.labeled+' oznaceno';
  }
  function showResult(r) {
    const el=document.getElementById('es-panel-result');
    if(!el) return;
    if(r.error){el.textContent='Chyba: '+r.error;el.style.color='#ea4335';}
    else if(r.processed===0){el.textContent='Zadne nove emaily.';el.style.color='#5f6368';}
    else{el.textContent='Zpracovano '+r.processed+', oznaceno '+(r.labeled||0);el.style.color='#34a853';}
    setTimeout(()=>{el.textContent='';el.style.color='';},10000);
  }

  async function loadInitialStatus() {
    try {
      const status = await msg('getStatus');
      if(status&&status.lastRun&&new Date(status.lastRun).toDateString()===new Date().toDateString()){
        todayStats.processed=status.processed||0; todayStats.labeled=status.labeled||0;
      }
      updateStats();
      if(status&&status.error){
        const age=Date.now()-(status.lastRun?new Date(status.lastRun).getTime():0);
        if(age<120000){setStatus('error',status.error);setTimeout(()=>{if(currentStatus==='error')setStatus('idle','Pripraven');},Math.max(0,120000-age));}
        else setStatus('idle','Pripraven');
      } else setStatus('idle','Pripraven');
    } catch(e) { setStatus('idle','Pripraven'); }
  }

  function startStatusPolling() {
    setInterval(async()=>{try{const s=await msg('getStatus');if(s&&!s.error&&currentStatus==='error')setStatus('idle','Pripraven');}catch(e){}},300000);
  }

  function msg(action, extra) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({action,...extra}, r => {
        if(chrome.runtime.lastError) resolve(null); else resolve(r);
      });
    });
  }

  waitForGmail();
})();
