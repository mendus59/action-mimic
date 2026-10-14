import { h, $, send } from '../shared/dom.js';
import { getScripts } from '../shared/storage.js';
import { SCOPE_TYPES, matchesScope, defaultScopeValue, describeScope, isRecordableUrl } from '../shared/scope.js';
import { describeStep } from '../shared/steps.js';

let tab = null;
let state = null;
let pendingFormFor = null; // stoppedAt of the pending recording the form was initialised for

function showError(msg) {
  const el = $('#error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

async function call(msg) {
  try {
    showError('');
    return await send(msg);
  } catch (e) {
    showError(e.message);
    return null;
  }
}

function showView(name) {
  for (const v of ['idle', 'recording', 'pending', 'playing']) {
    $(`#view-${v}`).hidden = v !== name;
  }
}

function fillSteps(listEl, steps) {
  listEl.replaceChildren(...steps.map(s => h('li', { title: describeStep(s) }, describeStep(s))));
  listEl.scrollTop = listEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function render() {
  state = await send({ type: 'am:getState' });
  renderResult();

  if (state.playback) {
    showView('playing');
    $('#play-name').textContent = state.playback.name;
    $('#play-index').textContent = state.playback.index;
    $('#play-total').textContent = state.playback.total;
    const p = $('#play-progress');
    p.max = state.playback.total;
    p.value = state.playback.index;
  } else if (state.recording) {
    showView('recording');
    $('#rec-count').textContent = state.recording.stepCount;
    fillSteps($('#rec-steps'), state.recording.steps);
  } else if (state.pending) {
    showView('pending');
    renderPending();
  } else {
    showView('idle');
    await renderIdle();
  }
}

function renderResult() {
  const r = state.lastResult;
  const box = $('#result');
  if (!r || state.playback) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = 'banner ' + (r.status === 'done' ? 'ok' : 'bad');
  const body = box.querySelector('.banner-body');
  const headline =
    r.status === 'done' ? `✓ "${r.name}" completed (${r.total} steps)`
    : r.status === 'stopped' ? `■ "${r.name}" stopped at step ${r.completed} of ${r.total}`
    : r.status === 'partial' ? `⚠ "${r.name}" finished with ${r.errors.length} failed step(s)`
    : `✗ "${r.name}" failed`;
  const details = [r.error, ...(r.errors || [])].filter(Boolean);
  body.replaceChildren(
    h('div', {}, headline),
    details.length ? h('ul', { class: 'small' }, details.map(d => h('li', {}, d))) : null
  );
}

async function renderIdle() {
  const recordable = tab && isRecordableUrl(tab.url);
  $('#record').disabled = !recordable;
  $('#not-recordable').hidden = recordable;

  const all = await getScripts();
  const showAll = $('#show-all').checked;
  const matching = all.filter(s => tab && matchesScope(s.scope, tab.url));
  let list = showAll ? all : matching;
  $('#list-title').textContent = showAll ? 'All scripts' : 'Scripts for this site';

  const filterEl = $('#filter');
  filterEl.hidden = list.length < 6;
  const q = filterEl.value.trim().toLowerCase();
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q));

  list.sort((a, b) => a.name.localeCompare(b.name));
  $('#script-list').replaceChildren(
    ...list.map(s => {
      const inScope = matching.includes(s);
      return h(
        'li',
        { title: s.description || '' },
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'name' }, s.name),
          h('div', { class: 'meta' }, `${s.steps.length} step${s.steps.length === 1 ? '' : 's'} ·${describeScope(s.scope)}`)
        ),
        h(
          'button',
          {
            class: 'btn primary sm play',
            disabled: !recordable,
            title: inScope ? 'Run on this tab' : 'Not scoped to this site — run anyway',
            onclick: () => play(s)
          },
          inScope ? '▶ Run' : '▶ Run*'
        )
      );
    })
  );

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = q
    ? 'No scripts match the filter.'
    : showAll
      ? 'No scripts saved yet. Hit Record to create one.'
      : all.length
        ? 'No scripts are scoped to this site. Tick "Show all" to see the others.'
        : 'No scripts saved yet. Hit Record to create one.';
}

