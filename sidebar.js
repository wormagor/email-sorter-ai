// Email Sorter AI - Sidebar Settings v3.6.2
// FIX: closeSidebar uses window.parent.postMessage for iframe communication

const DEFAULT_SETTINGS = {
  autoScanEnabled: true, rulesEngineEnabled: true,
  aiClassificationEnabled: true, parseAttachments: false,
  aiProvider: 'openai', openaiKey: '', claudeKey: '',
  openaiModel: 'gpt-4o-mini', claudeModel: 'claude-sonnet-4-20250514',
  rules: [], parentLabel: 'EMAIL_SORTER',
  confidenceThreshold: 0.75, maxEmailsPerScan: 50,
  scanIntervalMinutes: 10, whitelist: '', blacklist: ''
};

let currentSettings = {};
let editingRuleIndex = -1;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) { showToast('Chyba pri nacitani nastaveni', 'error'); return; }
    currentSettings = response || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    updateUI();
  });

  chrome.runtime.sendMessage({ action: 'getStats' }, (status) => {
    if (chrome.runtime.lastError || !status) return;
    setText('overviewProcessed', status.processed || 0);
    setText('overviewRules', status.rulesMatched || 0);
    setText('overviewAI', status.aiMatched || 0);
  });
}

function updateUI() {
  const s = currentSettings;
  setRadio('providerOpenAI', s.aiProvider === 'openai');
  setRadio('providerClaude', s.aiProvider === 'claude');
  setVal('openaiKey', s.openaiKey || '');
  setVal('claudeKey', s.claudeKey || '');
  setVal('openaiModel', s.openaiModel || 'gpt-4o-mini');
  setVal('claudeModel', s.claudeModel || 'claude-sonnet-4-20250514');
  setVal('parentLabel', s.parentLabel || 'EMAIL_SORTER');
  setVal('confidenceThreshold', s.confidenceThreshold || 0.75);
  updateThresholdDisplay();
  setVal('maxEmails', s.maxEmailsPerScan || 50);
  setVal('scanInterval', s.scanIntervalMinutes || 10);
  setVal('whitelist', s.whitelist || '');
  setVal('blacklist', s.blacklist || '');
  renderRulesList();
}

function updateThresholdDisplay() {
  const el = document.getElementById('confidenceThreshold');
  const display = document.getElementById('thresholdValue');
  if (el && display) display.textContent = parseFloat(el.value).toFixed(2);
}

