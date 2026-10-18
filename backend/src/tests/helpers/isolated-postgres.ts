import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:net';

/** Tests never read DATABASE_URL or reuse the application's database. */
export async function startIsolatedPostgres() {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'orderledger-test-'));
  const resolvedDirectory = resolve(directory);
  if (!resolvedDirectory.startsWith(resolve(tempRoot) + sep + 'orderledger-test-')) {
    throw new Error('Refusing to initialize PostgreSQL outside its disposable test directory');
  }
  const listener = createServer();
  await new Promise<void>((done, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', done);
  });
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  const Postgres = (EmbeddedPostgres as any).default ?? EmbeddedPostgres;
  const logs: string[] = [];
  const postgres = new Postgres({
    databaseDir: directory,
    user: 'postgres',
    password: 'disposable-test-password',
    port,
    // We clean up with bounded retries: Windows can briefly retain a stopped process's files.
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: (line: unknown) => { logs.push(String(line)); },
    onError: (line: unknown) => { logs.push(String(line)); }
  });
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase('orderledger_test');
  } catch (error) {
    throw new Error(`Disposable PostgreSQL failed: ${String(error)}\n${logs.slice(-12).join('\n')}`);
  }
  const url = `postgresql://postgres:disposable-test-password@127.0.0.1:${port}/orderledger_test`;
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = 'isolated-orderledger-test-secret-not-for-deployment';
  return { url, stop: async () => {
    await postgres.stop();
    if (!resolvedDirectory.startsWith(resolve(tempRoot) + sep + 'orderledger-test-')) throw new Error('Unsafe test cleanup path');
    await rm(resolvedDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } };
}
