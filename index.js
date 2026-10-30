'use strict';

/**
 * Velixir VLESS/WS gateway, refactored edition.
 * Node.js >= 20, Linux, no npm dependencies.
 * Set a permanent UUID and PUBLIC_DOMAIN to the app's real public hostname.
 * /health = process liveness; /readyz = validated core WebSocket readiness.
 * Portal and diagnostics use HTTP Basic auth: admin / (PANEL_TOKEN || UUID).
 * See README.fa.md for deployment, limitations and test scope.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = __dirname;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_UNPACKED = 512 * 1024 * 1024;
const log = (tag, message) => console.log(`[${tag}] ${message}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${path.basename(file)}: ${err.message}`);
  }
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  throw new Error(`Invalid boolean: ${value}`);
}

function portNumber(value) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid port: ${value}`);
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function normalizeWsPath(value) {
  let result = String(value || '/vless-ws').trim();
  if (!result.startsWith('/')) result = `/${result}`;
  result = result.split('?')[0];
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(result)
      || result.startsWith('//') || /%(?![a-f0-9]{2})/i.test(result)) {
    throw new Error('WS_PATH must be a URL pathname without spaces, fragments or invalid escapes.');
  }
  return result;
}

function publicEndpoint(value) {
  const input = String(value || '').trim();
  if (!input || /[\s<>"\\]/.test(input)) throw new Error('Invalid public hostname/URL.');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL/PUBLIC_DOMAIN must be an HTTP(S) origin, without a path or credentials.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || (!net.isIP(host) && !/^[a-z0-9.-]+$/i.test(host))) {
    throw new Error('Invalid public hostname.');
  }
  return {
    host, authority: url.host, port: portNumber(url.port || (url.protocol === 'https:' ? 443 : 80)),
    tls: url.protocol === 'https:', origin: url.origin,
  };
}

function initConfig(env = process.env, root = ROOT) {
  const configFile = path.join(root, 'config.json');
  const raw = readJson(configFile);
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('config.json must contain a JSON object.');
  const oldInbound = Array.isArray(raw.inbounds) ? raw.inbounds[0] || {} : {};
  const previousUuid = raw.uuid || oldInbound.users?.[0]?.uuid || oldInbound.settings?.clients?.[0]?.id;
  const uuid = String(env.UUID || previousUuid || crypto.randomUUID()).trim().toLowerCase();
  if (!UUID_RE.test(uuid)) throw new Error('UUID must be a canonical UUID; refusing to silently replace it.');
  const core = String(env.CORE || raw.core || 'sing-box').toLowerCase().replace(/^singbox$/, 'sing-box');
  if (!['sing-box', 'xray'].includes(core)) throw new Error('CORE must be sing-box or xray.');
  const oldPath = raw.ws_path || oldInbound.transport?.path || oldInbound.streamSettings?.wsSettings?.path;
  const external = env.PUBLIC_URL || env.PUBLIC_DOMAIN || raw.public_url || raw.public_domain || '';
  const dnsMode = String(env.DNS_MODE || raw.dns_mode || 'local').toLowerCase();
  if (!['local', 'doh'].includes(dnsMode)) throw new Error('DNS_MODE must be local or doh.');
  const doh = new URL(env.DOH_URL || raw.doh_url || 'https://1.1.1.1/dns-query');
  if (doh.protocol !== 'https:' || doh.username || doh.password || doh.hash || doh.search) {
    throw new Error('DOH_URL must be HTTPS, without credentials, query or fragment.');
  }
  const cfg = {
    root, configFile, core, uuid,
    port: portNumber(env.PORT || env.SERVER_PORT || raw.port || 8080),
    wsPath: normalizeWsPath(env.WS_PATH || oldPath),
    endpoint: external ? publicEndpoint(external) : null,
    trustProxy: bool(env.TRUST_PROXY, false),
    earlyData: bool(env.ENABLE_EARLY_DATA, false),
    tunnel: bool(env.TUNNEL, bool(raw.tunnel, false)),
    tunnelProtocol: env.TUNNEL_PROTOCOL || 'http2',
    dnsMode, doh,
    logLevel: String(env.LOG_LEVEL || raw.log_level || 'warn'),
    panelToken: String(env.PANEL_TOKEN || uuid),
    dataDir: path.resolve(env.DATA_DIR || root),
    coreBin: env.CORE_BIN ? path.resolve(env.CORE_BIN) : '',
    coreSha256: String(env.CORE_SHA256 || '').toLowerCase(),
    versions: {
      'sing-box': String(env.SINGBOX_VERSION || raw.versions?.['sing-box'] || 'latest'),
      xray: String(env.XRAY_VERSION || raw.versions?.xray || 'latest'),
      cloudflared: String(env.CLOUDFLARED_VERSION || raw.versions?.cloudflared || 'latest'),
    },
  };
  if (!['http2', 'quic', 'auto'].includes(cfg.tunnelProtocol)) throw new Error('Invalid TUNNEL_PROTOCOL.');
  if (cfg.panelToken.length < 16) throw new Error('PANEL_TOKEN must contain at least 16 characters.');
  if (cfg.coreSha256 && !/^[a-f0-9]{64}$/.test(cfg.coreSha256)) throw new Error('Invalid CORE_SHA256.');
  cfg.cacheDir = path.join(cfg.dataDir, '.cache');
  cfg.stateDir = path.join(cfg.dataDir, '.state');
  if (['/', '/health', '/healthz', '/readyz', '/diagnostics', '/sub'].includes(cfg.wsPath)
      || cfg.wsPath.startsWith('/sub/')) throw new Error('WS_PATH conflicts with a gateway endpoint.');
  fs.mkdirSync(cfg.cacheDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  // Preserve existing settings. Do not persist PANEL_TOKEN.
  try {
    fs.writeFileSync(configFile, `${JSON.stringify({
      ...raw, core, uuid, ws_path: cfg.wsPath, tunnel: cfg.tunnel,
      dns_mode: dnsMode, doh_url: doh.href, log_level: cfg.logLevel,
    }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(configFile, 0o600);
  } catch (err) {
    if (!env.UUID && !previousUuid) throw new Error('Cannot persist generated UUID. Set UUID in environment.');
    log('Config', `Could not save config.json: ${err.message}`);
  }
  if (!env.UUID) {
    log('Config', `UUID from local config: ${uuid}`);
    log('Warning', 'Set this same UUID in the platform environment for every replica and redeploy; local disk is temporary.');
  }
  if (!cfg.endpoint) log('Warning', 'Set PUBLIC_DOMAIN to the actual app hostname. No placeholder link will be generated.');
  if (bool(env.INCLUDE_DIRECT_IP, false)) {
    log('Warning', 'INCLUDE_DIRECT_IP ignored: a container egress IP is not an inbound endpoint.');
  }
  return cfg;
}

function buildSingboxConfig(cfg, internalPort) {
  const dnsServers = [{ type: 'local', tag: 'system' }];
  if (cfg.dnsMode === 'doh') {
    const host = cfg.doh.hostname.replace(/^\[|\]$/g, '');
    dnsServers.push({
      type: 'https', tag: 'doh', server: host, server_port: Number(cfg.doh.port || 443),
      path: cfg.doh.pathname,
      tls: { enabled: true, server_name: host },
      ...(!net.isIP(host) ? { domain_resolver: 'system' } : {}),
    });
  }
  const resolver = cfg.dnsMode === 'doh' ? 'doh' : 'system';
  const level = { warning: 'warn', none: 'panic' }[cfg.logLevel] || cfg.logLevel;
  return {
    log: { level: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'].includes(level) ? level : 'warn', timestamp: true },
    dns: { servers: dnsServers, final: resolver, strategy: 'ipv4_only' },
    inbounds: [{
      type: 'vless', tag: 'vless-in', listen: '127.0.0.1', listen_port: internalPort,
      users: [{ name: 'default', uuid: cfg.uuid }],
      transport: {
        type: 'ws', path: cfg.wsPath,
        // Accept ED from old clients, but do not advertise it by default.
        max_early_data: 2048, early_data_header_name: 'Sec-WebSocket-Protocol',
      },
    }],
    outbounds: [{ type: 'direct', tag: 'direct', domain_resolver: { server: resolver, strategy: 'ipv4_only' } }],
    route: {
      default_domain_resolver: { server: resolver, strategy: 'ipv4_only' },
      rules: [{ port: 53, action: 'hijack-dns' }],
      final: 'direct',
    },
  };
}

function buildXrayConfig(cfg, internalPort) {
  const level = { warn: 'warning', trace: 'debug', fatal: 'error', panic: 'error' }[cfg.logLevel] || cfg.logLevel;
  return {
    log: { loglevel: ['debug', 'info', 'warning', 'error', 'none'].includes(level) ? level : 'warning' },
    dns: {
      servers: [cfg.dnsMode === 'doh' ? cfg.doh.href.replace(/^https:/, 'https+local:') : 'localhost'],
      queryStrategy: 'UseIPv4',
    },
    inbounds: [{
      tag: 'vless-in', listen: '127.0.0.1', port: internalPort, protocol: 'vless',
      settings: { clients: [{ id: cfg.uuid, email: 'default@local' }], decryption: 'none' },
      streamSettings: { network: 'ws', security: 'none', wsSettings: { path: cfg.wsPath } },
    }],
    outbounds: [
      { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIPv4' } },
      { tag: 'dns-out', protocol: 'dns' },
    ],
    routing: { domainStrategy: 'AsIs', rules: [{ type: 'field', port: '53', outboundTag: 'dns-out' }] },
  };
}

function fetchBuffer(address, { timeout = 30000, maxBytes = MAX_ARCHIVE, redirects = 5, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    if (url.protocol !== 'https:') return reject(new Error('Download redirect must use HTTPS.'));
    const req = https.get(url, { headers: { 'User-Agent': 'velixir-vless-gateway', ...headers } });
    const timer = setTimeout(() => req.destroy(new Error('Download deadline exceeded.')), timeout);
    const finish = (err, value) => { clearTimeout(timer); err ? reject(err) : resolve(value); };
    req.on('error', (err) => finish(err));
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        clearTimeout(timer);
        if (!redirects) return reject(new Error('Too many redirects.'));
        return resolve(fetchBuffer(new URL(res.headers.location, url), { timeout, maxBytes, redirects: redirects - 1, headers }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return finish(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new Error('Download exceeds size limit.'));
        else chunks.push(chunk);
      });
      res.on('aborted', () => finish(new Error('Download interrupted.')));
      res.on('error', (err) => finish(err));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
    });
  });
}

function unpackTarGz(buffer, binaryName) {
  const raw = zlib.gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED });
  let offset = 0;
  let longName = '';
  while (offset + 512 <= raw.length) {
    const hdr = raw.subarray(offset, offset + 512);
    if (hdr.every((v) => v === 0)) break;
    const str = (start, length) => hdr.subarray(start, start + length).toString().split('\0')[0];
    const size = Number.parseInt(str(124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > raw.length) throw new Error('Invalid TAR size.');
    let name = str(0, 100);
    if (str(345, 155)) name = `${str(345, 155)}/${name}`;
    const data = raw.subarray(offset + 512, offset + 512 + size);
    const type = hdr[156];
    if (type === 76) longName = data.toString().split('\0')[0];
    else if (type === 0 || type === 48) {
      if (path.posix.basename(longName || name) === binaryName) return Buffer.from(data);
      longName = '';
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Binary ${binaryName} not found in TAR.`);
}

function unpackZip(buffer, binaryName) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP directory.');
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (ptr + 46 > eocd || buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = buffer.readUInt16LE(ptr + 8);
    const method = buffer.readUInt16LE(ptr + 10);
    const size = buffer.readUInt32LE(ptr + 20);
    const expandedSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const next = ptr + 46 + nameLen + buffer.readUInt16LE(ptr + 30) + buffer.readUInt16LE(ptr + 32);
    const local = buffer.readUInt32LE(ptr + 42);
    if (next > eocd) throw new Error('Truncated ZIP entry.');
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString();
    ptr = next;
    if (name.endsWith('/') || path.posix.basename(name) !== binaryName) continue;
    if (flags & 1 || expandedSize > MAX_UNPACKED) throw new Error('Encrypted or oversized ZIP entry.');
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + size > buffer.length) throw new Error('Truncated ZIP data.');
    const data = buffer.subarray(start, start + size);
    const result = method === 0 ? Buffer.from(data)
      : method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }) : null;
    if (!result || result.length !== expandedSize) throw new Error('Unsupported or corrupt ZIP data.');
    return result;
  }
  throw new Error(`Binary ${binaryName} not found in ZIP.`);
}

const PROVIDERS = {
  'sing-box': {
    repo: 'SagerNet/sing-box',
    url: (v, a) => `https://github.com/SagerNet/sing-box/releases/download/v${v}/sing-box-${v}-linux-${a}.tar.gz`,
    unpack: (b) => unpackTarGz(b, 'sing-box'),
  },
  xray: {
    repo: 'XTLS/Xray-core',
    url: (v, a) => `https://github.com/XTLS/Xray-core/releases/download/v${v}/Xray-linux-${a === 'amd64' ? '64' : 'arm64-v8a'}.zip`,
    unpack: (b) => unpackZip(b, 'xray'),
  },
  cloudflared: {
    repo: 'cloudflare/cloudflared',
    url: (v, a) => `https://github.com/cloudflare/cloudflared/releases/download/${v}/cloudflared-linux-${a}`,
    unpack: (b) => b,
  },
};

async function resolveVersion(repo, requested) {
  if (requested !== 'latest') {
    const v = requested.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?$/.test(v)) throw new Error(`Invalid version: ${requested}`);
    return v;
  }
  // Redirect resolution avoids depending on the rate-limited GitHub API.
  try {
    return await new Promise((resolve, reject) => {
      const req = https.get(`https://github.com/${repo}/releases/latest`, { headers: { 'User-Agent': 'velixir-vless-gateway' } }, (res) => {
        res.resume();
        const tag = String(res.headers.location || '').match(/\/tag\/v?(\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?)$/)?.[1];
        tag ? resolve(tag) : reject(new Error('No latest release redirect.'));
      });
      const timer = setTimeout(() => req.destroy(new Error('Release lookup timed out.')), 15000);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
    });
  } catch (_) {
    const release = JSON.parse((await fetchBuffer(`https://api.github.com/repos/${repo}/releases/latest`, { maxBytes: 4 * 1024 * 1024 })).toString());
    if (!release.tag_name || release.prerelease || release.draft) throw new Error('No stable release found.');
    return resolveVersion(repo, release.tag_name);
  }
}

function assertBinary(file, checksum = '') {
  fs.accessSync(file, fs.constants.R_OK | fs.constants.X_OK);
  const descriptor = fs.openSync(file, 'r');
  const head = Buffer.alloc(20);
  try { fs.readSync(descriptor, head, 0, head.length, 0); } finally { fs.closeSync(descriptor); }
  if (!head.subarray(0, 4).equals(Buffer.from([0x7f, 69, 76, 70]))) throw new Error('Core binary is not a Linux ELF executable.');
  const machine = head.readUInt16LE(18);
  if ((os.arch() === 'x64' && machine !== 62) || (os.arch() === 'arm64' && machine !== 183)) {
    throw new Error('Core binary CPU architecture does not match this container.');
  }
  if (checksum && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== checksum) {
    throw new Error('CORE_SHA256 mismatch.');
  }
}

async function ensureBinary(key, cfg) {
  if (key === cfg.core && cfg.coreBin) {
    assertBinary(cfg.coreBin, cfg.coreSha256);
    return cfg.coreBin;
  }
  const arch = { x64: 'amd64', arm64: 'arm64' }[os.arch()];
  if (!arch) throw new Error(`Unsupported architecture: ${os.arch()}`);
  const provider = PROVIDERS[key];
  const file = path.join(cfg.cacheDir, `${key}-linux-${arch}`);
  const requested = cfg.versions[key];
  const revision = readJson(`${file}.json`);
  let version;
  try { version = await resolveVersion(provider.repo, requested); }
  catch (err) {
    if (requested !== 'latest' || !revision.version) throw err;
    assertBinary(file, key === cfg.core ? cfg.coreSha256 : '');
    log('Warning', `Release lookup failed; explicitly using cached ${key} ${revision.version}.`);
    return file;
  }
  if (key === 'sing-box' && Number(version.split('.')[0]) === 1 && Number(version.split('.')[1]) < 12) {
    throw new Error('This configuration requires sing-box >= 1.12.0.');
  }
  if (version === revision.version && fs.existsSync(file)) {
    assertBinary(file, key === cfg.core ? cfg.coreSha256 : '');
    return file;
  }
  log('Download', `${key} ${version} (${arch}) from its official GitHub release.`);
  let archive;
  for (let i = 0; i < 3; i += 1) {
    try { archive = await fetchBuffer(provider.url(version, arch), { timeout: 120000 }); break; }
    catch (err) {
      if (i === 2) throw err;
      log('Download', `${err.message}; retrying.`);
      await delay(1000 * (i + 1));
    }
  }
  const binary = provider.unpack(archive);
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, binary, { mode: 0o700 });
    fs.chmodSync(tmp, 0o700);
    assertBinary(tmp, key === cfg.core ? cfg.coreSha256 : '');
    fs.renameSync(tmp, file);
    fs.writeFileSync(`${file}.json`, JSON.stringify({ version }), { mode: 0o600 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* already moved */ }
  }
  return file;
}

