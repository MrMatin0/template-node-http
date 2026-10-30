'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = __dirname;
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const STATE_DIR = path.join(ROOT_DIR, '.state');
const LOCK_FILE = path.join(STATE_DIR, 'pids.json');

const DEFAULT_VERSIONS = {
  'sing-box': '1.14.4',
  'xray': '26.10.29',
  'cloudflared': '2026.10.6',
};

const SUPPORTED_ENGINES = ['sing-box', 'xray'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const log = (tag, ...args) => console.log(`[${tag}]`, ...args);
const warn = (tag, ...args) => console.warn(`[${tag}]`, ...args);
const toBase64 = (val) => Buffer.from(String(val), 'utf8').toString('base64');

process.on('unhandledRejection', (err) => warn('Sys', err && err.stack ? err.stack : err));

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') warn('Cfg', `Parse error in ${path.basename(filePath)}: ${e.message}`);
    return null;
  }
}

function generateDeterministicUuid() {
  const seed = process.env.VELIXIR_APP_ID
    || process.env.APP_ID
    || process.env.RENDER_SERVICE_ID
    || process.env.RAILWAY_SERVICE_ID
    || `${os.userInfo().username}@${ROOT_DIR}:velixir-vless-node`;
  const hash = crypto.createHash('sha256').update(seed).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function resolveToken(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (typeof cfg.uuid === 'string') return cfg.uuid.trim();
  const ib = Array.isArray(cfg.inbounds) ? cfg.inbounds[0] : null;
  if (!ib) return '';
  const a = ib.users && ib.users[0] && ib.users[0].uuid;
  const b = ib.settings && ib.settings.clients && ib.settings.clients[0] && ib.settings.clients[0].id;
  return String(a || b || '').trim();
}

function resolveEndpoint(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (typeof cfg.ws_path === 'string') return cfg.ws_path;
  const ib = Array.isArray(cfg.inbounds) ? cfg.inbounds[0] : null;
  if (!ib) return '';
  return (ib.transport && ib.transport.path)
    || (ib.streamSettings && ib.streamSettings.wsSettings && ib.streamSettings.wsSettings.path)
    || '';
}

function toBool(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  return !/^(0|false|no|off)$/i.test(String(val).trim());
}

function initConfig() {
  const raw = readJsonSafe(CONFIG_FILE) || {};
  const env = process.env;

  // Velixir injects PORT=8080 by default
  const port = Number.parseInt(env.PORT || env.SERVER_PORT || raw.port || '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port value: ${env.PORT || env.SERVER_PORT || raw.port}`);
  }

  const rawCore = String(env.CORE || raw.core || 'sing-box').toLowerCase();
  const core = rawCore === 'singbox' ? 'sing-box' : rawCore;
  if (!SUPPORTED_ENGINES.includes(core)) {
    throw new Error(`Unsupported engine "${core}".`);
  }

  let uuid = String(env.UUID || resolveToken(raw) || '').trim();
  if (!UUID_REGEX.test(uuid)) {
    uuid = generateDeterministicUuid();
  }

  let wsPath = String(env.WS_PATH || resolveEndpoint(raw) || '/vless-ws').trim();
  if (!wsPath.startsWith('/')) wsPath = `/${wsPath}`;
  wsPath = wsPath.split('?')[0];

  // Disabled by default on PaaS (Velixir blocks UDP/TCP 7844 needed by cloudflared)
  const enableTunnel = toBool(env.TUNNEL, toBool(raw.tunnel, false));
  const includeDirectIp = toBool(env.INCLUDE_DIRECT_IP, false);

  const cfg = {
    core,
    uuid,
    port,
    ws_path: wsPath,
    tunnel: enableTunnel,
    includeDirectIp,
    log_level: String(env.LOG_LEVEL || raw.log_level || 'warn').toLowerCase(),
    versions: {
      'sing-box': String(env.SINGBOX_VERSION || (raw.versions && raw.versions['sing-box']) || DEFAULT_VERSIONS['sing-box']),
      'xray': String(env.XRAY_VERSION || (raw.versions && raw.versions.xray) || DEFAULT_VERSIONS.xray),
      'cloudflared': String(env.CLOUDFLARED_VERSION || (raw.versions && raw.versions.cloudflared) || DEFAULT_VERSIONS.cloudflared),
    },
  };

  try {
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({
      core: cfg.core,
      uuid: cfg.uuid,
      ws_path: cfg.ws_path,
      tunnel: cfg.tunnel,
      log_level: cfg.log_level,
    }, null, 2)}\n`);
  } catch (e) {
    warn('Cfg', `Write error: ${e.message}`);
  }

  return cfg;
}

function normSingboxLogLevel(level) {
  const map = { warning: 'warn', none: 'panic' };
  const v = map[level] || level;
  return ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'].includes(v) ? v : 'warn';
}

function normXrayLogLevel(level) {
  const map = { warn: 'warning', trace: 'debug', fatal: 'error', panic: 'error' };
  const v = map[level] || level;
  return ['debug', 'info', 'warning', 'error', 'none'].includes(v) ? v : 'warning';
}

/**
 * Sing-box 1.14+ configuration tuned for Velixir PaaS:
 * - Uses DoH over TCP 443 (1.1.1.1) because Velixir blocks outbound UDP and port 53
 * - Hijacks all port 53 / DNS traffic from VLESS clients and resolves via DoH
 * - Sets default_domain_resolver required by Sing-box 1.14+
 */
function buildSingboxConfig(cfg, internalPort) {
  return {
    log: {
      level: normSingboxLogLevel(cfg.log_level),
      timestamp: true,
    },
    dns: {
      servers: [
        {
          type: 'https',
          tag: 'doh-cf',
          server: '1.1.1.1',
          server_port: 443,
          path: '/dns-query',
        },
        {
          type: 'https',
          tag: 'doh-google',
          server: '8.8.8.8',
          server_port: 443,
          path: '/dns-query',
        },
        {
          type: 'local',
          tag: 'dns-local',
        },
      ],
      final: 'doh-cf',
      strategy: 'ipv4_only',
    },
    inbounds: [
      {
        type: 'vless',
        tag: 'vless-in',
        listen: '127.0.0.1',
        listen_port: internalPort,
        users: [{ name: 'default', uuid: cfg.uuid }],
        transport: {
          type: 'ws',
          path: cfg.ws_path,
          max_early_data: 2048,
          early_data_header_name: 'Sec-WebSocket-Protocol',
        },
      },
    ],
    outbounds: [
      {
        type: 'direct',
        tag: 'direct',
        domain_resolver: {
          server: 'doh-cf',
          strategy: 'ipv4_only',
        },
      },
    ],
    route: {
      default_domain_resolver: {
        server: 'doh-cf',
        strategy: 'ipv4_only',
      },
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { port: 53, action: 'hijack-dns' },
      ],
      final: 'direct',
    },
  };
}

/**
 * Xray-core configuration tuned for Velixir PaaS:
 * - Uses DoH (https+local://1.1.1.1/dns-query) over TCP 443
 * - Intercepts port 53 traffic via internal dns-out outbound
 */
function buildXrayConfig(cfg, internalPort) {
  return {
    log: { loglevel: normXrayLogLevel(cfg.log_level) },
    dns: {
      servers: [
        'https+local://1.1.1.1/dns-query',
        'https+local://8.8.8.8/dns-query',
        'localhost',
      ],
      queryStrategy: 'UseIPv4',
    },
    inbounds: [
      {
        tag: 'vless-in',
        listen: '127.0.0.1',
        port: internalPort,
        protocol: 'vless',
        settings: {
          clients: [{ id: cfg.uuid, email: 'default@local' }],
          decryption: 'none',
        },
        streamSettings: {
          network: 'ws',
          security: 'none',
          wsSettings: { path: cfg.ws_path },
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls'],
        },
      },
    ],
    outbounds: [
      {
        tag: 'direct',
        protocol: 'freedom',
        settings: { domainStrategy: 'UseIPv4' },
      },
      {
        tag: 'dns-out',
        protocol: 'dns',
      },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          port: 53,
          outboundTag: 'dns-out',
        },
      ],
    },
  };
}

function fetchBuffer(url, { timeout = 15000, maxRedirects = 10, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        Accept: '*/*',
        ...headers,
      },
      timeout,
    }, (res) => {
      const { statusCode: sc, headers: rh } = res;
      if (sc >= 300 && sc < 400 && rh.location) {
        res.resume();
        if (maxRedirects <= 0) return reject(new Error('Redirect limit exceeded'));
        const nextUrl = new URL(rh.location, url).toString();
        return resolve(fetchBuffer(nextUrl, { timeout, maxRedirects: maxRedirects - 1, headers }));
      }
      if (sc !== 200) {
        res.resume();
        return reject(new Error(`HTTP Status ${sc}`));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

async function retryOp(fn, attempts = 3, label = 'op') {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      warn('Net', `${label} retry (${i}/${attempts}): ${e.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw lastErr;
}

function resolveRedirectTag(repo) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://github.com/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
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

async function resolveVersionTag(repo, requestedVer) {
  const v = String(requestedVer).replace(/^v/, '');
  if (v !== 'latest') return v;
  try {
    return await resolveRedirectTag(repo);
  } catch (_) { /* fallback to API */ }
  const buf = await retryOp(() => fetchBuffer(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  }), 2, 'tag-check');
  const tag = JSON.parse(buf.toString('utf8')).tag_name;
  if (!tag) throw new Error('Tag not found');
  return String(tag).replace(/^v/, '');
}

function unpackTarGz(buf, targetBinary) {
  const raw = zlib.gunzipSync(buf);
  let offset = 0;
  let longName = null;
  while (offset + 512 <= raw.length) {
    const hdr = raw.subarray(offset, offset + 512);
    if (hdr.every((b) => b === 0)) break;
    const readStr = (st, ln) => hdr.subarray(st, st + ln).toString('utf8').replace(/\0.*$/s, '');
    let name = readStr(0, 100);
    const prefix = readStr(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = Number.parseInt(readStr(124, 12).trim() || '0', 8);
    const typeFlag = String.fromCharCode(hdr[156] || 48);
    const dataStart = offset + 512;
    const chunk = raw.subarray(dataStart, dataStart + size);

    if (typeFlag === 'L') {
      longName = chunk.toString('utf8').replace(/\0.*$/s, '');
    } else {
      if (longName) { name = longName; longName = null; }
      if ((typeFlag === '0' || typeFlag === '\0') && path.posix.basename(name) === targetBinary) {
        return Buffer.from(chunk);
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Target binary "${targetBinary}" not found in tar.gz`);
}

function unpackZip(buf, targetBinary) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (path.posix.basename(name) !== targetBinary || name.endsWith('/')) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Corrupt ZIP local header');
    const lnA = buf.readUInt16LE(localOffset + 26);
    const lnB = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lnA + lnB;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${method}`);
  }
  throw new Error(`Target binary "${targetBinary}" not found in ZIP`);
}

function getCpuArch() {
  const arch = os.arch();
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported CPU architecture: ${arch}`);
}

const PROVIDERS = {
  'sing-box': {
    repo: 'SagerNet/sing-box',
    file: 'esbuild-linux',
    url: (ver, arch) => `https://github.com/SagerNet/sing-box/releases/download/v${ver}/sing-box-${ver}-linux-${arch}.tar.gz`,
    unpack: (buf) => unpackTarGz(buf, 'sing-box'),
  },
  'xray': {
    repo: 'XTLS/Xray-core',
    file: 'prisma-fmt',
    url: (ver, arch) => `https://github.com/XTLS/Xray-core/releases/download/v${ver}/Xray-linux-${arch === 'amd64' ? '64' : 'arm64-v8a'}.zip`,
    unpack: (buf) => unpackZip(buf, 'xray'),
  },
  'cloudflared': {
    repo: 'cloudflare/cloudflared',
    file: 'node-gyp-build',
    url: (ver, arch) => `https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-${arch}`,
    unpack: (buf) => buf,
  },
};

async function ensureBinary(key, requestedVer) {
  const spec = PROVIDERS[key];
  const binPath = path.join(CACHE_DIR, spec.file);
  const revFile = `${binPath}.rev`;
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const currentRev = fs.existsSync(binPath) && fs.existsSync(revFile)
    ? fs.readFileSync(revFile, 'utf8').trim()
    : '';

  let ver;
  try {
    ver = await resolveVersionTag(spec.repo, requestedVer);
  } catch (_) {
    if (currentRev) return binPath;
    ver = DEFAULT_VERSIONS[key];
  }

  if (currentRev === ver) return binPath;

  const arch = getCpuArch();
  const downloadAndExtract = async (v) => {
    const dlUrl = spec.url(v, arch);
    log('Sync', `Downloading ${spec.file} (${key} v${v}) ...`);
    const raw = await retryOp(() => fetchBuffer(dlUrl, { timeout: 120000 }), 2, spec.file);
    const bin = spec.unpack(raw);
    if (!bin || bin.length < 1024 * 1024) throw new Error('Invalid binary size');
    return bin;
  };

  let binaryData;
  try {
    binaryData = await downloadAndExtract(ver);
  } catch (e) {
    try {
      const latestVer = await resolveVersionTag(spec.repo, 'latest');
      if (latestVer && latestVer !== ver) {
        ver = latestVer;
        binaryData = await downloadAndExtract(ver);
      } else {
        throw e;
      }
    } catch (e2) {
      if (currentRev) return binPath;
      throw new Error(`${spec.file}: ${e2.message}`);
    }
  }

  const tmpPath = `${binPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, binaryData, { mode: 0o755 });
  fs.renameSync(tmpPath, binPath);
  fs.chmodSync(binPath, 0o755);
  fs.writeFileSync(revFile, `${ver}\n`);
  log('Sync', `Binary ${spec.file} ready.`);
  return binPath;
}

const activeWorkers = new Map();
let isStopping = false;

function writePidLocks() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const map = {};
    for (const [k, proc] of activeWorkers) {
      if (proc.pid) map[k] = proc.pid;
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify(map));
  } catch (_) { /* ignore */ }
}

function pruneStaleWorkers() {
  const map = readJsonSafe(LOCK_FILE) || {};
  for (const pid of Object.values(map)) {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmdline.includes(CACHE_DIR)) process.kill(pid, 'SIGKILL');
    } catch (_) { /* ignore */ }
  }
  try { fs.unlinkSync(LOCK_FILE); } catch (_) { /* ignore */ }
}

function streamLines(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) if (line.trim()) cb(line);
  });
  stream.on('end', () => {
    if (buf.trim()) cb(buf);
    buf = '';
  });
}

function superviseWorker(tag, cmd, args, { onLine, onStart } = {}) {
  let backoff = 2000;
  const launch = () => {
    if (isStopping) return;
    const startTs = Date.now();
    const proc = spawn(cmd, args, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    activeWorkers.set(tag, proc);
    writePidLocks();

    const handleLine = (line) => (onLine ? onLine(line) : console.log(`[${tag}] ${line}`));
    streamLines(proc.stdout, handleLine);
    streamLines(proc.stderr, handleLine);
    if (onStart) onStart(proc);

    let exited = false;
    const scheduleRestart = () => {
      if (exited) return;
      exited = true;
      activeWorkers.delete(tag);
      if (isStopping) return;
      if (Date.now() - startTs > 60000) backoff = 2000;
      setTimeout(launch, backoff);
      backoff = Math.min(backoff * 2, 60000);
    };
    proc.on('error', scheduleRestart);
    proc.on('exit', scheduleRestart);
  };
  launch();
}

function shutdown(signal) {
  if (isStopping) return;
  isStopping = true;
  log('Sys', `Received ${signal}, stopping workers ...`);
  for (const proc of activeWorkers.values()) {
    try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function probeExternalIp() {
  const endpoints = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com'];
  for (const ep of endpoints) {
    try {
      const ip = (await fetchBuffer(ep, { timeout: 4000 })).toString('utf8').trim();
      if (net.isIP(ip) && !/^(0\.|127\.|::1$)/.test(ip)) return ip;
    } catch (_) { /* try next */ }
  }
  return null;
}

function buildVlessUri({ uuid, addrHost, port, tls, sni, host, pathStr, label }) {
  const hostFormatted = net.isIPv6(addrHost) ? `[${addrHost}]` : addrHost;
  const params = new URLSearchParams({
    encryption: 'none',
    security: tls ? 'tls' : 'none',
    type: 'ws',
  });
  if (tls) {
    if (sni) params.set('sni', sni);
    params.set('fp', 'chrome');
    params.set('alpn', 'http/1.1');
  }
  if (host) params.set('host', host);
  params.set('path', pathStr);
  return `vless://${uuid}@${hostFormatted}:${port}?${params.toString()}#${encodeURIComponent(label)}`;
}

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function parseHostHeader(hdr) {
  if (!hdr) return { hostName: '', hostPort: '' };
  const s = String(hdr).trim().split(',')[0].trim();
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

function collectNodes(req, cfg, state) {
  const items = [];
  const seen = new Set();

  const addNode = (title, opts) => {
    const raw = buildVlessUri(opts);
    if (seen.has(raw)) return;
    seen.add(raw);
    items.push({ title, b64: toBase64(raw), raw });
  };

  const forwardedHost = req && req.headers ? (req.headers['x-forwarded-host'] || req.headers.host || '') : '';
  const { hostName } = parseHostHeader(forwardedHost);
  const effectiveHost = (!hostName || hostName === '127.0.0.1' || hostName === 'localhost' || hostName === '::1')
    ? (process.env.PUBLIC_DOMAIN || '')
    : hostName;

  if (effectiveHost && net.isIP(effectiveHost) === 0) {
    // Primary standard WSS config over port 443
    addNode('Velixir-WSS-TLS (443)', {
      uuid: cfg.uuid,
      addrHost: effectiveHost,
      port: 443,
      tls: true,
      sni: effectiveHost,
      host: effectiveHost,
      pathStr: cfg.ws_path,
      label: `Velixir-TLS-${effectiveHost.split('.')[0]}`,
    });

    // Low-latency Early Data (0-RTT) WSS config over port 443
    addNode('Velixir-WSS-EarlyData (443)', {
      uuid: cfg.uuid,
      addrHost: effectiveHost,
      port: 443,
      tls: true,
      sni: effectiveHost,
      host: effectiveHost,
      pathStr: `${cfg.ws_path}?ed=2048`,
      label: `Velixir-EarlyData-${effectiveHost.split('.')[0]}`,
    });
  }

  if (state.edgeHost) {
    addNode('Cloudflare-QuickTunnel (443)', {
      uuid: cfg.uuid,
      addrHost: state.edgeHost,
      port: 443,
      tls: true,
      sni: state.edgeHost,
      host: state.edgeHost,
      pathStr: `${cfg.ws_path}?ed=2048`,
      label: 'CF-Tunnel-443',
    });
  }

  if (cfg.includeDirectIp && state.ip) {
    addNode(`Direct-IP (${cfg.port})`, {
      uuid: cfg.uuid,
      addrHost: state.ip,
      port: cfg.port,
      tls: false,
      host: state.ip,
      pathStr: cfg.ws_path,
      label: 'Direct-IP',
    });
  }

  const allRaw = items.map((x) => x.raw).join('\n');
  const allB64 = toBase64(allRaw);
  return { items, allRaw, allB64 };
}

function renderPortalHtml(cfg, state, { items, allRaw, allB64 }) {
  const cards = items.map((item, idx) => `
    <div class="card">
      <div class="hdr">
        <span class="lbl">${item.title}</span>
        <div class="btns">
          <button class="btn" onclick="cp('raw_${idx}', this)">Copy URI</button>
          <button class="btn sec" onclick="cp('b64_${idx}', this)">Copy Base64</button>
        </div>
      </div>
      <textarea id="raw_${idx}" readonly onclick="this.select()">${item.raw}</textarea>
      <input type="hidden" id="b64_${idx}" value="${item.b64}">
    </div>
  `).join('');

  const statusText = state.ready ? `Active (${cfg.core} + DoH 443)` : 'Initializing...';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Node Sync Portal</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: #0b0f19; color: #e2e8f0;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 780px; }
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
    margin-bottom: 10px; gap: 8px; flex-wrap: wrap;
  }
  .btns { display: flex; gap: 6px; }
  .lbl { font-size: 13px; font-weight: 600; color: #93c5fd; }
  .btn {
    background: #2563eb; color: #fff; border: none;
    padding: 6px 12px; border-radius: 6px; font-size: 12px;
    font-weight: 600; cursor: pointer; transition: background 0.15s;
  }
  .btn.sec { background: #334155; }
  .btn:hover { background: #1d4ed8; }
  .btn.ok { background: #059669; }
  textarea {
    width: 100%; min-height: 70px; background: #030712; color: #a7f3d0;
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
    <div class="title">Velixir VLESS-WS Portal</div>
    <div class="badge">${statusText}</div>
  </div>
  <div class="card pri">
    <div class="hdr">
      <span class="lbl">All Endpoints Combined (Subscription)</span>
      <div class="btns">
        <button class="btn" onclick="cp('raw_all', this)">Copy Raw Links</button>
        <button class="btn sec" onclick="cp('b_all', this)">Copy Base64 Sub</button>
      </div>
    </div>
    <textarea id="raw_all" readonly onclick="this.select()">${allRaw}</textarea>
    <input type="hidden" id="b_all" value="${allB64}">
  </div>
  ${cards}
  <div class="foot">Subscription URL: <code>/sub</code> &bull; UUID: <code>${cfg.uuid}</code> &bull; WS Path: <code>${cfg.ws_path}</code></div>
</div>
<script>
function cp(id, btn) {
  var el = document.getElementById(id);
  if (!el) return;
  var val = el.value;
  var orig = btn.textContent;
  var done = function() {
    btn.textContent = 'Copied!';
    btn.classList.add('ok');
    setTimeout(function() { btn.textContent = orig; btn.classList.remove('ok'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(done).catch(function() {
      if (el.select) { el.select(); document.execCommand('copy'); }
      done();
    });
  } else if (el.select) {
    el.select(); document.execCommand('copy'); done();
  }
}
</script>
</body>
</html>`;
}

function startGatewayServer(cfg, internalPort, state) {
  const srv = http.createServer((req, res) => {
    const reqUrl = String(req.url || '/');

    // Dedicated healthcheck endpoint for Velixir
    if (reqUrl === '/healthz' || reqUrl === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK');
      return;
    }

    const data = collectNodes(req, cfg, state);
    const ua = String(req.headers['user-agent'] || '');

    if (reqUrl.startsWith('/sub') || reqUrl.includes('raw=1') || !/mozilla/i.test(ua)) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Profile-Update-Interval': '6',
      });
      res.end(reqUrl.includes('raw=1') ? data.allRaw : data.allB64);
      return;
    }

    const html = renderPortalHtml(cfg, state, data);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  });

  srv.on('upgrade', (req, sock, head) => {
    sock.pause();
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 30000);
    sock.on('error', () => {});

    // Always route WebSocket upgrade to the configured ws_path for Sing-box/Xray
    const upstream = net.connect(internalPort, '127.0.0.1', () => {
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 30000);

      let rawReq = `${req.method} ${cfg.ws_path} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      rawReq += '\r\n';

      upstream.write(rawReq);
      if (head && head.length) upstream.write(head);
      upstream.pipe(sock);
      sock.pipe(upstream);
      sock.resume();
    });

    upstream.on('error', () => sock.destroy());
    sock.on('close', () => upstream.destroy());
    upstream.on('close', () => sock.destroy());
  });

  srv.on('error', (e) => warn('Sys', `Gateway error: ${e.message}`));

  return new Promise((resolve) => {
    srv.listen(cfg.port, '0.0.0.0', () => {
      log('Sys', `Gateway listening on 0.0.0.0:${cfg.port} (WS path: ${cfg.ws_path})`);
      resolve(srv);
    });
  });
}

async function bootstrap() {
  if (process.platform !== 'linux') throw new Error('Only Linux platform is supported.');

  const cfg = initConfig();
  pruneStaleWorkers();

  const internalPort = await getFreeLocalPort();
  const state = {
    ready: false,
    ip: null,
    edgeHost: null,
  };

  await startGatewayServer(cfg, internalPort, state);

  const ipPromise = probeExternalIp();
  const engineBin = await ensureBinary(cfg.core, cfg.versions[cfg.core]);

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, 'runtime-state.json');
  const coreConfig = cfg.core === 'xray'
    ? buildXrayConfig(cfg, internalPort)
    : buildSingboxConfig(cfg, internalPort);

  fs.writeFileSync(stateFile, JSON.stringify(coreConfig, null, 2));

  superviseWorker('Core', engineBin, ['run', '-c', stateFile], {
    onStart: () => { state.ready = true; },
    onLine: (line) => console.log(`[Core] ${line}`),
  });

  state.ip = await ipPromise;

  const sampleHost = process.env.PUBLIC_DOMAIN || '<YOUR-APP-NAME>.velixir.run';
  console.log('\n==================================================');
  console.log(`[Ready] UUID: ${cfg.uuid}`);
  console.log(`[Ready] WS Path: ${cfg.ws_path}`);
  console.log('[Ready] Sample Velixir VLESS Config (Replace domain if needed):');
  console.log(buildVlessUri({
    uuid: cfg.uuid,
    addrHost: sampleHost,
    port: 443,
    tls: true,
    sni: sampleHost,
    host: sampleHost,
    pathStr: `${cfg.ws_path}?ed=2048`,
    label: 'Velixir-WSS-443',
  }));
  console.log('==================================================\n');

  if (!cfg.tunnel) return;

  let edgeBin;
  try {
    edgeBin = await ensureBinary('cloudflared', cfg.versions.cloudflared);
  } catch (e) {
    warn('Sync', `Cloudflared skipped: ${e.message}`);
    return;
  }

  let emitted = false;
  const cfRegex = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i;

  superviseWorker('Tunnel', edgeBin, [
    'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${cfg.port}`,
  ], {
    onStart: () => { emitted = false; },
    onLine: (line) => {
      const m = line.match(cfRegex);
      if (m && m[1].toLowerCase() !== 'api.trycloudflare.com' && !emitted) {
        emitted = true;
        state.edgeHost = m[1];
        console.log('\n==================================================');
        console.log('[Tunnel] Cloudflare Quick Tunnel URI:');
        console.log(buildVlessUri({
          uuid: cfg.uuid,
          addrHost: state.edgeHost,
          port: 443,
          tls: true,
          sni: state.edgeHost,
          host: state.edgeHost,
          pathStr: `${cfg.ws_path}?ed=2048`,
          label: 'CF-Tunnel-443',
        }));
        console.log('==================================================\n');
      }
    },
  });
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error('[Fatal]', e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
