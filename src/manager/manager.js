import { h, $ } from '../shared/dom.js';
import {
  getScripts, setScripts, getScript, upsertScript, deleteScript, uid,
  getSettings, saveSettings, resetSettings, buildExport, downloadJson, parseImport
} from '../shared/storage.js';
import { SCOPE_TYPES, describeScope, defaultScopeValue } from '../shared/scope.js';
import { ACTION_LABELS, describeFrame } from '../shared/steps.js';

const selected = new Set();
let editing = null; // working copy of the script being edited
let dirty = false;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function fileStamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

function exportScripts(scripts, name) {
  downloadJson(buildExport(scripts), `action-mimic-${name}-${fileStamp()}.json`);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'script';
}

// ---------------------------------------------------------------------------
// Routing: #scripts | #edit/<id> | #settings | #transfer
// ---------------------------------------------------------------------------

async function route() {
  const [view, id] = (location.hash.slice(1) || 'scripts').split('/');
  if (editing && dirty && !(view === 'edit' && id === editing.id)) {
    if (!confirm('Discard unsaved changes to this script?')) {
      history.replaceState(null, '', `#edit/${editing.id}`);
      return;
    }
  }
  if (view !== 'edit') {
    editing = null;
    setDirty(false);
  }
  for (const s of document.querySelectorAll('main > section')) s.hidden = true;
  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('active', a.dataset.view === (view === 'edit' ? 'scripts' : view));
  }
  if (view === 'edit') return openEditor(id);
  if (view === 'settings') return renderSettings();
  if (view === 'transfer') return ($('#view-transfer').hidden = false);
  return renderList();
}

// ---------------------------------------------------------------------------
// Script list
// ---------------------------------------------------------------------------

