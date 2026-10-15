// 自动加载项目根目录的 .env —— 在 server.mjs 的第一行 import 本模块,
// 保证「npm start / start.cmd / 托盘 zvec-live-tray.exe」三种启动方式配置一致,
// 都无需手动加 --env-file。(Node 20.6+ 的 --env-file 需显式传入;这里统一自动加载。)
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '.env');

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFile);
  }
} catch {
  // .env 不存在时静默忽略,沿用系统环境变量与 data/settings.json
}
