// Preloaded with node --import by no-network.test.ts. Every way out of the process
// is replaced by a function that appends its name to $NET_LOG and throws. The log
// catches attempts that the CLI wraps in try/catch.
import { appendFileSync } from "node:fs";
import { createRequire, Module, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const hit = (what) => {
  appendFileSync(process.env.NET_LOG, `${what}\n`);
  throw new Error(`network blocked by the test: ${what}`);
};
const block = (obj, names, prefix) => {
  for (const name of names) if (typeof obj[name] === "function") obj[name] = () => hit(`${prefix}.${name}`);
};

for (const name of ["fetch", "WebSocket", "EventSource"]) {
  if (name in globalThis) globalThis[name] = () => hit(name);
}
// The dispatcher behind Node's built-in fetch, in case something kept a reference to the original.
globalThis[Symbol.for("undici.globalDispatcher.1")] = { dispatch: () => hit("undici.dispatch") };
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "undici" || request.startsWith("undici/")) hit(`require(${request})`);
  return load.call(this, request, ...rest);
};

const net = require("node:net");
block(net, ["connect", "createConnection"], "net");
net.Socket.prototype.connect = () => hit("net.Socket.connect");
block(require("node:tls"), ["connect"], "tls");
for (const m of ["http", "https"]) {
  const mod = require(`node:${m}`);
  block(mod, ["request", "get"], m);
  mod.Agent.prototype.createConnection = () => hit(`${m}.Agent.createConnection`);
}
block(require("node:http2"), ["connect"], "http2");

const dns = require("node:dns");
const DNS = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveTxt", "resolveSrv", "resolvePtr", "resolveNaptr", "resolveSoa", "resolveCaa", "reverse"];
block(dns, DNS, "dns");
block(dns.Resolver.prototype, DNS, "dns.Resolver");
block(dns.promises, DNS, "dns.promises");
block(dns.promises.Resolver.prototype, DNS, "dns.promises.Resolver");

const dgram = require("node:dgram");
block(dgram, ["createSocket"], "dgram");
block(dgram.Socket.prototype, ["bind", "connect", "send"], "dgram.Socket");

// A child process could reach the network for us. The non-TTY run starts none.
block(require("node:child_process"), ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process");

// Without this, `import { connect } from "node:net"` in the bundle would still get the original.
syncBuiltinESMExports();
