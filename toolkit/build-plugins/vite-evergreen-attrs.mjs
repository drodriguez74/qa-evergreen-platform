// vite-evergreen-attrs — Tier 2 of the QA Evergreen locator fallback strategy.
//
// A Vite plugin that, at dev/build time, injects a STABLE
//   data-evergreen="<stable-id>"
// attribute onto interactive JSX elements that LACK an accessible name
// (role-less clickable <div>/<span>, icon-only buttons, onClick handlers with
// no text/aria-label). The platform locates by role + accessible name; this
// plugin is a deliberate *fallback* for apps you OWN the build of but that
// can't/won't add ARIA (yet). See ./README.md for the honest caveats.
//
// KEYING RULE (the whole point): the id is derived from COMPONENT IDENTITY —
//   <ComponentName>:<hint>            e.g. "DashboardPage:menu-toggle"
//   <ComponentName>:<hint>#<n>        when several siblings share a hint
// where <ComponentName> comes from the enclosing function/const component (or,
// failing that, the file basename) and <hint> is the first stable signal we
// find on the element, in priority order:
//   1. className token (e.g. "menu-toggle")
//   2. icon/glyph or trimmed text child (e.g. "☰" -> "menu", "Save" -> "save")
//   3. the element tag name (e.g. "div")
// A per-component occurrence counter disambiguates collisions. Crucially the id
// NEVER uses raw source line numbers, so editing the file (adding imports,
// reformatting, moving the block) does not change the id — the locator survives.
//
// Dependency note: this uses @babel/{parser,traverse,generator,types}, which are
// already present transitively via @vitejs/plugin-react. We do NOT add them to
// package.json; if they are ever absent the plugin degrades to a no-op with a
// warning rather than breaking the build (see the lazy import + try/catch).

import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ATTR = 'data-evergreen';

// JSX-bearing files we attempt to transform.
const JSX_RE = /\.(jsx|tsx)$/;

// Attributes that, if present, mean the element already exposes an accessible
// name (or an explicit role we shouldn't second-guess) — so we leave it alone.
const NAME_GIVING_ATTRS = new Set([
  'aria-label',
  'aria-labelledby',
  'title',
  'alt',
  'placeholder',
  ATTR, // already injected (e.g. authored by hand) — never overwrite
]);

// Tags that are inherently interactive and get an accessible name from their
// text content. We still inject when they are icon-only (no text name).
const NATIVE_INTERACTIVE = new Set(['button', 'a']);

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Map a handful of common glyphs to readable hints; otherwise fall back to a
// generic but stable token so the id stays deterministic.
const GLYPH_HINTS = {
  '☰': 'menu',
  '✕': 'close',
  '×': 'close',
  '⋮': 'more',
  '⋯': 'more',
  '✓': 'check',
  '★': 'star',
  '☆': 'star',
  '▾': 'caret',
  '▼': 'caret',
  '←': 'back',
  '→': 'next',
  '⚙': 'settings',
  '🔍': 'search',
};

