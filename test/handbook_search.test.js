const test = require('node:test');
const assert = require('node:assert/strict');

const { searchHandbook } = require('../handbook_search');

test('转专业问题命中校内转专业办法及起始页', () => {
  const result = searchHandbook('本科生转专业需要什么条件');
  assert.match(result, /合肥师范学院普通本科学生转专业实施办法/);
  assert.match(result, /手册第55页/);
  assert.match(result, /PDF第61页/);
});

test('奖助问题命中对应评定办法', () => {
  const result = searchHandbook('国家奖学金的评定条件是什么');
  assert.match(result, /合肥师范学院国家奖学金评定办法/);
  assert.match(result, /手册第121页/);
});

test('宿舍问题命中公寓住宿管理办法', () => {
  const result = searchHandbook('学生宿舍住宿管理规定');
  assert.match(result, /合肥师范学院学生公寓住宿管理办法/);
  assert.match(result, /手册第187页/);
});

test('违纪处分问题命中处分办法', () => {
  const result = searchHandbook('学生受到违纪处分后如何解除');
  assert.match(result, /合肥师范学院学生违纪处分解除办法/);
  assert.match(result, /手册第185页/);
});

test('空查询不会返回整本手册', () => {
  assert.match(searchHandbook(''), /请输入要检索的问题/);
});
