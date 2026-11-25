// Parser XML minimale (i Web Worker non hanno DOMParser).
// Sufficiente per l'header XML dei file E57: elementi, attributi, testo e CDATA.

export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(text.slice(i, lt));
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith('<!--', lt)) {
      i = text.indexOf('-->', lt) + 3;
    } else if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      i = text.indexOf('>', lt) + 1;
    } else if (text[lt + 1] === '/') {
      stack.pop();
      i = text.indexOf('>', lt) + 1;
    } else {
      const gt = findTagEnd(text, lt);
      let body = text.slice(lt + 1, gt);
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(body);
      const el = { name: m[1], attrs: {}, children: [], text: '' };
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = re.exec(body))) el.attrs[a[1]] = decode(a[3] ?? a[4]);
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
      i = gt + 1;
    }
  }
  return root;
}

function findTagEnd(text, from) {
  let q = null;
  for (let j = from + 1; j < text.length; j++) {
    const c = text[j];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
  }
  return text.length;
}

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e]);
}

export function child(el, name) {
  return el ? el.children.find((c) => c.name === name) : undefined;
}

export function childNum(el, name, def = undefined) {
  const c = child(el, name);
  if (!c) return def;
  const v = parseFloat(c.text.trim());
  return Number.isFinite(v) ? v : def;
}
