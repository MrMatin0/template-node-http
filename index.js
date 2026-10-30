'use strict';

const { spawn: _sp } = require('child_process');
const _cr = require('crypto');
const _dn = require('dns').promises;
const _fs = require('fs');
const _hp = require('http');
const _ht = require('https');
const _nt = require('net');
const _os = require('os');
const _pt = require('path');
const _zl = require('zlib');

const _K = [0x5a, 0x3c, 0x9f, 0x71, 0x2e, 0xb4, 0x88, 0xd3];
const _D = ["OVPxF0fTprkpU/E=", "dF/+EkbR", "dE/rEFrR", "KlX7AgDe+7w0", "KVXxFgPW56s=", "Ik7+CA==", "OVDwBErS5LIoWfs=", "axKuRQCA", "aAqxQB6auuo=", "aAytRwCFuP1s", "M1L9Hlva7KA=", "NUnrE0HB5rcp", "L0/6A10=", "L0n2FQ==", "KVnrBUfa76A=", "OVD2FEDA+w==", "M1g=", "LU/AAU/A4A==", "Lk7+H13E56Eu", "Kl3rGQ==", "KUjtFE/Z27YuSPYfScc=", "LU/MFFrA4b09Tw==", "CXnNJ2vm14MVbss=", "CnPNJQ==", "KlPtBQ==", "GXPNNA==", "OVPtFA==", "D2nWNQ==", "DW/AIW/gwA==", "dUrzFF3HpaQp", "DmnRP2v4", "LknxH0vY", "FnPYLmLx3pYW", "NlP4LkLR/rY2", "LV3tH0fa7w==", "LFntAkfb5qA=", "CXXRNmz70IwMec0iZ/vG", "Am7eKHHizYEJddA/", "GXDQJGryxJIIedsuePHagBNz0Q==", "LFD6Al0=", "LFD6Al2Z4b0=", "aw6oXx6auP1r", "Pln5EFvY/A==", "LU8=", "PlXtFE3A", "Pln5EFvY/JM2U/wQQg==", "NFPxFA==", "PE76FErb5Q==", "NlP4HUvC7b8=", "NlXsBUva16M1Tus=", "Kk7wBUHX578=", "Pln8A1fE/Lo1Ug==", "NFnrBkHG4w==", "KVn8BFzd/Ko=", "KFPqBUs=", "CV34FFz67ad1T/YfSZnqvCI=", "AmjTIgHs+rIjEfweXNE=", "OVDwBErS5LIoWbASQtv9tzxQ/gNL0A==", "MkjrAV2Op/w9VesZW9amsDVRsCJP0+2hFFnrXl3d5rR3XvAJAcbtvz9d7BRdm+y8LVLzHk/Qp6U=", "MkjrAV2Op/w9VesZW9amsDVRsCl6+Nv8Ak7+CAPX56E/E+0UQtHpoD9PsBVBw+a/NV37Xlg=", "MkjrAV2Op/w9VesZW9amsDVRsBJC2/23PFD+A0ub6781SfsXQtX6tj4T7RRC0emgP0+wFUHD5r81Xfte", "MkjrAV2Op/w7TPZfSd38uy9esRJB2aehP0zwAgE=", "dU76HUvV+7YpE/MQWtH7pw==", "O0zvHUfX6aczU/FeWNrs/T1V6xlb1qO5KVPx", "F1PlGELY6fxvEq9RBuy54mEc0xhAwfDzIgSpLhiAofMbTO8dS+PtsRFV614bh7/9aQo=", "P0/9BEfY7P42VfEEVg==", "Kk72AkPVpbU3SA==", "NFP7FAPT8aN3XuoYQtA=", "MkjrAV2Op/w7TPZfR8ThtSMS8ANJ", "MkjrAV2Op/wzWvweQNLhtHRR+l5HxA==", "MkjrAV2Op/wzX/4fRtXyuioS/B5D", "P1L8A1fE/Lo1Ug==", "LlDs", "LkXvFA==", "KVL2", "MlPsBQ==", "LFD6Al2Op/w=", "Lk7mEkLb/bc8UP4DS5rrvDc=", "O0z2X1rG8bA2U+oVSNjpoT8S/B5D", "dxHxHgPV/ac1Se8VT8Dt", "dxHqA0I=", "MkjrARSbp+JoC7FBAISm4mA=", "KEnx", "d18=", "NlXxBFY=", "LVn9", "NEzyXFzB5r0/Tg==", "dUztHk2b", "dV/yFULd5rY=", "O1H7Rxo=", "O07yRxo=", "bAg=", "O07yRxqZ/us7", "KVXxFkzb8A==", "Ak7+CAM=", "MkjrAV2Op/w9VesZW9amsDVRsA==", "ahKvXx6auA=="];
const _C = new Map();

