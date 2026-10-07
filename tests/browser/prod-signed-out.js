// Real production, signed out, nothing intercepted: sign-in screen renders, no console errors.
const PORT = Number(process.argv[2] || 9333), URL_ = process.env.APP || 'https://golf-tracker-snowy.vercel.app/';
(async () => {
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const errs = []; const reqs = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('.supabase.co')) reqs.push(m.params.request.method + ' ' + m.params.request.url.split('?')[0]);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Storage.clearDataForOrigin', { origin: new URL(URL_).origin, storageTypes: 'all' });
  await send('Page.navigate', { url: URL_ }); await new Promise(r => setTimeout(r, 4000));
  console.log('active screen:', await ev(`document.querySelector('.screen.active')?.id`));
  console.log('sign-in button present:', await ev(`!!document.getElementById('btn-login')`));
  console.log('new coaching Home markup deployed:', await ev(`!!document.getElementById('home-focus') && !!document.getElementById('screen-profile')`));
  console.log('Supabase requests while signed out:', reqs.length ? reqs : 'none');
  console.log('console errors:', errs.length ? errs : 'none');
  ws.close();
})();