function runChecked(command, args, cwd, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeout);
    const capture = (chunk) => { output = (output + chunk.toString()).slice(-16000); };
    proc.stdout.on('data', capture);
    proc.stderr.on('data', capture);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Core validation failed (${signal || code}): ${output.trim()}`));
    });
  });
}

function probeWebSocket(endpoint, wsPath, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const expected = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const client = endpoint.tls ? https : http;
    const req = client.request({
      hostname: endpoint.host, port: endpoint.port, path: wsPath, method: 'GET',
      headers: { Host: endpoint.authority || endpoint.host, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    const timer = setTimeout(() => req.destroy(new Error('Core WebSocket timed out.')), timeout);
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('response', (res) => { clearTimeout(timer); res.resume(); reject(new Error(`WebSocket returned HTTP ${res.statusCode}, expected 101.`)); });
    req.on('upgrade', (res, socket) => {
      clearTimeout(timer);
      socket.on('error', () => {});
      socket.destroy();
      if (res.statusCode !== 101 || res.headers['sec-websocket-accept'] !== expected) reject(new Error('Invalid WebSocket handshake.'));
      else resolve(true);
    });
    req.end();
  });
}

// Diagnostics only: a small RFC6455 client that sends a real VLESS TCP request.
// It tests DNS + outbound TCP/HTTP, not ICMP, UDP, or all possible destinations.
function clientFrame(payload, opcode = 2) {
  if (payload.length > 65535) throw new Error('Diagnostic frame is too large.');
  const offset = payload.length < 126 ? 2 : 4;
  const result = Buffer.alloc(offset + 4 + payload.length);
  result[0] = 0x80 | opcode;
  result[1] = 0x80 | (offset === 2 ? payload.length : 126);
  if (offset === 4) result.writeUInt16BE(payload.length, 2);
  const mask = crypto.randomBytes(4);
  mask.copy(result, offset);
  for (let i = 0; i < payload.length; i += 1) result[offset + 4 + i] = payload[i] ^ mask[i % 4];
  return result;
}

function probeVlessHttp(endpoint, cfg, timeout = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const key = crypto.randomBytes(16).toString('base64');
    let socket;
    let done = false;
    let wire = Buffer.alloc(0);
    let response = Buffer.alloc(0);
    let headerRead = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      req.destroy();
      resolve({ ok, milliseconds: Date.now() - start, detail, target: 'http://www.gstatic.com/generate_204' });
    };
    const req = (endpoint.tls ? https : http).request({
      hostname: endpoint.host, port: endpoint.port, path: cfg.wsPath,
      headers: { Host: endpoint.authority || endpoint.host, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    const timer = setTimeout(() => finish(false, 'Timed out waiting for VLESS/HTTP response.'), timeout);
    req.on('error', (err) => finish(false, err.message));
    req.on('response', (res) => { res.resume(); finish(false, `WebSocket HTTP ${res.statusCode} (expected 101).`); });
    req.on('upgrade', (res, peer, head) => {
      socket = peer;
      socket.on('error', (err) => finish(false, err.message));
      socket.on('close', () => finish(false, 'Connection closed before HTTP response.'));
      const expected = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      if (res.statusCode !== 101 || res.headers['sec-websocket-accept'] !== expected) return finish(false, 'Invalid WebSocket handshake.');
      const domain = Buffer.from('www.gstatic.com');
      const header = Buffer.concat([
        Buffer.from([0]), Buffer.from(cfg.uuid.replace(/-/g, ''), 'hex'),
        Buffer.from([0, 1, 0, 80, 2, domain.length]), domain,
      ]);
      const request = Buffer.from('GET /generate_204 HTTP/1.1\r\nHost: www.gstatic.com\r\nConnection: close\r\n\r\n');
      const consume = (chunk) => {
        if (done) return;
        wire = Buffer.concat([wire, chunk]);
        if (wire.length > 1024 * 1024) return finish(false, 'Diagnostic frame exceeds limit.');
        while (wire.length >= 2 && !done) {
          const opcode = wire[0] & 15;
          let size = wire[1] & 127;
          let offset = 2;
          if (wire[1] & 128 || wire[0] & 0x70) return finish(false, 'Unexpected WebSocket masking/extension.');
          if (size === 126) {
            if (wire.length < 4) return;
            size = wire.readUInt16BE(2); offset = 4;
          } else if (size === 127) {
            if (wire.length < 10) return;
            const large = wire.readBigUInt64BE(2);
            if (large > 1048576n) return finish(false, 'Oversized WebSocket response.');
            size = Number(large); offset = 10;
          }
          if (wire.length < offset + size) return;
          const payload = wire.subarray(offset, offset + size);
          wire = wire.subarray(offset + size);
          if (opcode === 8) return finish(false, 'WebSocket closed before HTTP response.');
          if (opcode === 9) { socket.write(clientFrame(payload, 10)); continue; }
          if (opcode === 10) continue;
          if (![0, 2].includes(opcode)) return finish(false, 'Unexpected WebSocket data type.');
          response = Buffer.concat([response, payload]);
          if (response.length > 65536) return finish(false, 'HTTP response header exceeds limit.');
          if (!headerRead) {
            if (response.length < 2) continue;
            if (response[0] !== 0) return finish(false, 'Invalid VLESS response version.');
            if (response.length < 2 + response[1]) continue;
            response = response.subarray(2 + response[1]);
            headerRead = true;
          }
          const lineEnd = response.indexOf('\r\n');
          if (lineEnd >= 0) {
            const line = response.subarray(0, lineEnd).toString();
            const status = line.match(/^HTTP\/1\.[01] (\d{3})\b/);
            return finish(Boolean(status && Number(status[1]) >= 200 && Number(status[1]) < 400), line);
          }
        }
      };
      socket.on('data', consume);
      socket.write(clientFrame(Buffer.concat([header, request])));
      if (head.length) consume(head);
    });
    req.end();
  });
}

function superviseWorker(tag, command, args, cfg, { onStart = () => {}, onStop = () => {}, onLine = () => {} } = {}) {
  let stopped = false;
  let child = null;
  let timer = null;
  let backoff = 1000;
  const launch = () => {
    if (stopped) return;
    const started = Date.now();
    const proc = spawn(command, args, { cwd: cfg.root, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let ended = false;
    let failure = '';
    for (const stream of [proc.stdout, proc.stderr]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop().slice(-8192);
        for (const line of lines) if (line) { log(tag, line); onLine(line); }
      });
      stream.on('end', () => { if (pending) { log(tag, pending); onLine(pending); } });
    }
    proc.on('spawn', () => onStart(proc));
    const exited = (code, signal) => {
      if (ended) return;
      ended = true;
      const reason = failure || `${tag} exited (code=${code}, signal=${signal || 'none'}).`;
      onStop(reason);
      if (stopped) return;
      if (Date.now() - started > 60000) backoff = 1000;
      log(tag, `${reason} Restart in ${backoff}ms.`);
      timer = setTimeout(launch, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    proc.on('error', (err) => { failure = err.message; exited(null, null); });
    proc.on('exit', exited);
  };
  launch();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      const proc = child;
      if (proc && proc.exitCode === null) {
        proc.kill('SIGTERM');
        const killTimer = setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 1200);
        killTimer.unref();
      }
    },
  };
}

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function buildVlessUri(cfg, endpoint, label) {
  const host = net.isIPv6(endpoint.host) ? `[${endpoint.host}]` : endpoint.host;
  const params = new URLSearchParams({
    encryption: 'none', security: endpoint.tls ? 'tls' : 'none', type: 'ws',
    host: endpoint.authority, path: cfg.wsPath + (cfg.earlyData ? '?ed=2048' : ''),
  });
  if (endpoint.tls) {
    params.set('sni', endpoint.host);
    params.set('fp', 'chrome');
    params.set('alpn', 'http/1.1');
  }
  return `vless://${cfg.uuid}@${host}:${endpoint.port}?${params}#${encodeURIComponent(label)}`;
}

