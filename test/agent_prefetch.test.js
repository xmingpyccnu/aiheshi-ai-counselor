const test = require('node:test');
const assert = require('node:assert/strict');

const { prepareMessages, shouldPrefetchHandbook } = require('../agent');

test('事务问题会在模型调用前强制检索学生手册', () => {
  const messages = prepareMessages(3, [
    { role: 'user', content: '本科生申请转专业需要满足什么条件？' },
  ]);
  const context = messages.at(-1).content;

  assert.match(context, /系统强制预检索/);
  assert.match(context, /合肥师范学院普通本科学生转专业实施办法/);
  assert.match(context, /手册第55页/);
  assert.match(context, /PDF第61页/);
  assert.match(context, /就读满一学期/);
  assert.match(context, /待回答的原始问题/);
  assert.match(context, /不得用通用办事模板取代/);
});

test('心理对话不注入无关学生手册内容', () => {
  const messages = prepareMessages(2, [
    { role: 'user', content: '我最近睡不好，压力很大' },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(shouldPrefetchHandbook(2, '学籍问题'), false);
});

test('校园与成长模块只在命中制度类关键词时预检索', () => {
  assert.equal(shouldPrefetchHandbook(0, '宿舍违规电器怎么处理'), true);
  assert.equal(shouldPrefetchHandbook(1, '课程重修有什么规定'), true);
  assert.equal(shouldPrefetchHandbook(1, '我想提高英语口语'), false);
});
