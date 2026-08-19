/**
 * domshim.mjs — a minimal DOM/window/localStorage/fetch shim, written by the
 * CONDUCTOR at verification time (cycle 14), sufficient to actually EXECUTE
 * `web/js/*.js` screens under `node` and assert on what a user would see.
 *
 * Why this exists: every prior cycle's web-layer gate could only read the
 * client source as TEXT. A text gate cannot tell "the screen renders the
 * shortfall sentence" from "the file contains the word shortfall". This shim
 * turns the second claim into the first.
 *
 * It is deliberately NOT a DOM implementation. It implements exactly the
 * surface `web/js/ui.js` + the screens touch, and it is honest about the rest:
 * anything unimplemented throws loudly rather than returning a plausible
 * undefined, so a gate can never pass by silently no-opping.
 *
 * Builders never see this file. It lives under .swarm/runs/, not web/.
 */

const SVG_TAG_RE = /^\s*<\s*([a-zA-Z][-a-zA-Z0-9]*)/;

let activeElementRef = null;

class ShimNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(child) {
    if (child == null) throw new Error('appendChild(null)');
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, ref) {
    if (ref == null) return this.appendChild(child);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(i, 0, child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  replaceChildren(...kids) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    for (const k of kids) {
      if (k == null) continue;
      this.appendChild(typeof k === 'string' ? new ShimText(k) : k);
    }
  }

  get children() {
    return this.childNodes.filter((n) => n instanceof ShimElement);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] || null;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  contains(other) {
    let n = other;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }

  /** Depth-first list of every descendant element. */
  descendants() {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c instanceof ShimElement) {
          out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
}

class ShimText extends ShimNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

class ClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return String(this.el.className || '').split(/\s+/).filter(Boolean);
  }
  add(...names) {
    const s = new Set(this._list());
    for (const n of names) s.add(n);
    this.el.className = [...s].join(' ');
  }
  remove(...names) {
    const s = new Set(this._list());
    for (const n of names) s.delete(n);
    this.el.className = [...s].join(' ');
  }
  toggle(name, force) {
    const has = this.contains(name);
    const want = force === undefined ? !has : !!force;
    if (want) this.add(name);
    else this.remove(name);
    return want;
  }
  contains(name) {
    return this._list().includes(name);
  }
}

class ShimElement extends ShimNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map();
    this.className = '';
    this.dataset = {};
    this.style = new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => ((t[k] = v), true) });
    this.listeners = new Map();
    this.rawHtml = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }

  // --- attributes -----------------------------------------------------------
  setAttribute(name, value) {
    if (name === 'class') {
      this.className = String(value);
      return;
    }
    if (name === 'id') this.id = String(value);
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    if (name === 'class') return !!this.className;
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get classList() {
    return new ClassList(this);
  }

  // --- content --------------------------------------------------------------
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new ShimText(v));
  }

  /**
   * Crude, honest innerHTML. `ui.js` uses it for ONE purpose: trusted inline
   * SVG in `icon()`, which then reads `.firstElementChild`. So we synthesise a
   * single child element named after the first tag in the string and keep the
   * raw markup for assertions. We do NOT pretend to parse HTML.
   */
  set innerHTML(html) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.rawHtml = String(html);
    const m = SVG_TAG_RE.exec(String(html));
    if (m) {
      const child = new ShimElement(m[1]);
      child.rawHtml = String(html);
      this.appendChild(child);
    }
  }
  get innerHTML() {
    return this.rawHtml ?? '';
  }

  // --- events ---------------------------------------------------------------
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(evt) {
    // Bubbles up the tree, like the real thing — screens rely on delegation.
    let node = this;
    evt.target = evt.target || this;
    while (node) {
      evt.currentTarget = node;
      const l = node.listeners && node.listeners.get(evt.type);
      if (l) for (const fn of [...l]) fn(evt);
      if (evt._stopped) break;
      node = node.parentNode;
    }
    return !evt.defaultPrevented;
  }
  click() {
    this.dispatchEvent(makeEvent('click', this));
  }
  focus() {
    activeElementRef = this;
  }
  blur() {
    if (activeElementRef === this) activeElementRef = null;
  }
  scrollIntoView() {}
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  // --- selectors ------------------------------------------------------------
  matches(sel) {
    return matchesSimple(this, sel);
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n instanceof ShimElement && matchesSimple(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const groups = String(sel)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    for (const g of groups) {
      // Support descendant combinators by matching only the RIGHTMOST simple
      // selector and then confirming each ancestor selector appears above it.
      const parts = g.split(/\s+/).filter(Boolean);
      const last = parts[parts.length - 1];
      for (const el of this.descendants()) {
        if (!matchesSimple(el, last)) continue;
        let ok = true;
        let cursor = el.parentNode;
        for (let i = parts.length - 2; i >= 0; i--) {
          let found = false;
          let n = cursor;
          while (n) {
            if (n instanceof ShimElement && matchesSimple(n, parts[i])) {
              found = true;
              cursor = n.parentNode;
              break;
            }
            n = n.parentNode;
          }
          if (!found) {
            ok = false;
            break;
          }
        }
        if (ok && !out.includes(el)) out.push(el);
      }
    }
    return out;
  }
}

