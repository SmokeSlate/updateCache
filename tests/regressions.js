const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function properties(seed = {}) {
  const data = { ...seed };
  return { data, getProperty: key => data[key] || null,
    setProperty(key, value) { data[key] = value; },
    deleteProperty(key) { delete data[key]; },
    setProperties(values, clear) { if (clear) Object.keys(data).forEach(key => delete data[key]); Object.assign(data, values); } };
}
const log = JSON.stringify([{ status: 'success', timestamp: '2026-01-01' }]);
const script = properties({ RUN_LOG: log, UNRELATED: 'keep' });
const user = properties();
const calls = [];
const context = vm.createContext({
  PropertiesService: { getScriptProperties: () => script, getUserProperties: () => user },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger() { return { timeBased() { return this; }, everyHours() { return this; }, create() {} }; } },
  UrlFetchApp: { fetch(url, options) {
    calls.push({ url, options });
    return { getResponseCode: () => options && options.method === 'get' ? 404 : 200, getContentText: () => '{"version":1}' };
  } },
  Utilities: { base64Encode: value => Buffer.from(value).toString('base64') },
  Logger: { log() {} },
});
const root = path.join(__dirname, '..');
vm.runInContext(fs.readFileSync(path.join(root, 'gScript/Code.gs'), 'utf8'), context);
const saved = context.saveSettings({ owner: 'test', repo: 'test', folder: 'cache', token: 'synthetic', manualShortcuts: ['1'] });
assert.equal(script.data.RUN_LOG, log);
assert.equal(script.data.UNRELATED, 'keep');
assert.equal(saved.runLog.length, 1);
for (const folder of ['folder#part', 'folder?part', 'space here', '日本語', 'one/two #?']) {
  calls.length = 0;
  context.uploadShortcutsToGitHub('owner', 'repo', folder, ['1'], 'synthetic');
  const urls = calls.filter(call => call.url.includes('api.github.com'));
  assert.equal(urls.length, 2);
  for (const call of urls) {
    const url = new URL(call.url);
    assert.equal(url.hash, '');
    assert.equal(url.search, '');
    assert.equal(decodeURIComponent(url.pathname), '/repos/owner/repo/contents/' + folder + '/1.txt');
  }
}
calls.length = 0;
assert.throws(() => context.uploadShortcutsToGitHub('owner', 'repo', 'cache', ['1', '../bad'], 'synthetic'), /only digits/);
assert.equal(calls.length, 0);
const value = { folder: '</script><p>benign marker</p>', other: '<>&"\u2028\u2029' };
const serialized = context.serializeSettingsForScript(value);
assert(!serialized.includes('<'));
assert.deepEqual(JSON.parse(serialized), value);
const template = fs.readFileSync(path.join(root, 'gScript/Setup.html'), 'utf8');
assert(template.includes('<?!= serializeSettingsForScript(initialSettings) ?>'));
const rendered = template.replace('<?!= serializeSettingsForScript(initialSettings) ?>', serialized);
const scripts = [...rendered.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
assert(scripts.length > 0);
for (const [, source] of scripts) new vm.Script(source);
context.resetSetup();
assert.equal(script.data.RUN_LOG, undefined);
assert.equal(script.data.UNRELATED, 'keep');
console.log('PASS: saved history, reset, encoded URLs, invalid IDs, script-safe round trip');