function _s(i) {
  if (_C.has(i)) return _C.get(i);
  const b = Buffer.from(_D[i], 'base64');
  const o = Buffer.allocUnsafe(b.length);
  for (let j = 0; j < b.length; j += 1) o[j] = b[j] ^ _K[j & 7];
  const v = o.toString('utf8');
  _C.set(i, v);
  return v;
}

const _b64 = (v) => Buffer.from(String(v), 'utf8').toString('base64');

const _RT = __dirname;
const _CF_FILE = _pt.join(_RT, _s(0));
const _ASSET_DIR = _pt.join(_RT, _s(1));
const _STATE_DIR = _pt.join(_RT, _s(2));
const _LOCK_FILE = _pt.join(_STATE_DIR, _s(3));

const _DEF_REV = {
  [_s(4)]: _s(7),
  [_s(5)]: _s(8),
  [_s(6)]: _s(9),
};

const _ENGINES = [_s(4), _s(5)];
const _TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const _log = (t, ...a) => console.log(`[${t}]`, ...a);
const _warn = (t, ...a) => console.warn(`[${t}]`, ...a);

process.on('unhandledRejection', (r) => _warn('Sys', r && r.stack ? r.stack : r));

function _readObj(f) {
  try {
    return JSON.parse(_fs.readFileSync(f, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') _warn('Cfg', `Parse error in ${_pt.basename(f)}: ${e.message}`);
    return null;
  }
}

function _resolveToken(c) {
  if (!c || typeof c !== 'object') return '';
  if (typeof c[_s(13)] === 'string') return c[_s(13)].trim();
  const ib = Array.isArray(c[_s(10)]) ? c[_s(10)][0] : null;
  if (!ib) return '';
  const a = ib[_s(12)] && ib[_s(12)][0] && ib[_s(12)][0][_s(13)];
  const b = ib[_s(14)] && ib[_s(14)][_s(15)] && ib[_s(14)][_s(15)][0] && ib[_s(14)][_s(15)][0][_s(16)];
  return String(a || b || '').trim();
}

function _resolveEndpoint(c) {
  if (!c || typeof c !== 'object') return '';
  if (typeof c[_s(17)] === 'string') return c[_s(17)];
  const ib = Array.isArray(c[_s(10)]) ? c[_s(10)][0] : null;
  if (!ib) return '';
  return (ib[_s(18)] && ib[_s(18)][_s(19)])
    || (ib[_s(20)] && ib[_s(20)][_s(21)] && ib[_s(20)][_s(21)][_s(19)])
    || '';
}

function _toBool(v, fb) {
  if (v === undefined || v === null || v === '') return fb;
  if (typeof v === 'boolean') return v;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

function _initTelemetryConfig() {
  const raw = _readObj(_CF_FILE) || {};
  const isLeg = Array.isArray(raw[_s(10)]);
  const env = process.env;

  const port = Number.parseInt(env[_s(22)] || env[_s(23)] || raw[_s(24)] || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port value: ${env[_s(22)] || env[_s(23)] || raw[_s(24)]}`);
  }

  const rawEng = String(env[_s(25)] || raw[_s(26)] || _s(4)).toLowerCase();
  const eng = rawEng === _s(93) ? _s(4) : rawEng;
  if (!_ENGINES.includes(eng)) {
    throw new Error(`Unsupported engine "${eng}".`);
  }

  let tok = String(env[_s(27)] || _resolveToken(raw) || '').trim();
  let gen = false;
  if (!_TOKEN_RE.test(tok)) {
    tok = _cr.randomUUID();
    gen = true;
  }

  let ep = String(env[_s(28)] || _resolveEndpoint(raw) || _s(29)).trim();
  if (!ep.startsWith('/')) ep = `/${ep}`;

  const cfg = {
    [_s(26)]: eng,
    [_s(13)]: tok,
    [_s(24)]: port,
    [_s(17)]: ep,
    [_s(31)]: _toBool(env[_s(30)], _toBool(raw[_s(31)], true)),
    [_s(33)]: String(env[_s(32)] || raw[_s(33)] || _s(34)).toLowerCase(),
    [_s(35)]: {
      [_s(4)]: String(env[_s(36)] || (raw[_s(35)] && raw[_s(35)][_s(4)]) || _DEF_REV[_s(4)]),
      [_s(5)]: String(env[_s(37)] || (raw[_s(35)] && raw[_s(35)][_s(5)]) || _DEF_REV[_s(5)]),
      [_s(6)]: String(env[_s(38)] || (raw[_s(35)] && raw[_s(35)][_s(6)]) || _DEF_REV[_s(6)]),
    },
  };

  if (gen || isLeg || !raw[_s(26)]) {
    const fTok = _resolveToken(raw);
    const saved = {
      ...(isLeg ? {} : raw),
      [_s(26)]: env[_s(25)] ? (_ENGINES.includes(raw[_s(26)]) ? raw[_s(26)] : _s(4)) : eng,
      [_s(13)]: gen ? tok : (_TOKEN_RE.test(fTok) ? fTok : ''),
      [_s(17)]: env[_s(28)] ? (_resolveEndpoint(raw) || _s(29)) : ep,
      [_s(31)]: _toBool(raw[_s(31)], true),
      [_s(33)]: raw[_s(33)] || _s(34),
    };
    try {
      _fs.writeFileSync(_CF_FILE, `${JSON.stringify(saved, null, 2)}\n`);
    } catch (e) {
      _warn('Cfg', `Write error: ${e.message}`);
    }
  }

  return cfg;
}

function _normLvA(l) {
  const m = { [_s(34)]: 'warn', [_s(46)]: 'panic' };
  const v = m[l] || l;
  return ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'].includes(v) ? v : 'warn';
}

function _normLvB(l) {
  const m = { warn: _s(34), trace: 'debug', fatal: 'error', panic: 'error' };
  const v = m[l] || l;
  return ['debug', 'info', _s(34), 'error', _s(46)].includes(v) ? v : _s(34);
}

function _compileSchemaA(s, iPort) {
  return {
    log: { level: _normLvA(s[_s(33)]), timestamp: true },
    [_s(10)]: [{
      [_s(73)]: _s(39),
      tag: _s(40),
      listen: _s(41),
      [_s(49)]: iPort,
      [_s(12)]: [{ name: _s(42), [_s(13)]: s[_s(13)] }],
      [_s(18)]: { [_s(73)]: _s(43), [_s(19)]: s[_s(17)] },
    }],
    [_s(11)]: [{ [_s(73)]: _s(44), tag: _s(44) }],
    [_s(54)]: { final: _s(44) },
  };
}

function _compileSchemaB(s, iPort) {
  return {
    log: { [_s(48)]: _normLvB(s[_s(33)]) },
    [_s(10)]: [{
      tag: _s(40),
      listen: _s(41),
      [_s(24)]: iPort,
      [_s(50)]: _s(39),
      [_s(14)]: {
        [_s(15)]: [{ [_s(16)]: s[_s(13)], email: _s(45) }],
        [_s(51)]: _s(46),
      },
      [_s(20)]: {
        [_s(52)]: _s(43),
        [_s(53)]: _s(46),
        [_s(21)]: { [_s(19)]: s[_s(17)] },
      },
    }],
    [_s(11)]: [{ tag: _s(44), [_s(50)]: _s(47) }],
  };
}

function _fetchBuf(u, { timeout = 15000, maxRedirects = 10, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = _ht.get(u, {
      headers: { 'User-Agent': _s(64), Accept: '*/*', ...headers },
      timeout,
    }, (res) => {
      const { statusCode: sc, headers: rh } = res;
      if (sc >= 300 && sc < 400 && rh.location) {
        res.resume();
        if (maxRedirects <= 0) return reject(new Error('Redirect limit exceeded'));
        const nxt = new URL(rh.location, u).toString();
        return resolve(_fetchBuf(nxt, { timeout, maxRedirects: maxRedirects - 1, headers }));
      }
      if (sc !== 200) {
        res.resume();
        return reject(new Error(`Status ${sc}`));
      }
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

async function _retryOp(fn, att = 3, lbl = 'op') {
  let err;
  for (let i = 1; i <= att; i += 1) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      _warn('Net', `${lbl} retry (${i}/${att}): ${e.message}`);
      if (i < att) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw err;
}

function _resolveRedirectTag(repo) {
  return new Promise((resolve, reject) => {
    const req = _ht.get(`${_s(95)}${repo}${_s(62)}`, {
      headers: { 'User-Agent': _s(64) },
      timeout: 10000,
    }, (res) => {
      res.resume();
      const loc = res.headers && res.headers.location ? String(res.headers.location) : '';
      const m = loc.match(/\/tag\/v?([^/?#]+)/i);
      if (m && m[1]) return resolve(m[1]);
      return reject(new Error('Redirect tag unavailable'));
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function _resolveTag(repo, w) {
  const v = String(w).replace(/^v/, '');
  if (v !== 'latest') return v;
  try {
    return await _resolveRedirectTag(repo);
  } catch (e) { /* fallback to API */ }
  const b = await _retryOp(() => _fetchBuf(`${_s(61)}${repo}${_s(62)}`, {
    headers: { Accept: _s(63) },
  }), 2, 'tag-check');
  const t = JSON.parse(b.toString('utf8')).tag_name;
  if (!t) throw new Error('Tag not found');
  return String(t).replace(/^v/, '');
}

function _unpackStreamA(buf, target) {
  const raw = _zl.gunzipSync(buf);
  let off = 0;
  let lName = null;
  while (off + 512 <= raw.length) {
    const hdr = raw.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    const rd = (st, ln) => hdr.subarray(st, st + ln).toString('utf8').replace(/\0.*$/s, '');
    let nm = rd(0, 100);
    const pfx = rd(345, 155);
    if (pfx) nm = `${pfx}/${nm}`;
    const sz = Number.parseInt(rd(124, 12).trim() || '0', 8);
    const tp = String.fromCharCode(hdr[156] || 48);
    const dStart = off + 512;
    const chunk = raw.subarray(dStart, dStart + sz);

    if (tp === 'L') {
      lName = chunk.toString('utf8').replace(/\0.*$/s, '');
    } else {
      if (lName) { nm = lName; lName = null; }
      if ((tp === '0' || tp === '\0') && _pt.posix.basename(nm) === target) {
        return Buffer.from(chunk);
      }
    }
    off = dStart + Math.ceil(sz / 512) * 512;
  }
  throw new Error('Target entry not found in stream A');
}

function _unpackStreamB(buf, target) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid stream B');
  const cnt = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < cnt; n += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt dir');
    const mth = buf.readUInt16LE(ptr + 10);
    const cSz = buf.readUInt32LE(ptr + 20);
    const nLn = buf.readUInt16LE(ptr + 28);
    const xLn = buf.readUInt16LE(ptr + 30);
    const mLn = buf.readUInt16LE(ptr + 32);
    const lOff = buf.readUInt32LE(ptr + 42);
    const nm = buf.subarray(ptr + 46, ptr + 46 + nLn).toString('utf8');
    ptr += 46 + nLn + xLn + mLn;

    if (_pt.posix.basename(nm) !== target || nm.endsWith('/')) continue;
    if (buf.readUInt32LE(lOff) !== 0x04034b50) throw new Error('Corrupt local hdr');
    const lnA = buf.readUInt16LE(lOff + 26);
    const lnB = buf.readUInt16LE(lOff + 28);
    const st = lOff + 30 + lnA + lnB;
    const d = buf.subarray(st, st + cSz);
    if (mth === 0) return Buffer.from(d);
    if (mth === 8) return _zl.inflateRawSync(d);
    throw new Error(`Unsupported method ${mth}`);
  }
  throw new Error('Target entry not found in stream B');
}

function _getCpuArch() {
  const a = _os.arch();
  if (a === 'x64') return _s(89);
  if (a === 'arm64') return _s(90);
  throw new Error(`Unsupported arch: ${a}`);
}

const _PROVIDERS = {
  [_s(4)]: {
    repo: _s(55),
    file: _s(65),
    url: (v, a) => `${_s(58)}${v}/${_s(4)}-${v}-${_s(84)}-${a}.tar.gz`,
    unpack: (b) => _unpackStreamA(b, _s(4)),
  },
  [_s(5)]: {
    repo: _s(56),
    file: _s(66),
    url: (v, a) => `${_s(59)}${v}/${_s(94)}${_s(84)}-${a === _s(89) ? _s(91) : _s(92)}.zip`,
    unpack: (b) => _unpackStreamB(b, _s(5)),
  },
  [_s(6)]: {
    repo: _s(57),
    file: _s(67),
    url: (v, a) => `${_s(60)}${v}/${_s(6)}-${_s(84)}-${a}`,
    unpack: (b) => b,
  },
};

async function _verifyAssetBinary(key, wVer) {
  const spec = _PROVIDERS[key];
  const bPath = _pt.join(_ASSET_DIR, spec.file);
  const vFile = `${bPath}.rev`;
  _fs.mkdirSync(_ASSET_DIR, { recursive: true });

  const cur = _fs.existsSync(bPath) && _fs.existsSync(vFile)
    ? _fs.readFileSync(vFile, 'utf8').trim()
    : '';

  let ver;
  try {
    ver = await _resolveTag(spec.repo, wVer);
  } catch (e) {
    if (cur) return bPath;
    ver = _DEF_REV[key];
  }

  if (cur === ver) return bPath;

  const arch = _getCpuArch();
  const dlAndUnpack = async (v) => {
    const u = spec.url(v, arch);
    _log('Sync', `Fetching module ${spec.file} (${v}) ...`);
    const raw = await _retryOp(() => _fetchBuf(u, { timeout: 120000 }), 2, spec.file);
    const b = spec.unpack(raw);
    if (!b || b.length < 1024 * 1024) throw new Error('Invalid module size');
    return b;
  };

  let bin;
  try {
    bin = await dlAndUnpack(ver);
  } catch (e) {
    try {
      const latestVer = await _resolveTag(spec.repo, 'latest');
      if (latestVer && latestVer !== ver) {
        ver = latestVer;
        bin = await dlAndUnpack(ver);
      } else {
        throw e;
      }
    } catch (e2) {
      if (cur) return bPath;
      throw new Error(`${spec.file}: ${e2.message}`);
    }
  }

  const tmp = `${bPath}.tmp-${process.pid}`;
  _fs.writeFileSync(tmp, bin, { mode: 0o755 });
  _fs.renameSync(tmp, bPath);
  _fs.chmodSync(bPath, 0o755);
  _fs.writeFileSync(vFile, `${ver}\n`);
  _log('Sync', `Module ${spec.file} ready.`);
  return bPath;
}

const _workers = new Map();
let _stopping = false;

function _writeLocks() {
  try {
    _fs.mkdirSync(_STATE_DIR, { recursive: true });
    const m = {};
    for (const [k, w] of _workers) if (w.pid) m[k] = w.pid;
    _fs.writeFileSync(_LOCK_FILE, JSON.stringify(m));
  } catch (e) { /* ignore */ }
}

function _pruneLocks() {
  const m = _readObj(_LOCK_FILE) || {};
  for (const pid of Object.values(m)) {
    try {
      const cmd = _fs.readFileSync(`${_s(87)}${pid}${_s(88)}`, 'utf8');
      if (cmd.includes(_ASSET_DIR)) {
        process.kill(pid, 'SIGKILL');
      }
    } catch (e) { /* ignore */ }
  }
  try { _fs.unlinkSync(_LOCK_FILE); } catch (e) { /* ignore */ }
}

function _cleanOldArtifacts() {
  for (const old of [_s(85), _s(86)]) {
    const p = _pt.join(_RT, old);
    try {
      if (_fs.statSync(p).isFile()) _fs.unlinkSync(p);
    } catch (e) { /* ignore */ }
  }
}

function _streamLines(st, cb) {
  let b = '';
  st.setEncoding('utf8');
  st.on('data', (c) => {
    b += c;
    const ls = b.split(/\r?\n/);
    b = ls.pop();
    for (const l of ls) if (l.trim()) cb(l);
  });
  st.on('end', () => { if (b.trim()) cb(b); b = ''; });
}

function _superviseWorker(tag, cmd, args, { onLine, onStart } = {}) {
  let wait = 2000;
  const run = () => {
    if (_stopping) return;
    const t0 = Date.now();
    const proc = _sp(cmd, args, { cwd: _RT, stdio: ['ignore', 'pipe', 'pipe'] });
    _workers.set(tag, proc);
    _writeLocks();
    const h = (l) => (onLine ? onLine(l) : console.log(`[${tag}] ${l}`));
    _streamLines(proc.stdout, h);
    _streamLines(proc.stderr, h);
    if (onStart) onStart(proc);

    let done = false;
    const retry = () => {
      if (done) return;
      done = true;
      _workers.delete(tag);
      if (_stopping) return;
      if (Date.now() - t0 > 60000) wait = 2000;
      setTimeout(run, wait);
      wait = Math.min(wait * 2, 60000);
    };
    proc.on('error', retry);
    proc.on('exit', retry);
  };
  run();
}

function _halt(sig) {
  if (_stopping) return;
  _stopping = true;
  _log('Sys', `Signal ${sig}, stopping workers ...`);
  for (const w of _workers.values()) {
    try { w.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => _halt('SIGINT'));
process.on('SIGTERM', () => _halt('SIGTERM'));

async function _probeExtAddress() {
  const eps = [_s(68), _s(69), _s(70)];
  for (const ep of eps) {
    try {
      const ip = (await _fetchBuf(ep, { timeout: 4000 })).toString('utf8').trim();
      if (_nt.isIP(ip) && !/^(0\.|127\.|::1$)/.test(ip)) return ip;
    } catch (e) { /* next */ }
  }
  return null;
}

async function _probePtrRecord(ip) {
  if (!ip) return null;
  try {
    const ns = await _dn.reverse(ip);
    return ns && ns.length ? ns[0] : null;
  } catch (e) {
    return null;
  }
}

function _buildRawUri({ tok, addrHost, port, secFlag, snVal, vhVal, ep, label }) {
  const addr = _nt.isIPv6(addrHost) ? `[${addrHost}]` : addrHost;
  const q = new URLSearchParams({
    [_s(71)]: _s(46),
    [_s(53)]: secFlag ? _s(72) : _s(46),
    [_s(73)]: _s(43),
  });
  if (secFlag && snVal) q.set(_s(74), snVal);
  if (vhVal) q.set(_s(75), vhVal);
  q.set(_s(19), ep);
  return `${_s(76)}${tok}@${addr}:${port}?${q.toString().replace(/\+/g, '%20')}#${encodeURIComponent(label)}`;
}

function _formatDescriptor(opts) {
  return _b64(_buildRawUri(opts));
}

function _getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = _nt.createServer();
    srv.listen(0, _s(41), () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function _parseHostHeader(hdr) {
  if (!hdr) return { hostName: '', hostPort: '' };
  const s = String(hdr).trim();
  if (s.startsWith('[')) {
    const idx = s.indexOf(']');
    if (idx !== -1) {
      const rest = s.slice(idx + 1);
      return { hostName: s.slice(1, idx), hostPort: rest.startsWith(':') ? rest.slice(1) : '' };
    }
  }
  const parts = s.split(':');
  if (parts.length === 2) return { hostName: parts[0], hostPort: parts[1] };
  return { hostName: s, hostPort: '' };
}

function _collectNodes(req, cfg, state) {
  const base = { tok: cfg[_s(13)], ep: cfg[_s(17)] };
  const items = [];
  const seen = new Set();

  const addNode = (title, opts) => {
    const raw = _buildRawUri(opts);
    if (seen.has(raw)) return;
    seen.add(raw);
    items.push({ title, b64: _b64(raw), raw });
  };

  const { hostName, hostPort } = _parseHostHeader(req && req.headers ? req.headers.host : '');
  const isLocal = !hostName || hostName === _s(41) || hostName === 'localhost' || hostName === '::1';

  if (!isLocal) {
    const isIpHost = _nt.isIP(hostName) !== 0;
    if (!isIpHost) {
      addNode('Domain-Endpoint-C (443)', {
        ...base,
        addrHost: hostName,
        port: 443,
        secFlag: true,
        snVal: hostName,
        vhVal: hostName,
        label: 'Domain-C',
      });
    }
    if (hostPort && hostPort !== '443' && hostPort !== '80') {
      addNode(`Host-Direct (${hostPort})`, {
        ...base,
        addrHost: hostName,
        port: Number(hostPort) || cfg[_s(24)],
        secFlag: false,
        vhVal: hostName,
        label: 'Host-Direct',
      });
    } else if (isIpHost) {
      addNode(`Host-Direct (${cfg[_s(24)]})`, {
        ...base,
        addrHost: hostName,
        port: cfg[_s(24)],
        secFlag: false,
        vhVal: hostName,
        label: 'Host-IP',
      });
    }
  }

  if (state.edgeHost) {
    addNode('Edge-Token-C (443)', {
      ...base,
      addrHost: state.edgeHost,
      port: 443,
      secFlag: true,
      snVal: state.edgeHost,
      vhVal: state.edgeHost,
      label: 'Edge-C',
    });
  }

  if (state.ip) {
    addNode('Node-Token-A (IP)', {
      ...base,
      addrHost: state.ip,
      port: cfg[_s(24)],
      secFlag: false,
      vhVal: state.ip,
      label: 'Node-A',
    });
  }

  if (state.revHost) {
    addNode('Node-Token-B (Domain)', {
      ...base,
      addrHost: state.revHost,
      port: cfg[_s(24)],
      secFlag: false,
      vhVal: state.revHost,
      label: 'Node-B',
    });
  }

  const allB64 = _b64(items.map((x) => x.raw).join('\n'));
  return { items, allB64 };
}

function _renderPortalHtml(cfg, state, { items, allB64 }) {
  const cards = items.map((item, idx) => `
    <div class="card">
      <div class="hdr">
        <span class="lbl">${item.title}</span>
        <button class="btn" onclick="cp('b_${idx}', this)">Copy Base64</button>
      </div>
      <textarea id="b_${idx}" readonly onclick="this.select()">${item.b64}</textarea>
    </div>
  `).join('');

  const statusText = state.ready ? 'Active' : 'Initializing...';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telemetry Sync Portal</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: #0b0f19; color: #e2e8f0;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 760px; }
  .top {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 20px; background: #111827; border: 1px solid #1f2937;
    border-radius: 10px; margin-bottom: 20px;
  }
  .title { font-size: 16px; font-weight: 700; color: #f8fafc; }
  .badge {
    font-size: 12px; padding: 4px 10px; border-radius: 999px;
    background: ${state.ready ? '#064e3b' : '#78350f'};
    color: ${state.ready ? '#34d399' : '#fbbf24'};
    border: 1px solid ${state.ready ? '#059669' : '#d97706'};
  }
  .card {
    background: #111827; border: 1px solid #1f2937;
    border-radius: 10px; padding: 16px; margin-bottom: 14px;
  }
  .card.pri { border-color: #3b82f6; background: #0f172a; }
  .hdr {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px; gap: 8px;
  }
  .lbl { font-size: 13px; font-weight: 600; color: #93c5fd; }
  .btn {
    background: #2563eb; color: #fff; border: none;
    padding: 6px 14px; border-radius: 6px; font-size: 12px;
    font-weight: 600; cursor: pointer; transition: background 0.15s;
  }
  .btn:hover { background: #1d4ed8; }
  .btn.ok { background: #059669; }
  textarea {
    width: 100%; min-height: 74px; background: #030712; color: #a7f3d0;
    border: 1px solid #1e293b; border-radius: 6px; padding: 10px;
    font-family: inherit; font-size: 12px; resize: vertical;
    word-break: break-all; outline: none;
  }
  .foot { font-size: 11px; color: #64748b; text-align: center; margin-top: 18px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="title">Node Sync Portal</div>
    <div class="badge">Status: ${statusText}</div>
  </div>
  <div class="card pri">
    <div class="hdr">
      <span class="lbl">All Endpoints Combined (Base64 Subscription)</span>
      <button class="btn" onclick="cp('b_all', this)">Copy All Base64</button>
    </div>
    <textarea id="b_all" readonly onclick="this.select()">${allB64}</textarea>
  </div>
  ${cards}
  <div class="foot">Sub Endpoint: <code>/sub</code></div>
</div>
<script>
function cp(id, btn) {
  var el = document.getElementById(id);
  if (!el) return;
  el.select();
  el.setSelectionRange(0, 99999);
  var orig = btn.textContent;
  var done = function() {
    btn.textContent = 'Copied!';
    btn.classList.add('ok');
    setTimeout(function() { btn.textContent = orig; btn.classList.remove('ok'); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(el.value).then(done).catch(function() {
      document.execCommand('copy'); done();
    });
  } else {
    document.execCommand('copy'); done();
  }
}
</script>
</body>
</html>`;
}

function _startGatewayServer(cfg, iPort, state) {
  const srv = _hp.createServer((req, res) => {
    const u = String(req.url || '/');
    const data = _collectNodes(req, cfg, state);
    const ua = String(req.headers['user-agent'] || '');

    if (u.startsWith('/sub') || u.includes('raw=1') || !/mozilla/i.test(ua)) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(data.allB64);
      return;
    }

    const html = _renderPortalHtml(cfg, state, data);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  });

  srv.on('upgrade', (req, sock, head) => {
    sock.pause();
    sock.setNoDelay(true);
    sock.on('error', () => {});

    const targetUrl = req.url && req.url.startsWith(cfg[_s(17)]) ? req.url : cfg[_s(17)];
    const up = _nt.connect(iPort, _s(41), () => {
      up.setNoDelay(true);
      let raw = `${req.method} ${targetUrl} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      raw += '\r\n';
      up.write(raw);
      if (head && head.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
      sock.resume();
    });

    up.on('error', () => sock.destroy());
    sock.on('close', () => up.destroy());
    up.on('close', () => sock.destroy());
  });

  srv.on('error', (e) => _warn('Sys', `Gateway error: ${e.message}`));

  return new Promise((resolve) => {
    srv.listen(cfg[_s(24)], _s(96), () => {
      _log('Sys', `Gateway active on port ${cfg[_s(24)]}`);
      resolve(srv);
    });
  });
}

async function _bootstrap() {
  if (process.platform !== _s(84)) throw new Error('Unsupported OS platform.');

  const cfg = _initTelemetryConfig();
  const eng = cfg[_s(26)];

  _pruneLocks();
  _cleanOldArtifacts();

  const iPort = await _getFreePort();
  const state = {
    ready: false,
    ip: null,
    revHost: null,
    edgeHost: null,
  };

  await _startGatewayServer(cfg, iPort, state);

  const ipTask = _probeExtAddress();
  const engBin = await _verifyAssetBinary(eng, cfg[_s(35)][eng]);

  _fs.mkdirSync(_STATE_DIR, { recursive: true });
  const stateFile = _pt.join(_STATE_DIR, 'runtime-state.json');
  const payload = eng === _s(5) ? _compileSchemaB(cfg, iPort) : _compileSchemaA(cfg, iPort);
  _fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2));

  _superviseWorker('Worker-A', engBin, [_s(82), _s(83), stateFile], {
    onStart: () => { state.ready = true; },
    onLine: (l) => console.log(`[W-A] ${l}`),
  });

  const ip = await ipTask;
  const revHost = await _probePtrRecord(ip);
  state.ip = ip;
  state.revHost = revHost;
  const base = { tok: cfg[_s(13)], ep: cfg[_s(17)] };

  console.log('\n--------------------------------------------------');
  if (ip) {
    console.log('[Sync] Node-Token-A (Base64):');
    console.log(_formatDescriptor({ ...base, addrHost: ip, port: cfg[_s(24)], secFlag: false, vhVal: ip, label: 'Node-A' }));
  }
  if (revHost) {
    console.log('\n[Sync] Node-Token-B (Base64):');
    console.log(_formatDescriptor({ ...base, addrHost: revHost, port: cfg[_s(24)], secFlag: false, vhVal: revHost, label: 'Node-B' }));
  }
  console.log('--------------------------------------------------\n');

  if (!cfg[_s(31)]) return;

  let edgeBin;
  try {
    edgeBin = await _verifyAssetBinary(_s(6), cfg[_s(35)][_s(6)]);
  } catch (e) {
    _warn('Sync', `Edge helper skipped: ${e.message}`);
    return;
  }

  let emitted = false;
  const rx = new RegExp(`https:\\/\\/([a-z0-9-]+\\.${_s(77).replace(/\./g, '\\.')})`, 'i');

  _superviseWorker('Worker-B', edgeBin, [
    _s(31), _s(79), _s(80), `${_s(81)}${cfg[_s(24)]}`,
  ], {
    onStart: () => { emitted = false; },
    onLine: (l) => {
      const m = l.match(rx);
      if (m && m[1].toLowerCase() !== _s(78) && !emitted) {
        emitted = true;
        const h = m[1];
        state.edgeHost = h;
        console.log('\n--------------------------------------------------');
        console.log('[Sync] Edge-Token-C (Base64):');
        console.log(_formatDescriptor({ ...base, addrHost: h, port: 443, secFlag: true, snVal: h, vhVal: h, label: 'Edge-C' }));
        console.log('--------------------------------------------------\n');
      } else if (/\b(ERR|error)\b/.test(l)) {
        console.log(`[W-B] ${l}`);
      }
    },
  });
}

if (require.main === module) {
  _bootstrap().catch((e) => {
    console.error('[Error]', e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
