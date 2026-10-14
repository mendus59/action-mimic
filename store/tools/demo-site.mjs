// A fictional two-origin web app used for store screenshots: the host page
// (localhost) embeds a vendor form from a different origin (127.0.0.1).
import http from 'node:http';

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; color: #1f2937; background: #f3f4f6; }
`;

const hostPage = framePort => `<!doctype html><html><head><title>Demo Portal – Vendors</title><style>${css}
  header { height: 56px; background: #111827; color: #fff; display: flex; align-items: center; padding: 0 24px; gap: 12px; }
  header b { font-size: 16px; } header span { margin-left: auto; color: #9ca3af; font-size: 13px; }
  .env { background: #f59e0b; color: #111827; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .wrap { display: flex; height: calc(100vh - 56px); }
  aside { width: 220px; background: #fff; border-right: 1px solid #e5e7eb; padding: 16px 12px; }
  aside a { display: block; padding: 8px 12px; border-radius: 6px; color: #374151; text-decoration: none; }
  aside a.on { background: #eef2ff; color: #4338ca; font-weight: 600; }
  main { flex: 1; padding: 28px 36px; overflow: auto; }
  h1 { font-size: 22px; margin: 0 0 4px; } p.sub { color: #6b7280; margin: 0 0 20px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; max-width: 760px; }
  button.go { background: #4f46e5; color: #fff; border: 0; padding: 9px 16px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
  iframe { width: 100%; height: 470px; border: 0; margin-top: 4px; }
</style></head><body>
<header><b>Demo Portal</b><span class="env">QA</span><span>signed in as qa.tester</span></header>
<div class="wrap">
  <aside><a href="#">Dashboard</a><a class="on" href="#">Vendors</a><a href="#">Invoices</a><a href="#">Approvals</a><a href="#">Settings</a></aside>
  <main>
    <h1>Vendor onboarding</h1>
    <p class="sub">Requires the <b>Procurement Admin</b> role. The form is served by the vendor service in an embedded frame.</p>
    <div class="card" id="slot"><button class="go" id="start">Start onboarding</button></div>
  </main>
</div>
<script>
document.getElementById('start').onclick = () => {
  document.getElementById('slot').innerHTML = '<iframe id="vendor" src="http://127.0.0.1:${framePort}/form"></iframe>';
};
</script></body></html>`;

const formPage = `<!doctype html><html><head><title>Vendor form</title><style>${css}
  body { background: #fff; padding: 4px; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
  label { display: flex; flex-direction: column; font-size: 12px; font-weight: 600; color: #374151; gap: 4px; }
  label.full { grid-column: span 2; }
  input, select, textarea { font: inherit; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
  label.chk { flex-direction: row; align-items: center; font-weight: 400; gap: 8px; }
  label.chk input { width: 16px; height: 16px; }
  button { grid-column: span 2; justify-self: start; background: #059669; color: #fff; border: 0; padding: 9px 18px; border-radius: 6px; font: inherit; font-weight: 600; }
  #out { color: #059669; font-weight: 600; }
</style></head><body>
<form id="f">
  <label>Company name<input name="company" placeholder="Legal entity name"></label>
  <label>Contact email<input name="email" type="email" placeholder="ap@vendor.com"></label>
  <label>Tax ID<input name="taxId" placeholder="XX-XXXXXXX"></label>
  <label>Country<select name="country"><option value="">Select…</option><option value="us">United States</option><option value="ca">Canada</option><option value="mx">Mexico</option></select></label>
  <label>Payment terms<select name="terms"><option value="">Select…</option><option value="net15">Net 15</option><option value="net30">Net 30</option><option value="net60">Net 60</option></select></label>
  <label>Bank routing #<input name="routing" placeholder="9 digits"></label>
  <label class="full">Notes<textarea name="notes" rows="2"></textarea></label>
  <label class="chk full"><input type="checkbox" name="agree"> Vendor has accepted the supplier code of conduct</label>
  <button type="submit" data-testid="submit-vendor">Submit for approval</button>
</form>
<p id="out"></p>
<script>
document.getElementById('f').onsubmit = e => { e.preventDefault(); document.getElementById('out').textContent = '✓ Submitted for approval'; };
</script></body></html>`;

export function startDemoSite(hostPort, framePort) {
  const handler = req => (req.url.startsWith('/form') ? formPage : hostPage(framePort));
  const make = port =>
    http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(handler(req));
      })
      .listen(port);
  const servers = [make(hostPort), make(framePort)];
  return () => servers.forEach(s => s.close());
}
