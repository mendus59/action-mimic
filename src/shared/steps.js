// Human-readable descriptions of recorded steps, shared by popup, manager and background.

export const ACTION_LABELS = {
  click: 'Click',
  type: 'Type',
  select: 'Select',
  check: 'Set checkbox',
  key: 'Press key',
  navigate: 'Go to URL',
  wait: 'Wait'
};

function truncate(s, n = 40) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function targetLabel(step) {
  const t = step.target;
  if (!t) return '';
  return t.label || t.selectors?.[0] || t.tag || 'element';
}

export function describeStep(step) {
  switch (step.action) {
    case 'click':
      return `Click ${targetLabel(step)}`;
    case 'type':
      if (step.masked && !step.value) return `Type (password not recorded) into ${targetLabel(step)}`;
      return `Type "${truncate(step.masked ? '••••••' : step.value)}" into ${targetLabel(step)}`;
    case 'select':
      return `Select "${truncate(step.text || step.value)}" in ${targetLabel(step)}`;
    case 'check':
      return `${step.checked ? 'Check' : 'Uncheck'} ${targetLabel(step)}`;
    case 'key':
      return `Press ${step.key} on ${targetLabel(step)}`;
    case 'navigate':
      return `Go to ${truncate(step.url, 60)}`;
    case 'wait':
      return `Wait ${step.ms} ms`;
    default:
      return step.action;
  }
}

export function describeFrame(step) {
  const f = step.frame;
  if (!f || !f.path || f.path.length === 0) return 'top page';
  let host = '';
  try {
    host = new URL(f.url).host;
  } catch {}
  return `iframe ${f.path.join('›')}${host ? ' · ' + host : ''}`;
}
