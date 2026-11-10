import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync,openSync,readFileSync,mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const developmentSecret = 'super_secret_jwt_key_orderledger_dev_mode';
const exampleSecret = 'super_secret_jwt_key_orderledger_production_change_me';
const compiled = import.meta.url.endsWith('.js');
const configUrl = new URL(compiled ? '../config/env.js' : '../config/env.ts', import.meta.url).href;

function loadConfig(input: { environment?: string; secret?: string; dotenvSecret?: string }) {
  const tempRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(tempRoot, 'orderledger-config-test-'));
  const expectedPrefix = resolve(tempRoot) + sep + 'orderledger-config-test-';
  if (!resolve(directory).startsWith(expectedPrefix)) throw new Error('Unexpected configuration test directory');
  // Never inherit JWT_SECRET, DATABASE_URL, DOTENV_CONFIG_PATH, or any other user credential.
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  if (input.environment !== undefined) environment.NODE_ENV = input.environment;
  if (input.secret !== undefined) environment.JWT_SECRET = input.secret;
  try {
    if (input.dotenvSecret !== undefined) writeFileSync(join(directory, '.env'), `JWT_SECRET=${input.dotenvSecret}\n`, 'utf8');
    const script = `try {
      const { config } = await import(${JSON.stringify(configUrl)});
      process.stdout.write(JSON.stringify({ environment: config.env,
        usesConfiguredSecret: config.jwtSecret === process.env.JWT_SECRET,
        usesDevelopmentFallback: config.jwtSecret === ${JSON.stringify(developmentSecret)} }));
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : 'Configuration rejected');
      process.exitCode = 1;
    }`;
    const stdoutPath=join(directory,'stdout'),stderrPath=join(directory,'stderr');
    const stdoutFd=openSync(stdoutPath,'w'),stderrFd=openSync(stderrPath,'w');
    let result;
    try {result = spawnSync(process.execPath, [...(compiled ? [] : ['--import', import.meta.resolve('tsx')]), '--input-type=module', '--eval', script], {
      cwd: directory, env: environment, stdio: ['ignore',stdoutFd,stderrFd], timeout: 20000, windowsHide: true
    });} finally {closeSync(stdoutFd);closeSync(stderrFd);}
    assert.equal(result.error, undefined, 'The isolated configuration subprocess must finish');
    return { status: result.status, stdout: readFileSync(stdoutPath,'utf8'), stderr: readFileSync(stderrPath,'utf8') };
  } finally {
    // Only this newly created, validated temporary directory is removed.
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectRejected(secret?: string, dotenvSecret?: string) {
  const result = loadConfig({ environment: 'production', secret, dotenvSecret });
  assert.equal(result.status, 1, 'Production must reject an unsafe JWT secret');
  assert.match(result.stderr, /JWT_SECRET/);
  assert.equal(result.stdout, '');
  for (const value of [secret, dotenvSecret]) {
    if (value && value.trim().length > 0) assert.equal(result.stderr.includes(value), false, 'A rejection must never echo the supplied secret');
  }
}

test('production rejects missing, empty and short JWT secrets when no user dotenv file is available', () => {
  for (const secret of [undefined, '', 'short-test-value']) expectRejected(secret);
});

test('production rejects both repository JWT placeholders and common example markers', () => {
  for (const secret of [developmentSecret, exampleSecret, 'replace-with-a-random-secret-before-production', 'EXAMPLE_jwt_key_that_is_long_enough_for_the_length_check']) {
    expectRejected(secret);
  }
});

test('production rejects whitespace and single-character repetition instead of treating length alone as strength', () => {
  expectRejected('X'.repeat(64));
  expectRejected(` ${randomBytes(32).toString('hex')}`);
  expectRejected(`${randomBytes(16).toString('hex')} ${randomBytes(16).toString('hex')}`);
});

test('production accepts sufficiently long generated secrets unchanged, including Render-compatible values', () => {
  for (const secret of [randomBytes(16).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('base64url')]) {
    const result = loadConfig({ environment: 'production', secret });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { environment: 'production', usesConfiguredSecret: true, usesDevelopmentFallback: false });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(secret), false);
  }
});

test('production validates only the isolated dotenv fixture when a secret is loaded from a file', () => {
  expectRejected(undefined, exampleSecret);
  const secret = randomBytes(32).toString('hex');
  const result = loadConfig({ environment: 'production', dotenvSecret: secret });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).usesConfiguredSecret, true);
  assert.equal(result.stdout.includes(secret), false);
});

test('development and test configuration retain their existing fallback and explicit secret behavior', () => {
  for (const environment of [undefined, 'development', 'test']) {
    const result = loadConfig({ environment });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).usesDevelopmentFallback, true);
  }
  const configured = loadConfig({ environment: 'development', secret: 'local-only-test-secret' });
  assert.equal(configured.status, 0);
  assert.equal(JSON.parse(configured.stdout).usesConfiguredSecret, true);
});