function endpointForRequest(req, cfg) {
  if (cfg.endpoint) return cfg.endpoint;
  let host = req.headers.host;
  let proto = 'https'; // Public PaaS TLS terminates at its edge, not this HTTP listener.
  if (cfg.trustProxy) {
    host = String(req.headers['x-forwarded-host'] || host || '').split(',')[0].trim();
    proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  }
  if (!host || !['http', 'https'].includes(proto)) return null;
  try {
    const endpoint = publicEndpoint(`${proto}://${host}`);
    if (endpoint.host === 'localhost' || net.isIP(endpoint.host) || !endpoint.host.includes('.')) return null;
    return endpoint;
  } catch (_) { return null; }
}

function collectNodes(req, cfg, state) {
  const items = [];
  const endpoint = endpointForRequest(req, cfg);
  if (endpoint) items.push({ title: 'VLESS / WebSocket', raw: buildVlessUri(cfg, endpoint, `Velixir-${endpoint.host}`) });
  if (state.edgeHost) {
    const edge = publicEndpoint(state.edgeHost);
    if (edge.origin !== endpoint?.origin) items.push({ title: 'Cloudflare Quick Tunnel (temporary)', raw: buildVlessUri(cfg, edge, 'Velixir-QuickTunnel') });
  }
  return items;
}