async function renderList() {
  $('#view-scripts').hidden = false;
  const all = await getScripts();
  for (const id of [...selected]) if (!all.some(s => s.id === id)) selected.delete(id);

  const q = $('#search').value.trim().toLowerCase();
  const list = all
    .filter(s => !q || [s.name, s.description, describeScope(s.scope)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  $('#script-table tbody').replaceChildren(
    ...list.map(s =>
      h(
        'tr',
        {},
        h('td', { class: 'chk' },
          h('input', {
            type: 'checkbox',
            checked: selected.has(s.id),
            onchange: e => {
              e.target.checked ? selected.add(s.id) : selected.delete(s.id);
              updateBulk(all);
            }
          })
        ),
        h('td', { class: 'name-cell' }, h('a', { href: `#edit/${s.id}` }, s.name), s.description ? h('small', {}, s.description) : null),
        h('td', { class: 'scope-cell', title: describeScope(s.scope) }, describeScope(s.scope)),
        h('td', { class: 'num' }, s.steps.length),
        h('td', { class: 'small muted' }, new Date(s.updatedAt || s.createdAt).toLocaleString()),
        h('td', { class: 'actions' },
          h('a', { class: 'btn sm', href: `#edit/${s.id}` }, 'Edit'),
          h('button', { class: 'btn sm', onclick: () => exportScripts([s], slug(s.name)) }, 'Export'),
          h('button', { class: 'btn sm danger', onclick: () => removeScripts([s.id]) }, 'Delete')
        )
      )
    )
  );
  $('#script-table').hidden = all.length === 0;
  $('#no-scripts').hidden = all.length > 0;
  updateBulk(all);
}

function updateBulk(all) {
  $('#bulk').hidden = selected.size === 0;
  $('#bulk-count').textContent = `${selected.size} selected`;
  $('#select-all').checked = all.length > 0 && selected.size === all.length;
}

async function removeScripts(ids) {
  const msg = ids.length === 1 ? 'Delete this script?' : `Delete ${ids.length} scripts?`;
  if (!confirm(msg + ' This cannot be undone.')) return false;
  await setScripts((await getScripts()).filter(s => !ids.includes(s.id)));
  ids.forEach(id => selected.delete(id));
  toast(ids.length === 1 ? 'Script deleted' : `${ids.length} scripts deleted`);
  return true;
}

$('#search').addEventListener('input', renderList);
$('#select-all').addEventListener('change', async e => {
  const all = await getScripts();
  selected.clear();
  if (e.target.checked) all.forEach(s => selected.add(s.id));
  renderList();
});
$('#bulk-export').addEventListener('click', async () => {
  const all = await getScripts();
  exportScripts(all.filter(s => selected.has(s.id)), 'selection');
});
$('#bulk-delete').addEventListener('click', async () => {
  if (await removeScripts([...selected])) renderList();
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function setDirty(d) {
  dirty = d;
  $('#dirty').hidden = !d;
}

async function openEditor(id) {
  if (!editing || editing.id !== id) {
    const script = await getScript(id);
    if (!script) {
      toast('Script not found');
      location.hash = '#scripts';
      return;
    }
    editing = structuredClone(script);
    setDirty(false);
  }
  $('#view-edit').hidden = false;
  $('#e-name').value = editing.name;
  $('#e-desc').value = editing.description || '';
  $('#e-scope-type').value = editing.scope?.type || 'global';
  $('#e-scope-value').value = editing.scope?.value || '';
  $('#e-start').textContent = editing.startUrl || '—';
  updateScopeUi();
  renderSteps();
}

function updateScopeUi() {
  const type = $('#e-scope-type').value;
  $('#e-scope-value').hidden = type === 'global';
  $('#e-scope-hint').textContent = SCOPE_TYPES.find(t => t.value === type)?.hint || '';
}

function stepValueEditor(step) {
  const edit = (key, transform = v => v) => e => {
    step[key] = transform(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    setDirty(true);
  };
  switch (step.action) {
    case 'type':
      return h('div', {},
        h('input', {
          class: 'input',
          type: step.masked ? 'password' : 'text',
          value: step.value ?? '',
          placeholder: step.masked ? 'Password (not recorded)' : '',
          oninput: edit('value')
        }),
        step.masked && !step.value ? h('div', { class: 'warn' }, 'Enter a password or this step will fail.') : null
      );
    case 'select':
      return h('input', {
        class: 'input',
        value: Array.isArray(step.value) ? step.value.join(', ') : step.value ?? '',
        title: step.text ? `Option text: ${step.text}` : '',
        oninput: edit('value', v => (Array.isArray(step.value) ? v.split(',').map(x => x.trim()) : v))
      });
    case 'check':
      return h('label', { class: 'row small' },
        h('input', { type: 'checkbox', checked: !!step.checked, onchange: edit('checked') }),
        'checked'
      );
    case 'key':
      return h('select', { class: 'input', onchange: edit('key') },
        ['Enter', 'Escape', 'Tab'].map(k => h('option', { value: k, selected: step.key === k }, k))
      );
    case 'navigate':
      return h('input', { class: 'input mono-input', value: step.url ?? '', oninput: edit('url') });
    case 'wait':
      return h('div', { class: 'row' },
        h('input', { class: 'input', type: 'number', min: '0', step: '100', value: step.ms ?? 1000, oninput: edit('ms', Number) }),
        h('span', { class: 'small muted' }, 'ms')
      );
    default:
      return h('span', { class: 'muted' }, '—');
  }
}

function renderSteps() {
  const steps = editing.steps;
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDirty(true);
    renderSteps();
  };
  $('#steps-table tbody').replaceChildren(
    ...steps.map((step, i) =>
      h('tr', {},
        h('td', { class: 'num' }, i + 1),
        h('td', { class: 'action' }, ACTION_LABELS[step.action] || step.action),
        h('td', { class: 'target' },
          step.target
            ? [
                h('div', { class: 'label' }, step.target.label || ''),
                h('input', {
                  class: 'input mono-input',
                  value: step.target.selectors?.[0] ?? '',
                  title: (step.target.selectors || []).join('\n'),
                  oninput: e => {
                    step.target.selectors = [e.target.value, ...(step.target.selectors || []).slice(1)];
                    setDirty(true);
                  }
                })
              ]
            : h('span', { class: 'muted' }, '—')
        ),
        h('td', { class: 'value' }, stepValueEditor(step)),
        h('td', { class: 'frame', title: step.frame?.url || '' }, step.target ? describeFrame(step) : ''),
        h('td', { class: 'actions' },
          h('button', { class: 'btn sm', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn sm', title: 'Move down', disabled: i === steps.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', {
            class: 'btn sm danger',
            title: 'Delete step',
            onclick: () => {
              steps.splice(i, 1);
              setDirty(true);
              renderSteps();
            }
          }, '✕')
        )
      )
    )
  );
}

function addStep(step) {
  editing.steps.push({ id: uid(), delay: 0, ...step });
  setDirty(true);
  renderSteps();
}

async function saveEditor() {
  editing.name = $('#e-name').value.trim() || 'Untitled script';
  editing.description = $('#e-desc').value.trim();
  editing.scope = { type: $('#e-scope-type').value, value: $('#e-scope-value').value.trim() };
  if (editing.scope.type === 'regex') {
    try {
      new RegExp(editing.scope.value);
    } catch {
      return toast('The scope regex is invalid');
    }
  }
  if (editing.scope.type !== 'global' && !editing.scope.value) return toast('Enter a value for the scope');
  editing = structuredClone(await upsertScript(editing));
  setDirty(false);
  toast('Saved');
}

for (const id of ['#e-name', '#e-desc', '#e-scope-value']) {
  $(id).addEventListener('input', () => setDirty(true));
}
$('#e-scope-type').addEventListener('change', () => {
  const type = $('#e-scope-type').value;
  if (editing.startUrl) $('#e-scope-value').value = defaultScopeValue(type, editing.startUrl);
  updateScopeUi();
  setDirty(true);
});
$('#edit-save').addEventListener('click', saveEditor);
$('#back').addEventListener('click', () => (location.hash = '#scripts'));
$('#add-wait').addEventListener('click', () => addStep({ action: 'wait', ms: 1000 }));
$('#add-nav').addEventListener('click', () => addStep({ action: 'navigate', url: editing.startUrl || 'https://' }));
$('#edit-export').addEventListener('click', () => exportScripts([editing], slug(editing.name)));
$('#edit-duplicate').addEventListener('click', async () => {
  const copy = structuredClone(editing);
  copy.id = uid();
  copy.name = `${$('#e-name').value.trim() || editing.name} (copy)`;
  copy.createdAt = Date.now();
  copy.steps = copy.steps.map(s => ({ ...s, id: uid() }));
  await upsertScript(copy);
  setDirty(false);
  toast('Duplicated');
  location.hash = `#edit/${copy.id}`;
});
$('#edit-delete').addEventListener('click', async () => {
  if (!confirm('Delete this script? This cannot be undone.')) return;
  await deleteScript(editing.id);
  setDirty(false);
  editing = null;
  toast('Script deleted');
  location.hash = '#scripts';
});
window.addEventListener('beforeunload', e => {
  if (dirty) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const form = $('#settings-form');

async function renderSettings() {
  $('#view-settings').hidden = false;
  const s = await getSettings();
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = s[el.name];
  }
  syncTimingRows();
}

function syncTimingRows() {
  const mode = form.elements.timingMode.value;
  for (const row of form.querySelectorAll('[data-when]')) row.hidden = row.dataset.when !== mode;
}

form.addEventListener('change', async e => {
  const el = e.target;
  if (!el.name) return;
  let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  if (el.type === 'number' && (!Number.isFinite(v) || el.value === '')) return renderSettings();
  if (el.type === 'number' && el.min !== '') v = Math.max(Number(el.min), v);
  await saveSettings({ [el.name]: v });
  syncTimingRows();
  toast('Settings saved');
});
form.addEventListener('submit', e => e.preventDefault());
$('#reset-settings').addEventListener('click', async () => {
  if (!confirm('Reset all settings to their defaults?')) return;
  await resetSettings();
  renderSettings();
  toast('Settings reset');
});

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

$('#export-all').addEventListener('click', async () => {
  const all = await getScripts();
  if (!all.length) return toast('No scripts to export');
  exportScripts(all, 'all');
});
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const out = $('#import-result');
  try {
    const incoming = parseImport(await file.text());
    const replace = $('#import-replace').checked;
    const scripts = await getScripts();
    let added = 0;
    let replaced = 0;
    for (const s of incoming) {
      const i = scripts.findIndex(x => x.id === s.id);
      if (i >= 0 && replace) {
        scripts[i] = s;
        replaced++;
      } else {
        if (i >= 0) s.id = uid();
        scripts.push(s);
        added++;
      }
    }
    await setScripts(scripts);
    out.className = 'small ok';
    out.textContent = `Imported ${added} new script(s)` + (replaced ? `, replaced ${replaced}` : '') + ` from ${file.name}.`;
  } catch (err) {
    out.className = 'small err';
    out.textContent = `Import failed: ${err.message}`;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const scopeOptions = SCOPE_TYPES.map(t => h('option', { value: t.value }, t.label));
$('#e-scope-type').replaceChildren(...scopeOptions);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.scripts) return;
  if (!$('#view-scripts').hidden) renderList();
});
window.addEventListener('hashchange', route);
route();
