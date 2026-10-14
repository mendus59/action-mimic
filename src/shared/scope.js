// A script's scope decides which pages it is offered on in the popup.
// Scopes are matched against the URL of the tab's top-level page, so a script
// that fills a form inside an iframe is scoped to the page hosting the iframe.

export const SCOPE_TYPES = [
  { value: 'host', label: 'This host', hint: 'Exact host incl. port, e.g. app.example.com' },
  { value: 'domain', label: 'Domain + subdomains', hint: 'e.g. example.com matches app.example.com' },
  { value: 'page', label: 'This page', hint: 'Origin + path, ignores ?query and #hash' },
  { value: 'prefix', label: 'URL starts with', hint: 'e.g. https://app.example.com/admin/' },
  { value: 'regex', label: 'URL matches regex', hint: 'JavaScript regular expression' },
  { value: 'global', label: 'Any site', hint: 'Offered everywhere' }
];

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function matchesScope(scope, url) {
  if (!scope) return false;
  if (scope.type === 'global') return true;
  const u = parse(url);
  if (!u) return false;
  const value = (scope.value || '').trim();
  if (!value) return false;
  switch (scope.type) {
    case 'host':
      return u.host.toLowerCase() === value.toLowerCase();
    case 'domain': {
      const h = u.hostname.toLowerCase();
      const d = value.toLowerCase().replace(/^\*?\./, '');
      return h === d || h.endsWith('.' + d);
    }
    case 'page':
      return stripQuery(url) === stripQuery(value);
    case 'prefix':
      return url.startsWith(value);
    case 'regex':
      try {
        return new RegExp(value).test(url);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function stripQuery(url) {
  const u = parse(url);
  return u ? (u.origin + u.pathname).replace(/\/$/, '') : url;
}

// A sensible default value for a scope type, derived from a URL.
export function defaultScopeValue(type, url) {
  const u = parse(url);
  if (!u) return '';
  switch (type) {
    case 'host':
      return u.host;
    case 'domain': {
      // Naive registrable-domain guess (last two labels); the user can edit it.
      const parts = u.hostname.split('.');
      const isIp = /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':');
      return isIp || parts.length <= 2 ? u.hostname : parts.slice(-2).join('.');
    }
    case 'page':
      return u.origin + u.pathname;
    case 'prefix':
      return u.origin + u.pathname.replace(/[^/]*$/, '');
    case 'regex':
      return '^' + u.origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '/';
    default:
      return '';
  }
}

export function describeScope(scope) {
  if (!scope) return 'No scope';
  const t = SCOPE_TYPES.find(s => s.value === scope.type);
  if (scope.type === 'global') return 'Any site';
  return `${t ? t.label : scope.type}: ${scope.value}`;
}

export function isRecordableUrl(url) {
  return /^(https?|file):/i.test(url || '');
}
