// Test helper (NIGHT-SKY-01 / CLOUD-FLUFF-01 probes): evaluates WGSL fns that use vec3f ARITHMETIC (which wgslProbe.js' regex
// subset cannot). A tiny recursive-descent translator: WGSL fn body -> JS where every operator goes through polymorphic helpers
// (numbers or {x,y,z} vectors, f64 maths). Supports let/var/assignment (also compound), if/else, return, calls, swizzles,
// array ctor + index, bitcast/i32/u32/f32 casts. u32 multiply is detected as "both integer and |result| >= 2^31" -> imul.
// Not a general WGSL interpreter: unknown constructs throw. Intended for straight-line pure fns.
import { fnBody } from './wgslProbe.js';

const isV = (a) => typeof a === 'object';
function zip(a, b, f) {
  if (!isV(a) && !isV(b)) return f(a, b);
  const o = {}; const t = isV(a) ? a : b;
  for (const k of ['x', 'y', 'z', 'w']) if (k in t) o[k] = f(isV(a) ? a[k] : a, isV(b) ? b[k] : b);
  return o;
}
const H = {
  add: (a, b) => zip(a, b, (p, q) => p + q),
  sub: (a, b) => zip(a, b, (p, q) => p - q),
  mul: (a, b) => zip(a, b, (p, q) => { const r = p * q; return Number.isInteger(p) && Number.isInteger(q) && Math.abs(r) >= 2147483648 ? Math.imul(p, q) >>> 0 : r; }),
  div: (a, b) => zip(a, b, (p, q) => p / q),
  neg: (a) => (isV(a) ? zip(a, 0, (p) => -p) : -a),
  xor: (a, b) => (a ^ b) >>> 0, band: (a, b) => a & b, bor: (a, b) => a | b,
  shr: (a, b) => a >>> b, shl: (a, b) => (a << b) >>> 0,
  sw: (v, n) => (n.length === 1 ? v[n] : n === 'xy' ? { x: v.x, y: v.y } : n === 'xyz' ? { x: v.x, y: v.y, z: v.z } : (() => { throw new Error('swizzle ' + n); })()),
  vec3f: (x, y, z) => (y === undefined ? { x, y: x, z: x } : { x, y, z }),
  vec2f: (x, y) => ({ x, y }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  select: (f, t, c) => (c ? t : f),
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, sin: Math.sin, cos: Math.cos, atan2: Math.atan2,
  radians: (d) => d * Math.PI / 180, degrees: (r) => r * 180 / Math.PI,
  i32: (x) => Math.trunc(x) | 0, u32: (x) => Math.trunc(x) >>> 0, f32: (x) => x,
  bcU32: (x) => x >>> 0,
};

const TOK = /\s+|\/\/[^\n]*|(0x[0-9a-fA-F]+u?|\d+\.?\d*(?:e[-+]?\d+)?[uf]?|[A-Za-z_]\w*|>>=|<<=|\|\||&&|==|!=|<=|>=|>>|<<|\^=|\+=|-=|\*=|\/=|[-+*/%<>=!&|^~(){}\[\];,.:])/gy;
function lex(src) {
  const out = []; TOK.lastIndex = 0; let m;
  while (TOK.lastIndex < src.length) {
    const at = TOK.lastIndex; m = TOK.exec(src);
    if (!m) throw new Error('lex @' + at + ': ' + src.slice(at, at + 20));
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}
const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/']];
const FN = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '^': 'xor', '&': 'band', '|': 'bor', '>>': 'shr', '<<': 'shl' };
const WG_BUILTIN = new Set(Object.keys(H));

function translate(tokens) {
  let p = 0;
  const peek = () => tokens[p], eat = (t) => { if (tokens[p] !== t) throw new Error(`expected ${t} got ${tokens[p]} @${p}`); return tokens[p++]; };
  function primary() {
    const t = tokens[p++];
    if (t === '(') { const e = expr(); eat(')'); return `(${e})`; }
    if (t === '-') return `H.neg(${unary()})`;
    if (t === '!') return `(!${unary()})`;
    if (/^\d|^0x/.test(t)) return /^0x/.test(t) ? String(parseInt(t.replace(/u$/, ''), 16)) : String(parseFloat(t));
    if (t === 'bitcast') { eat('<'); p++; eat('>'); return `H.bcU32${args()}`; }
    if (t === 'array') { eat('<'); while (peek() !== '>') p++; eat('>'); return `[${args(true)}]`; }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') return `${WG_BUILTIN.has(t) ? 'H.' + (t === 'vec3f' || t === 'vec2f' ? t : t) : 'E.' + t}${args()}`;
      return t;
    }
    throw new Error('primary ' + t);
  }
  function args(bare) { eat('('); const a = []; while (peek() !== ')') { a.push(expr()); if (peek() === ',') p++; } eat(')'); return bare ? a.join(',') : `(${a.join(',')})`; }
  function postfix() {
    let e = primary();
    for (;;) {
      if (peek() === '.') { p++; const n = tokens[p++]; e = /^[xyzw]+$/.test(n) && !/^(x|y|z|w)$/.test(n) ? `H.sw(${e},'${n}')` : `${e}.${n}`; }
      else if (peek() === '[') { p++; const i = expr(); eat(']'); e = `${e}[${i}]`; }
      else return e;
    }
  }
  function unary() { return postfix(); }
  function bin(level) {
    if (level === BIN.length) return unary();
    let l = bin(level + 1);
    while (BIN[level].includes(peek())) {
      const op = tokens[p++]; const r = bin(level + 1);
      l = FN[op] ? `H.${FN[op]}(${l},${r})` : `(${l} ${op === '==' ? '===' : op === '!=' ? '!==' : op} ${r})`;
    }
    return l;
  }
  function expr() { return bin(0); }
  function block() { eat('{'); let s = ''; while (peek() !== '}') s += stmt(); eat('}'); return s; }
  function stmt() {
    const t = peek();
    if (t === 'let' || t === 'var') {
      p++; const name = tokens[p++];
      if (peek() === ':') { p++; while (peek() !== '=' && peek() !== ';') p++; }
      let init = '{}';
      if (peek() === '=') { p++; init = expr(); }
      eat(';'); return `let ${name} = ${init};\n`;
    }
    if (t === 'if') { p++; eat('('); const c = expr(); eat(')'); let s = `if (${c}) {${block()}}`; if (peek() === 'else') { p++; s += ' else ' + (peek() === 'if' ? stmt() : `{${block()}}`); } return s + '\n'; }
    if (t === 'return') { p++; const e = expr(); eat(';'); return `return ${e};\n`; }
    // assignment: lvalue [op]= expr
    let lv = tokens[p++]; while (peek() === '.' || peek() === '[') { if (peek() === '.') { p++; lv += '.' + tokens[p++]; } else { p++; lv += `[${expr()}]`; eat(']'); } }
    const op = tokens[p++]; const e = expr(); eat(';');
    if (op === '=') return `${lv} = ${e};\n`;
    return `${lv} = H.${FN[op.slice(0, -1)]}(${lv},${e});\n`;
  }
  let s = ''; while (p < tokens.length) s += stmt();
  return s;
}

/** Compile `fn name(...)` of `src`. `env` = other WGSL fns / uniforms (e.g. `{ su, skyGlowSm }`), referenced as E.name / bare names. */
export function compileVecFn(src, name, env = {}) {
  const { params, body } = fnBody(src, name);
  const js = translate(lex(body));
  const names = Object.keys(env);
  const bareNames = ['H', 'E', ...names];
  const f = new Function(...bareNames, `return function(${params.join(',')}){${js}};`);
  return f(H, env, ...names.map((n) => env[n]));
}