export default function evergreenAttrs(options = {}) {
  const {
    // Set false to skip native <button>/<a> entirely and only target role-less
    // clickable divs/spans.
    includeNativeInteractive = true,
    // Logged hint ids are useful while wiring the plugin up.
    debug = false,
  } = options;

  let babel = null;
  let babelLoadFailed = false;
  // The project being built (set in configResolved). We resolve @babel/* against
  // the *target app's* node_modules — that's where it lives transitively via
  // @vitejs/plugin-react — not against this plugin file's own location.
  let projectRoot = process.cwd();

  async function loadBabel() {
    if (babel || babelLoadFailed) return babel;
    // Build a require anchored in the target project so @babel/* resolves the
    // same way the app's own code would resolve it.
    const req = createRequire(path.join(projectRoot, 'noop.js'));
    const imp = async (name) => {
      const resolved = req.resolve(name); // throws if truly absent
      return import(pathToFileURL(resolved).href);
    };
    try {
      const [parser, traverseMod, generateMod, types] = await Promise.all([
        imp('@babel/parser'),
        imp('@babel/traverse'),
        imp('@babel/generator'),
        imp('@babel/types'),
      ]);
      // Interop is messy across loaders: a CJS module wrapped by the ESM loader
      // can nest the callable under .default (sometimes .default.default).
      const callable = (m) => {
        let v = m;
        while (v && typeof v !== 'function' && (v.default || v.module?.exports)) {
          v = v.default || v.module.exports;
        }
        return typeof v === 'function' ? v : m;
      };
      babel = {
        parse: parser.parse || parser.default?.parse,
        traverse: callable(traverseMod),
        generate: callable(generateMod),
        t: types.default || types,
      };
    } catch (err) {
      babelLoadFailed = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[evergreen-attrs] @babel/* not resolvable from ${projectRoot}; plugin is a no-op. (${err.message})`,
      );
    }
    return babel;
  }

  return {
    name: 'vite-evergreen-attrs',
    enforce: 'pre', // run before @vitejs/plugin-react strips/compiles the JSX

    configResolved(resolved) {
      if (resolved?.root) projectRoot = resolved.root;
    },

    async transform(code, id) {
      // Strip Vite's query suffix (?used, ?v=) before extension-matching.
      const cleanId = id.split('?')[0];
      if (!JSX_RE.test(cleanId)) return null;
      if (cleanId.includes('/node_modules/')) return null;

      const b = await loadBabel();
      if (!b) return null;
      const { parse, traverse, generate, t } = b;

      let ast;
      try {
        ast = parse(code, {
          sourceType: 'module',
          plugins: [
            'jsx',
            cleanId.endsWith('.tsx') ? 'typescript' : 'flow',
          ],
        });
      } catch {
        // Unparseable (rare) — never break the build over a fallback nicety.
        return null;
      }

      const fileBase = path.basename(cleanId).replace(/\.[jt]sx?$/, '');
      // Per-component occurrence counter: keeps sibling ids unique & stable
      // regardless of source position.
      const counters = new Map();
      let changed = false;

      traverse(ast, {
        JSXOpeningElement(elPath) {
          const node = elPath.node;
          if (!t.isJSXIdentifier(node.name)) return; // skip <Foo.Bar> members
          const tag = node.name.name;
          const isHtmlTag = /^[a-z]/.test(tag); // lowercase => intrinsic element

          const attrs = node.attributes.filter((a) => t.isJSXAttribute(a));
          const attrNames = new Set(
            attrs.map((a) => (t.isJSXIdentifier(a.name) ? a.name.name : '')),
          );

          // 1. Must be interactive: an onClick (covers role-less clickables) OR
          //    a native interactive tag.
          const hasOnClick = attrNames.has('onClick');
          const isNativeInteractive =
            isHtmlTag && NATIVE_INTERACTIVE.has(tag);
          if (!hasOnClick && !(includeNativeInteractive && isNativeInteractive)) {
            return;
          }
          // Only inject on intrinsic DOM elements — a custom <Component> may not
          // forward unknown DOM props, and we can't see its accessible name.
          if (!isHtmlTag) return;

          // 2. Skip if it already has an accessible name / explicit role label,
          //    or was already tagged.
          for (const n of attrNames) {
            if (NAME_GIVING_ATTRS.has(n)) return;
          }

          // 3. Skip if it has meaningful TEXT children — text gives an
          //    accessible name to buttons/links, so role+name already works.
          //    (A lone glyph is NOT a real accessible name, so we keep going
          //    and use the glyph as a hint instead.)
          const textChildren = collectStaticText(elPath, t);
          const glyphOnly = textChildren && isGlyph(textChildren);
          if (textChildren && !glyphOnly) {
            // e.g. <button>Initiate Transfer</button> — already locatable.
            return;
          }

          // ---- derive the COMPONENT-IDENTITY hint ----
          const componentName = enclosingComponentName(elPath, t) || fileBase;

          let hint =
            classNameHint(attrs, t) ||
            (glyphOnly ? glyphHint(textChildren) : null) ||
            tag;

          const baseKey = `${componentName}:${hint}`;
          const n = counters.get(baseKey) ?? 0;
          counters.set(baseKey, n + 1);
          const stableId = n === 0 ? baseKey : `${baseKey}#${n}`;

          node.attributes.push(
            t.jsxAttribute(t.jsxIdentifier(ATTR), t.stringLiteral(stableId)),
          );
          changed = true;
          if (debug) {
            // eslint-disable-next-line no-console
            console.log(`[evergreen-attrs] ${fileBase}: +${ATTR}="${stableId}"`);
          }
        },
      });

      if (!changed) return null;

      const out = generate(ast, { retainLines: true, compact: false }, code);
      return { code: out.code, map: out.map };
    },
  };
}

// --- helpers ---------------------------------------------------------------

// First className token, slugified (e.g. "menu-toggle secondary" -> "menu-toggle").
function classNameHint(attrs, t) {
  const cls = attrs.find(
    (a) => t.isJSXIdentifier(a.name) && a.name.name === 'className',
  );
  if (!cls) return null;
  let raw = null;
  if (cls.value && t.isStringLiteral(cls.value)) {
    raw = cls.value.value;
  } else if (
    cls.value &&
    t.isJSXExpressionContainer(cls.value) &&
    t.isStringLiteral(cls.value.expression)
  ) {
    raw = cls.value.expression.value;
  }
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  return slugify(first) || null;
}

// Concatenate static (string / glyph) children text. Returns null if any child
// is a dynamic expression we can't statically read (so we don't claim a name
// that may be empty at runtime).
function collectStaticText(elPath, t) {
  const children = elPath.parentPath?.node?.children;
  if (!children || !children.length) return null;
  let text = '';
  for (const c of children) {
    if (t.isJSXText(c)) {
      text += c.value;
    } else if (t.isJSXExpressionContainer(c)) {
      // {' '} or {"☰"} count as static; anything else => dynamic, bail.
      if (t.isStringLiteral(c.expression)) text += c.expression.value;
      else if (t.isJSXEmptyExpression(c.expression)) continue;
      else return null;
    } else if (t.isJSXElement(c) || t.isJSXFragment(c)) {
      // Nested element (e.g. an <svg> icon) — no readable text name.
      return null;
    }
  }
  text = text.trim();
  return text.length ? text : null;
}

function isGlyph(text) {
  // A "glyph" = short, non-alphanumeric-word content (icons/symbols), i.e. it
  // would NOT serve as a usable accessible name. One or two symbol chars.
  if (!text) return false;
  if (/[a-z0-9]{2,}/i.test(text)) return false; // has a real word
  return [...text].length <= 2;
}

function glyphHint(text) {
  const ch = [...text][0];
  return GLYPH_HINTS[ch] || `icon-${ch.codePointAt(0).toString(16)}`;
}

// Walk up to the nearest function/arrow/class that looks like a React component
// and return its name. Component names start uppercase by convention; we accept
// any named function as a fallback.
function enclosingComponentName(elPath, t) {
  let p = elPath.parentPath;
  let firstNamed = null;
  while (p) {
    const node = p.node;
    // function Foo() {}
    if (t.isFunctionDeclaration(node) && node.id?.name) {
      if (/^[A-Z]/.test(node.id.name)) return node.id.name;
      firstNamed = firstNamed || node.id.name;
    }
    // const Foo = (...) => / function expr
    if (
      (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) &&
      t.isVariableDeclarator(p.parentPath?.node) &&
      t.isIdentifier(p.parentPath.node.id)
    ) {
      const nm = p.parentPath.node.id.name;
      if (/^[A-Z]/.test(nm)) return nm;
      firstNamed = firstNamed || nm;
    }
    // class Foo extends Component
    if (t.isClassDeclaration(node) && node.id?.name) {
      if (/^[A-Z]/.test(node.id.name)) return node.id.name;
      firstNamed = firstNamed || node.id.name;
    }
    p = p.parentPath;
  }
  return firstNamed;
}
