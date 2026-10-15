import '../src/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR, config } from '../src/config.mjs';

process.umask(0o077);
const windows=process.platform==='win32';
const nodeBinary=path.join(ROOT,windows?'runtime/node.exe':'runtime/bin/node');
const action = process.argv[2] || 'start';
const noBrowser = process.argv.includes('--no-browser');
const rootId = crypto.createHash('sha256').update(fs.realpathSync(ROOT)).digest('hex');
const url = `http://127.0.0.1:${config.port}`;
const pidFile = path.join(DATA_DIR, 'mac-service.json');
const logFile = path.join(DATA_DIR, 'service.log');
const lockDir = path.join(DATA_DIR, '.mac-control-lock');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readRecord = () => { try { return JSON.parse(fs.readFileSync(pidFile, 'utf8')); } catch { return null; } };
function owned(record) {
  if (!record || record.rootId !== rootId || !Number.isInteger(record.pid) || record.pid < 2 || !alive(record.pid)) return false;
  try {
    if(windows){const command=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-Command',`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);(Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}").CommandLine`],{encoding:'utf8',windowsHide:true}).trim().toLowerCase();return command.includes(nodeBinary.toLowerCase())&&command.includes(path.join(ROOT,'src/server.mjs').toLowerCase());}
    const command = execFileSync('/bin/ps', ['-ww', '-p', String(record.pid), '-o', 'command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8', LANG: 'en_US.UTF-8' } }).trim();
    return command.startsWith(nodeBinary + ' ' + path.join(ROOT, 'src/server.mjs'));
  } catch { return false; }
}
async function health() {
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) });
    return await response.json();
  } catch { return null; }
}
function browse() {
  if (noBrowser) return;
  if(windows)execFileSync('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true});else execFileSync('/usr/bin/open',[url]);
}
async function lock() {
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid }));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')); } catch {}
      if ((owner && !alive(owner.pid)) || (!owner && Date.now() - fs.statSync(lockDir).mtimeMs > 5000)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      await sleep(250);
    }
  }
  throw new Error('另一个启停操作仍在进行，请稍后重试。');
}
async function start() {
  const existing = await health();
  if (existing?.ok && existing.rootId === rootId) {
    fs.writeFileSync(pidFile, JSON.stringify({ pid: existing.pid, rootId }));
    console.log('服务已经运行：' + url); browse(); return;
  }
  if (existing) throw new Error('端口被其他服务或另一份软件占用，请修改 .env 中的 ZVEC_PORT。');
  const prior = readRecord();
  if (owned(prior)) throw new Error('本软件进程仍在启动或暂时无响应，请查看日志，或双击停止服务后重试。');
  fs.rmSync(pidFile, { force: true });
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10 * 1024 * 1024) {
    fs.rmSync(logFile + '.1', { force: true }); fs.renameSync(logFile, logFile + '.1');
  }
  const fd = fs.openSync(logFile, 'a', 0o600);
  const child = spawn(nodeBinary, [path.join(ROOT, 'src/server.mjs')], {
    cwd: ROOT, detached: true, windowsHide:true, stdio: ['ignore', fd, fd], env: { ...process.env, ZVEC_HOST: '127.0.0.1' },
  });
  fs.closeSync(fd);
  let spawnError = null;
  child.on('error', error => { spawnError = error; });
  child.unref();
  if (child.pid) fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, rootId }));
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    const current = await health();
    if (current?.ok && current.rootId === rootId && current.pid === child.pid) {
      console.log('已启动：' + url + '\n关闭此终端或浏览器后服务仍会运行；停止请双击「停止服务.command」。');
      browse(); return;
    }
    if (current && current.rootId !== rootId) break;
    if (child.pid && !alive(child.pid)) break;
    await sleep(250);
  }
  const record = readRecord();
  if (owned(record) && record.pid === child.pid) process.kill(record.pid, 'SIGTERM');
  fs.rmSync(pidFile, { force: true });
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-12).join('\n') : '';
  throw new Error('启动未成功，请查看「查看日志.command」。\n' + lines);
}
async function stop() {
  const current = await health();
  const record = readRecord();
  let pid = null;
  if (current?.rootId === rootId) {
    pid = current.pid;
    const response = await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('停止请求未被接受，请查看日志后重试。');
  } else if (windows&&owned(record)) {
    throw new Error('服务暂未响应，请查看日志后重试；未强制终止，以保护数据库。');
  } else if (owned(record)) {
    pid = record.pid;
    process.kill(pid, 'SIGTERM');
  } else {
    fs.rmSync(pidFile, { force: true });
    console.log('本软件已停止。'); return;
  }
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(250);
  if (alive(pid)) throw new Error('进程仍在关闭，请稍后重试或查看日志；未强制终止，以保护数据库。');
  fs.rmSync(pidFile, { force: true }); console.log('已停止，数据库已关闭。');
}
let locked = false;
try {
  if (!((process.platform==='darwin'&&['arm64','x64'].includes(process.arch))||(windows&&process.arch==='x64'))) throw new Error('请选择适合当前电脑的 macOS ARM64、macOS Intel 或 Windows x64 包。');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('ZVEC_PORT 必须为 1024–65535 的整数。');
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (action === 'logs') {
    fs.closeSync(fs.openSync(logFile, 'a', 0o600));
    if(windows)execFileSync('notepad.exe',[logFile],{windowsHide:false});else execFileSync('/usr/bin/open',['-a','TextEdit',logFile]);
  } else {
    await lock(); locked = true;
    if (action === 'start') await start();
    else if (action === 'stop') await stop();
    else if (action === 'status') console.log(JSON.stringify(await health()));
    else throw new Error('未知操作：' + action);
  }
} catch (err) {
  console.error(err.message); process.exitCode = 1;
} finally {
  if (locked) fs.rmSync(lockDir, { recursive: true, force: true });
}
