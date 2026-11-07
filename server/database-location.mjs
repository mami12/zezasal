import { isAbsolute, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const project = fileURLToPath(new URL('../', import.meta.url));
export const maintenancePath = (rootDir = project) => resolve(rootDir, '.runtime', 'database-maintenance.lock');
export function assertNoDatabaseMaintenance(rootDir = project) {
  if (existsSync(maintenancePath(rootDir))) throw new Error('Database migration or backup is in progress. Wait for it to finish before starting the server. See LOCAL-DATABASE.md if it was interrupted.');
}
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')));
};

/** Local financial files must live outside every folder served or built as web content. */
export function localDatabaseDirectory(value = 'data/database', rootDir = project) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || /^[a-z]+:\/\//i.test(value)) {
    throw new Error('LOCAL_DATABASE_DIR must be a persistent filesystem folder.');
  }
  const directory = resolve(rootDir, value);
  if (directory === parse(directory).root || inside(directory, resolve(rootDir)) ||
      ['web', 'docs', '.git', 'node_modules', 'server', 'scripts'].some(folder => inside(resolve(rootDir, folder), directory))) {
    throw new Error('LOCAL_DATABASE_DIR must be a dedicated data folder outside web, docs and source folders.');
  }
  return directory;
}