/** Supports: tag, .class, #id, [attr], [attr="v"], and concatenations thereof. */
function matchesSimple(el, sel) {
  if (!(el instanceof ShimElement)) return false;
  const tokens = String(sel).match(/(^[a-zA-Z][-a-zA-Z0-9]*)|(\.[-\w]+)|(#[-\w]+)|(\[[^\]]+\])/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('.')) {
      if (!el.classList.contains(t.slice(1))) return false;
    } else if (t.startsWith('#')) {
      if (el.id !== t.slice(1)) return false;
    } else if (t.startsWith('[')) {
      const inner = t.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (!el.hasAttribute(inner)) return false;
      } else {
        const name = inner.slice(0, eq);
        const want = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (el.getAttribute(name) !== want) return false;
      }
    } else {
      if (el.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}

export function makeEvent(type, target) {
  return {
    type,
    target,
    currentTarget: target,
    defaultPrevented: false,
    _stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this._stopped = true;
    },
    key: '',
  };
}

class ShimDocument extends ShimNode {
  constructor() {
    super();
    this.nodeType = 9;
    this.documentElement = new ShimElement('html');
    this.body = new ShimElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.listeners = new Map();
  }
  createElement(tag) {
    return new ShimElement(tag);
  }
  createTextNode(t) {
    return new ShimText(t);
  }
  createDocumentFragment() {
    return new ShimElement('#fragment');
  }
  getElementById(id) {
    for (const el of this.descendants()) if (el.id === id) return el;
    return null;
  }
  querySelector(sel) {
    return this.body.querySelector(sel);
  }
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(evt) {
    const l = this.listeners.get(evt.type);
    if (l) for (const fn of [...l]) fn(evt);
    return true;
  }
  get activeElement() {
    return activeElementRef || this.body;
  }
}

/**
 * Install the shim onto globalThis.
 * @param {{baseUrl: string}} opts - baseUrl the relative fetch() calls resolve against.
 * @returns {{document: ShimDocument, mountApp: () => ShimElement, reset: () => void}}
 */
export function installDom({ baseUrl }) {
  const document = new ShimDocument();

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };

  // Capture the REAL timers before we shadow the globals with these — else
  // `globalThis.setTimeout = win.setTimeout` makes win.setTimeout call itself.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  const windowListeners = new Map();
  const win = {
    document,
    localStorage,
    setTimeout: (fn, ms) => realSetTimeout(fn, ms),
    clearTimeout: (id) => realClearTimeout(id),
    requestAnimationFrame: (fn) => realSetTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => realClearTimeout(id),
    location: { hash: '', pathname: '/', search: '', origin: baseUrl, href: baseUrl + '/' },
    history: {
      replaceState(_s, _t, url) {
        const i = String(url).indexOf('#');
        win.location.hash = i >= 0 ? String(url).slice(i) : '';
      },
      pushState(_s, _t, url) {
        win.history.replaceState(_s, _t, url);
      },
    },
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = windowListeners.get(type);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatchEvent(evt) {
      const l = windowListeners.get(evt.type);
      if (l) for (const fn of [...l]) fn(evt);
      return true;
    },
    getComputedStyle: () => new Proxy({}, { get: () => '' }),
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node-shim' },
    scrollTo() {},
  };

  // Relative-path fetch: api.js calls fetch('/api/...'), which node's global
  // fetch rejects. Resolve against the live server this gate booted.
  const realFetch = globalThis.fetch;
  const shimFetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? baseUrl + input : input;
    return realFetch(url, init);
  };

  globalThis.window = win;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.setTimeout = win.setTimeout;
  globalThis.clearTimeout = win.clearTimeout;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  globalThis.getComputedStyle = win.getComputedStyle;
  // node defines `navigator` as a getter-only global; leave it alone rather
  // than pretend we replaced it.
  if (!('navigator' in globalThis)) globalThis.navigator = win.navigator;
  globalThis.fetch = shimFetch;
  globalThis.Node = ShimNode;
  globalThis.HTMLElement = ShimElement;
  globalThis.Element = ShimElement;
  globalThis.Event = class {
    constructor(type) {
      Object.assign(this, makeEvent(type, null));
    }
  };

  function mountApp() {
    let app = document.getElementById('app');
    if (!app) {
      app = document.createElement('div');
      app.setAttribute('id', 'app');
      document.body.appendChild(app);
      for (const id of ['sheet-root', 'snackbar-root', 'aria-live-polite', 'aria-live-assertive']) {
        const p = document.createElement('div');
        p.setAttribute('id', id);
        document.body.appendChild(p);
      }
    }
    return app;
  }

  return { document, window: win, localStorage, mountApp, ShimElement, ShimText };
}

/** All visible text in a subtree, whitespace-normalised — what a user reads. */
export function visibleText(el) {
  return String(el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Every element in a subtree that looks tappable. */
export function tappables(root) {
  return root
    .descendants()
    .filter(
      (el) =>
        el.tagName === 'BUTTON' ||
        el.tagName === 'A' ||
        el.getAttribute('role') === 'button' ||
        (el.listeners && el.listeners.has('click')),
    );
}

/** Wait for pending microtasks + timers to settle (screens fetch on mount). */
const REAL_SET_TIMEOUT = globalThis.setTimeout;
export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => REAL_SET_TIMEOUT(r, 5));
  }
}