function authenticated(req, cfg, pathname) {
  let supplied = '';
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) supplied = authorization.slice(7);
  else if (authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon >= 0) supplied = decoded.slice(colon + 1);
  }
  // A secret subscription path is convenient for clients without auth-header support.
  // Treat the whole URL as a credential; ingress access logs can record it.
  if (pathname.startsWith('/sub/')) {
    try { supplied = decodeURIComponent(pathname.slice(5)); } catch (_) { return false; }
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(cfg.panelToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function renderPortal(cfg, state, items) {
  const links = items.map((item) => `<h3>${escapeHtml(item.title)}</h3><textarea readonly onclick="this.select()">${escapeHtml(item.raw)}</textarea>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Velixir VLESS gateway</title><style>
:root{color-scheme:dark}body{background:#0b0f19;color:#e2e8f0;font:15px system-ui;margin:40px auto;padding:0 20px;max-width:850px}
textarea{box-sizing:border-box;width:100%;min-height:110px;background:#111827;color:#a7f3d0;padding:12px;border:1px solid #334155;border-radius:8px}
a{color:#93c5fd}code{overflow-wrap:anywhere}li{margin:8px 0}
</style><h1>Velixir VLESS / WebSocket</h1>
<p>Core: <strong>${escapeHtml(cfg.core)}</strong> | Status: <strong>${state.ready ? 'WebSocket ready (not an Internet connectivity guarantee)' : escapeHtml(state.phase)}</strong></p>
${state.lastError ? `<p>Last error: ${escapeHtml(state.lastError)}</p>` : ''}
${links || '<p>No valid public endpoint. Set PUBLIC_DOMAIN to your actual app hostname.</p>'}
<ul><li>Use the standard TLS/WebSocket profile first. Early Data is ${cfg.earlyData ? 'enabled' : 'disabled'}.</li>
<li><a href="/sub?raw=1">Raw subscription</a> | <a href="/sub">Base64 subscription</a> (Basic auth required)</li>
<li>Clients without Basic auth: subscription path <code>/sub/${escapeHtml(encodeURIComponent(cfg.panelToken))}</code>. Keep this URL private; access logs may record it.</li>
<li><a href="/diagnostics">Diagnostics</a> | <a href="/diagnostics?probe=1">Run real VLESS HTTP probes</a></li>
<li>Velixir default outbound access: TCP 80/443 and DNS. Other ports/UDP need provider approval.</li></ul>
<p>WS path: <code>${escapeHtml(cfg.wsPath)}</code>. UUID must be identical across all replicas and deployments.</p></html>`;
}

function startGatewayServer(cfg, internalPort, state) {
  const sockets = new Set();
  let diagnosticsPromise = null;
  let diagnosticsAt = 0;
  let diagnosticsResult = null;
  const local = { host: '127.0.0.1', authority: 'localhost', port: internalPort, tls: false };
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', headers = {}) => {
      res.writeHead(status, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      const url = new URL(req.url, 'http://gateway.local');
      const pathname = url.pathname;
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
      if (['/health', '/healthz'].includes(pathname)) return send(200, 'alive\n');
      if (pathname === '/readyz') return send(state.ready ? 200 : 503, state.ready ? 'ready\n' : 'core not ready\n');
      if (pathname === cfg.wsPath) return send(426, 'WebSocket upgrade required\n', undefined, { Upgrade: 'websocket' });
      const known = ['/', '/sub', '/diagnostics'].includes(pathname) || pathname.startsWith('/sub/');
      if (!known) return send(404, 'Not found\n');
      if (!authenticated(req, cfg, pathname)) {
        return send(401, 'Login: admin; password: PANEL_TOKEN (defaults to UUID).\n', undefined, { 'WWW-Authenticate': 'Basic realm="Velixir gateway", charset="UTF-8"' });
      }
      if (pathname === '/diagnostics') {
        if (url.searchParams.get('probe') === '1' && req.method === 'GET') {
          if (!diagnosticsPromise && Date.now() - diagnosticsAt > 15000) {
            diagnosticsPromise = (async () => {
              const [loopback, external] = await Promise.all([
                probeVlessHttp(local, cfg),
                cfg.endpoint ? probeVlessHttp(cfg.endpoint, cfg) : Promise.resolve({ ok: null, detail: 'Set PUBLIC_DOMAIN/PUBLIC_URL to test the public edge.' }),
              ]);
              diagnosticsResult = { loopbackVlessHttp: loopback, publicVlessHttp: external, checkedAt: new Date().toISOString() };
              diagnosticsAt = Date.now();
            })().finally(() => { diagnosticsPromise = null; });
          }
          if (diagnosticsPromise) await diagnosticsPromise;
        }
        return send(200, JSON.stringify({
          core: cfg.core, phase: state.phase, coreWebSocketReady: state.ready,
          publicOrigin: cfg.endpoint?.origin || null, wsPath: cfg.wsPath, dnsMode: cfg.dnsMode,
          coreCheckedAt: state.checkedAt || null, lastError: state.lastError || null,
          probes: diagnosticsResult,
          note: 'WebSocket readiness alone does not verify VLESS authentication, DNS, Internet access, or the client network. Probes test HTTP over VLESS to one TCP/80 destination only.',
        }, null, 2), 'application/json; charset=utf-8');
      }
      const items = collectNodes(req, cfg, state);
      if (pathname.startsWith('/sub')) {
        if (!state.ready) return send(503, 'Core is not ready. Check authenticated /diagnostics.\n');
        if (!items.length) return send(503, 'No endpoint. Set PUBLIC_DOMAIN.\n');
        const raw = items.map((item) => item.raw).join('\n');
        return send(200, url.searchParams.get('raw') === '1' ? raw : b64(raw), undefined, { 'Profile-Update-Interval': '6' });
      }
      return send(200, renderPortal(cfg, state, items), 'text/html; charset=utf-8');
    } catch (err) {
      log('HTTP', err.message);
      if (!res.headersSent) send(500, 'Request failed. Check server logs.\n');
      else res.destroy();
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const reject = (code, reason) => {
      socket.end(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    let pathname;
    try { pathname = new URL(req.url, 'http://gateway.local').pathname; }
    catch (_) { return reject(400, 'Bad Request'); }
    if (req.method !== 'GET' || String(req.headers.upgrade).toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
    if (pathname !== cfg.wsPath) return reject(404, 'Not Found');
    if (!state.ready) return reject(503, 'Service Unavailable');
    socket.pause();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
    socket.setTimeout(0);
    const upstream = net.connect({ port: internalPort, host: '127.0.0.1' });
    const timer = setTimeout(() => upstream.destroy(new Error('Core connection timed out.')), 5000);
    upstream.on('connect', () => {
      clearTimeout(timer);
      if (socket.destroyed) return upstream.destroy();
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 30000);
      // Preserve the URL/query and raw header values, including Sec-WebSocket-Protocol.
      const lines = [`GET ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        if (['connection', 'upgrade', 'proxy-authorization', 'authorization'].includes(key.toLowerCase())) continue;
        lines.push(`${key}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push('Connection: Upgrade', 'Upgrade: websocket', '', '');
      upstream.write(lines.join('\r\n'));
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
      socket.resume();
    });
    upstream.on('error', (err) => {
      state.lastError = `Gateway upstream: ${err.message}`;
      state.ready = false;
      socket.destroy();
    });
    upstream.on('close', () => { clearTimeout(timer); socket.destroy(); });
    socket.on('close', () => { clearTimeout(timer); upstream.destroy(); });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.destroyConnections = () => { for (const socket of sockets) socket.destroy(); };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      server.on('error', (err) => log('Gateway', err.message));
      log('Gateway', `Listening on 0.0.0.0:${server.address().port}; WS path ${cfg.wsPath}.`);
      resolve(server);
    });
  });
}

async function bootstrap() {
  if (process.platform !== 'linux') throw new Error('Deploy this gateway on Linux.');
  const cfg = initConfig();
  const internalPort = await getFreeLocalPort();
  const local = { host: '127.0.0.1', authority: 'localhost', port: internalPort, tls: false };
  const state = { ready: false, phase: 'downloading core', lastError: null, edgeHost: null };
  const server = await startGatewayServer(cfg, internalPort, state);
  const workers = [];
  let stopped = false;
  let readinessTimer;
  let generation = 0;
  let alive = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    state.ready = false;
    clearTimeout(readinessTimer);
    for (const worker of workers) worker.stop();
    server.close();
    server.destroyConnections();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const binary = await ensureBinary(cfg.core, cfg);
    if (stopped) return;
    state.phase = 'validating core configuration';
    const configPath = path.join(cfg.stateDir, `core-${process.pid}.json`);
    const coreConfig = cfg.core === 'xray' ? buildXrayConfig(cfg, internalPort) : buildSingboxConfig(cfg, internalPort);
    fs.writeFileSync(configPath, JSON.stringify(coreConfig, null, 2), { mode: 0o600 });
    const validationArgs = cfg.core === 'xray' ? ['run', '-test', '-config', configPath] : ['check', '-c', configPath];
    await runChecked(binary, validationArgs, cfg.root);
    if (stopped) return;
    log('Core', 'Configuration validation passed.');
    state.phase = 'starting core';
    const check = async () => {
      if (stopped) return;
      const version = generation;
      let failure;
      if (alive) {
        try { await probeWebSocket(local, cfg.wsPath); } catch (err) { failure = err.message; }
        if (version === generation && !stopped) {
          const wasReady = state.ready;
          state.ready = !failure;
          state.phase = failure ? 'core not ready' : 'ready';
          state.lastError = failure || null;
          state.checkedAt = new Date().toISOString();
          if (!wasReady && state.ready) log('Ready', 'Core accepted a real WebSocket handshake. Test /diagnostics?probe=1 for VLESS and egress.');
        }
      }
      if (!stopped) readinessTimer = setTimeout(check, state.ready ? 5000 : 1000);
    };
    workers.push(superviseWorker('Core', binary, ['run', '-c', configPath], cfg, {
      onStart() { alive = true; generation += 1; state.ready = false; state.phase = 'starting core'; },
      onStop(reason) { alive = false; generation += 1; state.ready = false; state.phase = 'restarting core'; state.lastError = reason; },
    }));
    await check();
    if (cfg.endpoint) log('Portal', `${cfg.endpoint.origin}/ (Basic auth: admin / PANEL_TOKEN or UUID).`);
    if (cfg.tunnel && !stopped) {
      log('Warning', 'Cloudflare Tunnel requires outbound port 7844; ask Velixir support to allow it. HTTP/2 still uses TCP 7844.');
      try {
        const tunnel = await ensureBinary('cloudflared', cfg);
        if (stopped) return;
        let candidate = null;
        let connected = false;
        workers.push(superviseWorker('Tunnel', tunnel,
          ['tunnel', '--no-autoupdate', '--protocol', cfg.tunnelProtocol, '--url', `http://127.0.0.1:${cfg.port}`], cfg, {
            onStart() { state.edgeHost = null; candidate = null; connected = false; },
            onStop() { state.edgeHost = null; candidate = null; connected = false; },
            onLine(line) {
              const found = line.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i)?.[1];
              if (found && found !== 'api.trycloudflare.com') candidate = found;
              if (/Registered tunnel connection/i.test(line)) connected = true;
              if (candidate && connected) state.edgeHost = candidate;
            },
          }));
      } catch (err) { log('Tunnel', `Optional tunnel unavailable: ${err.message}`); }
    }
  } catch (err) {
    state.ready = false;
    state.lastError = err.message;
    state.phase = 'failed';
    log('Fatal', err.stack || err.message);
    for (const worker of workers) worker.stop();
    server.close();
    server.destroyConnections();
    clearTimeout(readinessTimer);
    throw err;
  }
}

module.exports = {
  initConfig, normalizeWsPath, publicEndpoint, buildSingboxConfig, buildXrayConfig,
  buildVlessUri, endpointForRequest, collectNodes, startGatewayServer,
  probeWebSocket, probeVlessHttp, clientFrame, unpackTarGz, unpackZip,
  runChecked, superviseWorker, authenticated, resolveVersion,
};

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(`[Fatal] ${err.message}`);
    process.exit(1);
  });
}
