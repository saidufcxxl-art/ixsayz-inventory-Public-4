import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const root = process.cwd();
const httpPort = 8130;
const debugPort = 9334;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const userDataDir = `${process.env.TEMP}\\ixsayz-cdp-${Date.now()}`;

const server = spawn('python', ['-m', 'http.server', String(httpPort)], {
  cwd: root,
  windowsHide: true,
  stdio: 'ignore',
});

const browser = spawn(edge, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${debugPort}`,
  'about:blank',
], {
  windowsHide: true,
  stdio: 'ignore',
});

async function getJson(url, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await wait(250);
  }
  throw last;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        const msgId = ++id;
        const message = { id: msgId, method, params };
        if (sessionId) message.sessionId = sessionId;
        ws.send(JSON.stringify(message));
        return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
      },
      close() {
        ws.close();
      },
    });
  });
}

const pageTest = `
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, label) => {
    for (let i = 0; i < 80; i++) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('РќРµ РґРѕР¶РґР°Р»СЃСЏ: ' + label);
  };
  window.__downloads = [];
  window.__prints = [];
  URL.createObjectURL = blob => {
    window.__downloads.push(blob);
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  window.open = () => ({
    document: {
      write(html) { window.__prints.push(html); },
      close() {}
    },
    print() { window.__printed = true; }
  });

  await waitFor(() => document.querySelector('[data-act="newDelivery"]'), 'РєРЅРѕРїРєР° Р·Р°РІРѕР·Р°');
  const stamp = Date.now();
  document.querySelector('[data-act="newDelivery"]').click();
  await waitFor(() => document.querySelector('#fDelivery'), 'С„РѕСЂРјР° Р·Р°РІРѕР·Р°');
  document.querySelector('#fDelivery [name="name"]').value = 'TEST ZAVOZ ' + stamp;
  document.querySelector('#fDelivery [name="date"]').value = '2026-07-01';
  document.querySelector('#fDelivery').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector('[data-act="newSupplier"]'), 'СЌРєСЂР°РЅ Р·Р°РІРѕР·Р°');

  document.querySelector('[data-act="newSupplier"]').click();
  await waitFor(() => document.querySelector('#fSupplier'), 'С„РѕСЂРјР° РїРѕСЃС‚Р°РІС‰РёРєР°');
  document.querySelector('#fSupplier [name="name"]').value = 'TEST SUPPLIER ' + stamp;
  document.querySelector('#fSupplier').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector('[data-act="newProduct"]'), 'СЌРєСЂР°РЅ РїРѕСЃС‚Р°РІС‰РёРєР°');

  document.querySelector('[data-act="newProduct"]').click();
  await waitFor(() => document.querySelector('#fProduct'), 'С„РѕСЂРјР° С‚РѕРІР°СЂР°');
  const productName = 'TEST PRODUCT ' + stamp;
  const productForm = document.querySelector('#fProduct');
  productForm.querySelector('[name="name"]').value = productName;
  productForm.querySelector('[name="size"]').value = '41';
  productForm.querySelector('[name="qty"]').value = '5';
  productForm.querySelector('[name="buy"]').value = '1000';
  productForm.querySelector('[name="sale"]').value = '1990';
  productForm.querySelector('[name="labelQty"]').value = '5';
  productForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => document.body.textContent.includes(productName), 'С‚РѕРІР°СЂ РІ СЃРїРёСЃРєРµ');

  const body = document.body.textContent;
  const barcode = (body.match(/29\\d{11}/) || [])[0];
  if (!barcode) throw new Error('EAN-13 РЅРµ РїРѕСЏРІРёР»СЃСЏ');

  document.querySelector('[data-tab="export"]').click();
  await waitFor(() => document.querySelector('[data-act="csv"]'), 'СЌРєСЃРїРѕСЂС‚');
  document.querySelector('[data-act="csv"]').click();
  await waitFor(() => window.__downloads.length === 1, 'CSV blob');
  const csv = await window.__downloads[0].text();
  if (!csv.includes(productName) || !csv.includes(barcode)) throw new Error('CSV РЅРµ СЃРѕРґРµСЂР¶РёС‚ С‚РѕРІР°СЂ РёР»Рё С€С‚СЂРёС…РєРѕРґ');

  document.querySelector('[data-tab="labels"]').click();
  await waitFor(() => document.querySelector('[data-act="printLabels"]'), 'РїРµС‡Р°С‚СЊ С†РµРЅРЅРёРєРѕРІ');
  document.querySelector('[data-act="printLabels"]').click();
  await waitFor(() => window.__prints.length === 1, 'HTML С†РµРЅРЅРёРєРѕРІ');
  const labels = window.__prints[0];
  if (!labels.includes('@page{size:43mm 25mm')) throw new Error('Р Р°Р·РјРµСЂ С†РµРЅРЅРёРєР° РЅРµ 43x25 РјРј');
  const labelCount = (labels.match(/class="label"/g) || []).length;
  if (labelCount !== 5) throw new Error('labelQty=5, Р° С†РµРЅРЅРёРєРѕРІ СЃРѕР·РґР°РЅРѕ ' + labelCount);

  document.querySelector('[data-tab="report"]').click();
  await waitFor(() => document.querySelector('[data-act="printReport"]'), 'РѕС‚С‡РµС‚');
  document.querySelector('[data-act="printReport"]').click();
  await waitFor(() => window.__prints.length === 2, 'HTML РѕС‚С‡РµС‚Р°');
  if (!window.__prints[1].includes('IXSAYZ Inventory')) throw new Error('РћС‚С‡РµС‚ РЅРµ СЃРѕР·РґР°РЅ');

  return { ok: true, productName, barcode, csvLength: csv.length, labelCount };
})()
`;

try {
  const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
  const cdp = await connect(version.webSocketDebuggerUrl);
  const target = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${httpPort}/index.html` });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await wait(1500);
  const result = await send('Runtime.evaluate', {
    expression: pageTest,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser test failed');
  }
  console.log('PASS ' + JSON.stringify(result.result.value));
  cdp.close();
} finally {
  browser.kill();
  server.kill();
}