function renderRulesList() {
  const rules = currentSettings.rules || [];
  const container = document.getElementById('rulesList');
  if (!container) return;

  if (rules.length === 0) {
    container.innerHTML = '<div class="empty-state">Zadna pravidla</div>';
    return;
  }

  container.innerHTML = rules.map((rule, i) => `
    <div class="rule-item">
      <div class="rule-item-info">
        <h4>${esc(rule.name || 'Bez nazvu')}</h4>
        <p>${esc(rule.type || 'ostatni')} \u2022 ${esc(rule.label || '')} ${rule.active ? '\u2705' : '\u274C'}</p>
      </div>
      <div class="rule-item-actions">
        <button class="rule-edit-btn" data-i="${i}">Upravit</button>
        <button class="rule-delete-btn" data-i="${i}">Smazat</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.rule-edit-btn').forEach(b => b.addEventListener('click', e => editRule(+e.target.dataset.i)));
  container.querySelectorAll('.rule-delete-btn').forEach(b => b.addEventListener('click', e => deleteRule(+e.target.dataset.i)));
}

function setupEventListeners() {
  // FIX v3.6.1: Close button uses postMessage to communicate with parent Gmail page
  onClick('closeBtn', closeSidebar);
  onClick('addRuleBtn', () => { editingRuleIndex = -1; setText('modalTitle', 'Nove pravidlo'); clearRuleForm(); showModal(true); });
  onClick('modalClose', () => showModal(false));
  onClick('modalCancel', () => showModal(false));
  onClick('modalSave', saveRule);
  onClick('saveBtn', saveAllSettings);
  onClick('processBtn', processEmails);

  // v3.6.0: API test buttons
  onClick('testOpenAIBtn', () => testAPI('openai'));
  onClick('testClaudeBtn', () => testAPI('claude'));

  // v3.6.1: Clear OAuth token button
  onClick('clearTokenBtn', () => {
    const btn = document.getElementById('clearTokenBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Mazani...'; }
    chrome.runtime.sendMessage({action: 'clearAuthTokens'}, r => {
      if (btn) { btn.disabled = false; btn.textContent = 'Vymazat OAuth token'; }
      if (r && r.success) showToast('OAuth tokeny vymazany. Zkuste znovu Zpracovat.', 'success');
      else showToast(r?.error || 'Chyba mazani tokenu', 'error');
    });
  });

  onChange('providerOpenAI', () => { currentSettings.aiProvider = 'openai'; });
  onChange('providerClaude', () => { currentSettings.aiProvider = 'claude'; });
  onChange('openaiKey', e => { currentSettings.openaiKey = e.target.value; });
  onChange('claudeKey', e => { currentSettings.claudeKey = e.target.value; });
  onChange('openaiModel', e => { currentSettings.openaiModel = e.target.value; });
  onChange('claudeModel', e => { currentSettings.claudeModel = e.target.value; });
  onChange('parentLabel', e => { currentSettings.parentLabel = e.target.value; });
  onInput('confidenceThreshold', e => { currentSettings.confidenceThreshold = parseFloat(e.target.value); updateThresholdDisplay(); });
  onChange('maxEmails', e => { currentSettings.maxEmailsPerScan = parseInt(e.target.value) || 50; });
  onChange('scanInterval', e => { currentSettings.scanIntervalMinutes = parseInt(e.target.value) || 10; });
  onChange('whitelist', e => { currentSettings.whitelist = e.target.value; });
  onChange('blacklist', e => { currentSettings.blacklist = e.target.value; });

  const fwd = document.getElementById('ruleForwardEmail');
  if (fwd) fwd.addEventListener('change', e => { const g = document.getElementById('forwardGroup'); if (g) g.style.display = e.target.checked ? 'block' : 'none'; });
  const cal = document.getElementById('ruleCalendar');
  if (cal) cal.addEventListener('change', e => { const g = document.getElementById('calendarGroup'); if (g) g.style.display = e.target.checked ? 'block' : 'none'; });
}

// FIX v3.6.1: Use postMessage to tell parent (Gmail content.js) to close sidebar
function closeSidebar() {
  // Method 1: postMessage to parent frame (primary - works for iframe)
  try { window.parent.postMessage({ action: 'emailSorterClose' }, '*'); } catch (e) {}
  // Method 2: chrome.runtime fallback (background forwards to Gmail tabs)
  try { chrome.runtime.sendMessage({ action: 'closeSidebar' }); } catch (e) {}
}

// ====== v3.6.0: Test API ======
function testAPI(provider) {
  const btnId = provider === 'openai' ? 'testOpenAIBtn' : 'testClaudeBtn';
  const resultId = provider === 'openai' ? 'openaiTestResult' : 'claudeTestResult';
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById(resultId);

  const apiKey = provider === 'openai' ? currentSettings.openaiKey : currentSettings.claudeKey;
  const model = provider === 'openai' ? currentSettings.openaiModel : currentSettings.claudeModel;

  // Read latest value from inputs
  const keyEl = document.getElementById(provider === 'openai' ? 'openaiKey' : 'claudeKey');
  const modelEl = document.getElementById(provider === 'openai' ? 'openaiModel' : 'claudeModel');
  const key = keyEl ? keyEl.value : apiKey;
  const mod = modelEl ? modelEl.value : model;

  if (!key || key.trim().length === 0) {
    if (resultEl) { resultEl.textContent = 'Zadejte API klic'; resultEl.className = 'api-test-result error'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Testuji...'; }
  if (resultEl) { resultEl.textContent = ''; resultEl.className = 'api-test-result'; }

  chrome.runtime.sendMessage({ action: 'testAPI', provider, apiKey: key, model: mod }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Otestovat'; }

    if (chrome.runtime.lastError) {
      if (resultEl) { resultEl.textContent = chrome.runtime.lastError.message; resultEl.className = 'api-test-result error'; }
      return;
    }

    if (response && response.success) {
      if (resultEl) { resultEl.textContent = response.message; resultEl.className = 'api-test-result success'; }
      showToast('API funguje!', 'success');
    } else {
      if (resultEl) { resultEl.textContent = response ? response.error : 'Chyba'; resultEl.className = 'api-test-result error'; }
      showToast('API test selhal', 'error');
    }
  });
}

function editRule(index) {
  if (index < 0 || index >= (currentSettings.rules || []).length) return;
  editingRuleIndex = index;
  const rule = currentSettings.rules[index];
  setText('modalTitle', 'Upravit pravidlo');
  setVal('ruleName', rule.name || '');
  setVal('ruleType', rule.type || 'ostatni');
  setVal('ruleLabel', rule.label || '');
  setVal('ruleSenders', (rule.senders || []).join(', '));
  setVal('ruleSubjectKeys', (rule.subjectKeys || []).join('\n'));
  setVal('ruleBodyKeys', (rule.bodyKeys || []).join('\n'));

  const actions = rule.actions || [];
  setChecked('ruleStar', actions.includes('star'));
  setChecked('rulePriority', actions.includes('markImportant'));
  setChecked('ruleForwardEmail', actions.includes('forward'));
  setChecked('ruleCalendar', actions.includes('calendar'));
  setVal('ruleForwardTo', rule.forwardTo || '');
  setVal('ruleCalendarTitle', rule.calendarTitle || '');
  setVal('ruleCalendarDays', rule.calendarDays || 0);

  const fg = document.getElementById('forwardGroup');
  const cg = document.getElementById('calendarGroup');
  if (fg) fg.style.display = actions.includes('forward') ? 'block' : 'none';
  if (cg) cg.style.display = actions.includes('calendar') ? 'block' : 'none';

  showModal(true);
}

function clearRuleForm() {
  ['ruleName','ruleLabel','ruleSenders','ruleSubjectKeys','ruleBodyKeys','ruleForwardTo','ruleCalendarTitle'].forEach(id => setVal(id, ''));
  setVal('ruleType', 'ostatni');
  setVal('ruleCalendarDays', 0);
  ['ruleForwardEmail','ruleStar','rulePriority','ruleCalendar'].forEach(id => setChecked(id, false));
  const fg = document.getElementById('forwardGroup');
  const cg = document.getElementById('calendarGroup');
  if (fg) fg.style.display = 'none';
  if (cg) cg.style.display = 'none';
}

function saveRule() {
  const name = getVal('ruleName').trim();
  const label = getVal('ruleLabel').trim();
  if (!name || !label) { showToast('Nazev a stitek jsou povinne', 'error'); return; }

  const actions = ['addLabel'];
  if (isChecked('ruleForwardEmail')) actions.push('forward');
  if (isChecked('ruleStar')) actions.push('star');
  if (isChecked('rulePriority')) actions.push('markImportant');
  if (isChecked('ruleCalendar')) actions.push('calendar');

  const rule = {
    id: editingRuleIndex >= 0 ? (currentSettings.rules[editingRuleIndex].id || name.toLowerCase().replace(/\s+/g,'-')) : name.toLowerCase().replace(/\s+/g,'-'),
    name, type: getVal('ruleType') || 'ostatni', active: true, label, confidence: 1.0, actions,
    senders: getVal('ruleSenders').split(',').map(s=>s.trim()).filter(s=>s),
    subjectKeys: getVal('ruleSubjectKeys').split('\n').map(s=>s.trim()).filter(s=>s),
    bodyKeys: getVal('ruleBodyKeys').split('\n').map(s=>s.trim()).filter(s=>s)
  };

  const ft = getVal('ruleForwardTo').trim();
  if (ft) rule.forwardTo = ft;
  const ct = getVal('ruleCalendarTitle').trim();
  if (ct) rule.calendarTitle = ct;
  rule.calendarDays = parseInt(getVal('ruleCalendarDays')) || 0;

  if (editingRuleIndex >= 0) {
    currentSettings.rules[editingRuleIndex] = rule;
    showToast('Pravidlo aktualizovano', 'success');
  } else {
    if (!currentSettings.rules) currentSettings.rules = [];
    currentSettings.rules.push(rule);
    showToast('Pravidlo pridano', 'success');
  }

  renderRulesList();
  showModal(false);
}

function deleteRule(index) {
  if (confirm('Smazat pravidlo?')) {
    currentSettings.rules.splice(index, 1);
    showToast('Pravidlo smazano', 'success');
    renderRulesList();
  }
}

function saveAllSettings() {
  const btn = document.getElementById('saveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ukladam...'; }

  chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Ulozit nastaveni'; }
    if (chrome.runtime.lastError) { showToast('Chyba ukladani', 'error'); return; }
    showToast('Nastaveni ulozeno', 'success');
  });
}

function processEmails() {
  const btn = document.getElementById('processBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Zpracovavam...'; }

  chrome.runtime.sendMessage({ action: 'processEmails', settings: currentSettings }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Zpracovat nyni'; }
    if (chrome.runtime.lastError) { showToast('Chyba zpracovani', 'error'); return; }
    if (!response) { showToast('Zadna odpoved', 'error'); return; }

    if (response.success && response.data) {
      showToast(`Zpracovano ${response.data.processed}, oznaceno ${response.data.labeled}`, 'success');
      setText('overviewProcessed', response.data.processed || 0);
      setText('overviewRules', response.data.rulesMatched || 0);
      setText('overviewAI', response.data.aiMatched || 0);
    } else if (response.success === false) {
      showToast(response.error || 'Chyba', 'error');
    }
  });
}

// ====== DOM Helpers ======
function setText(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function getVal(id) { const e = document.getElementById(id); return e ? e.value : ''; }
function setRadio(id, c) { const e = document.getElementById(id); if (e) e.checked = c; }
function setChecked(id, c) { const e = document.getElementById(id); if (e) e.checked = c; }
function isChecked(id) { const e = document.getElementById(id); return e ? e.checked : false; }
function onClick(id, fn) { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); }
function onChange(id, fn) { const e = document.getElementById(id); if (e) e.addEventListener('change', fn); }
function onInput(id, fn) { const e = document.getElementById(id); if (e) e.addEventListener('input', fn); }
function showModal(show) { const m = document.getElementById('ruleModal'); if (m) { if (show) m.classList.add('show'); else { m.classList.remove('show'); clearRuleForm(); editingRuleIndex = -1; } } }
function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type || 'info'}`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'statusUpdate') {
    chrome.runtime.sendMessage({ action: 'getStats' }, (s) => {
      if (chrome.runtime.lastError || !s) return;
      setText('overviewProcessed', s.processed || 0);
      setText('overviewRules', s.rulesMatched || 0);
      setText('overviewAI', s.aiMatched || 0);
    });
  }
});
