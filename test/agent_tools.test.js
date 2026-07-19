const test = require('node:test');
const assert = require('node:assert/strict');

const {
  get_current_time,
  isBlockedAddress,
  parseAndExecTools,
  resolvePending,
  validateExternalUrl,
} = require('../agent_tools');

test('网页抓取拒绝本机、私网和链路本地IPv4地址', async () => {
  const blocked = [
    'http://127.0.0.1:3001',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://0.0.0.0',
  ];

  for (const url of blocked) {
    await assert.rejects(() => validateExternalUrl(url), /不允许访问/);
  }
});

test('网页抓取拒绝本地主机名、URL凭据和非HTTP协议', async () => {
  await assert.rejects(() => validateExternalUrl('http://localhost'), /不允许访问/);
  await assert.rejects(() => validateExternalUrl('http://service.local'), /不允许访问/);
  await assert.rejects(() => validateExternalUrl('http://user:pass@example.com'), /凭据/);
  await assert.rejects(() => validateExternalUrl('file:///etc/passwd'), /HTTP/);
  await assert.rejects(() => validateExternalUrl('ftp://example.com/file'), /HTTP/);
});

test('地址分类只允许公开单播地址', () => {
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('1.1.1.1'), false);
  assert.equal(isBlockedAddress('127.0.0.1'), true);
  assert.equal(isBlockedAddress('::1'), true);
  assert.equal(isBlockedAddress('fc00::1'), true);
  assert.equal(isBlockedAddress('fe80::1'), true);
  assert.equal(isBlockedAddress('2001:4860:4860::8888'), false);
});

test('北京时间中的日期、星期和时间来自同一时区', () => {
  const result = get_current_time(new Date('2026-07-20T06:30:00Z'));
  assert.equal(result, '2026年7月20日 星期一 14:30 CST');
});

test('北京时间跨日时使用北京时间对应的星期', () => {
  const result = get_current_time(new Date('2026-07-19T18:30:00Z'));
  assert.equal(result, '2026年7月20日 星期一 02:30 CST');
});

test('解析并执行学生手册检索工具', async () => {
  const { toolResults, remainingText } = parseAndExecTools(
    '<tool_call><name>search_handbook</name><query>转专业条件</query></tool_call>'
  );
  await resolvePending(toolResults);
  assert.equal(remainingText, '');
  assert.equal(toolResults[0].name, 'search_handbook');
  assert.match(toolResults[0].result, /普通本科学生转专业实施办法/);
  assert.match(toolResults[0].result, /2023合师学生手册/);
});