function renderPending() {
  const p = state.pending;
  $('#pending-count').textContent = p.steps.length;
  fillSteps($('#pending-steps'), p.steps);
  if (pendingFormFor === p.stoppedAt) return; // keep whatever the user typed
  pendingFormFor = p.stoppedAt;

  let host = '';
  try {
    host = new URL(p.startUrl).host;
  } catch {}
  $('#save-name').value = `${host || 'Script'} – ${new Date(p.stoppedAt).toLocaleString()}`;
  $('#save-desc').value = '';
  $('#save-scope-type').value = 'host';
  onScopeTypeChange();
  $('#save-name').select();
}

function onScopeTypeChange() {
  const type = $('#save-scope-type').value;
  const meta = SCOPE_TYPES.find(t => t.value === type);
  $('#scope-value-field').hidden = type === 'global';
  $('#save-scope-value').value = defaultScopeValue(type, state.pending.startUrl);
  $('#scope-hint').textContent = meta?.hint || '';
  updateScopeMatch();
}

function updateScopeMatch() {
  const scope = { type: $('#save-scope-type').value, value: $('#save-scope-value').value };
  const ok = matchesScope(scope, state.pending.startUrl);
  const el = $('#scope-match');
  el.className = 'small ' + (ok ? 'ok' : 'no');
  el.textContent = ok
    ? '✓ Matches the page this was recorded on'
    : '⚠ Does not match the page this was recorded on';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function play(script) {
  const res = await call({ type: 'am:play', tabId: tab.id, scriptId: script.id });
  if (res) window.close(); // get out of the way so the user can watch the page
}

$('#record').addEventListener('click', async () => {
  const res = await call({ type: 'am:startRecording', tabId: tab.id });
  if (res) window.close();
});
$('#stop').addEventListener('click', () => call({ type: 'am:stopRecording' }));
$('#cancel').addEventListener('click', () => call({ type: 'am:cancelRecording' }));
$('#stop-play').addEventListener('click', () => call({ type: 'am:stopPlayback' }));
$('#discard').addEventListener('click', () => {
  if (confirm('Discard this recording?')) call({ type: 'am:discardPending' });
});
$('#save').addEventListener('click', async () => {
  const name = $('#save-name').value.trim();
  if (!name) {
    $('#save-name').focus();
    return showError('Give the script a name.');
  }
  const scope = { type: $('#save-scope-type').value, value: $('#save-scope-value').value.trim() };
  if (scope.type !== 'global' && !scope.value) return showError('Enter a value for the scope.');
  if (scope.type === 'regex') {
    try {
      new RegExp(scope.value);
    } catch {
      return showError('The scope regex is invalid.');
    }
  }
  await call({ type: 'am:savePending', name, description: $('#save-desc').value.trim(), scope });
});
$('#save-scope-type').addEventListener('change', onScopeTypeChange);
$('#save-scope-value').addEventListener('input', updateScopeMatch);
$('#show-all').addEventListener('change', () => {
  localStorage.setItem('am:showAll', $('#show-all').checked ? '1' : '');
  renderIdle();
});
$('#filter').addEventListener('input', renderIdle);
$('#dismiss-result').addEventListener('click', () => call({ type: 'am:clearResult' }));
$('#open-manager').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$('#open-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manager/manager.html#settings') });
  window.close();
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'am:stateChanged') render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.scripts && !state?.recording && !state?.pending && !state?.playback) render();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

$('#save-scope-type').replaceChildren(...SCOPE_TYPES.map(t => h('option', { value: t.value }, t.label)));
$('#show-all').checked = !!localStorage.getItem('am:showAll');
[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
render().catch(e => showError(e.message));
