const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { getCareerTrack } = require('../js/profile');

const TRACKS = {
  freshman: {
    version: '探索版',
    topics: ['专业认知', '兴趣与优势探索', '大学目标制定', '校园资源推荐', '生涯人物访谈'],
    tabs: ['专业认知', '优势探索', '大学目标', '资源推荐'],
  },
  sophomore: {
    version: '定位版',
    topics: ['职业方向探索', '能力差距分析', '竞赛与项目建议', '考研考公就业初步比较', '学期能力提升计划'],
    tabs: ['职业方向', '能力差距', '竞赛项目', '路径比较'],
  },
  junior: {
    version: '行动版',
    topics: ['实习推荐与准备', '简历素材积累', '岗位能力训练', '考研院校与方向分析', '模拟面试'],
    tabs: ['实习准备', '简历素材', '院校方向', '模拟面试'],
  },
  senior: {
    version: '冲刺版',
    topics: ['招聘信息分析', '简历精准修改', '面试训练', '升学复试', 'Offer与就业选择', '未就业学生重点帮扶'],
    tabs: ['招聘分析', '简历修改', '升学复试', '就业选择'],
  },
};

for (const [grade, expected] of Object.entries(TRACKS)) {
  test(`${grade}返回对应年级的学业与生涯服务`, () => {
    assert.deepEqual(getCareerTrack(grade), {
      ...expected,
      welcome: `你好，这里是${expected.version}学业与生涯服务。告诉我你的专业、目标和当前困难，我们从一个可执行的步骤开始。`,
    });
  });
}

test('空值和非法年级精确回退到通用版', () => {
  const expected = {
    version: '通用版',
    welcome: '你好！告诉我你的年级、专业和当前目标，我可以协助你规划学习、升学、竞赛、实习或就业。',
    topics: [],
    tabs: ['课程学习', '升学备考', '竞赛科研', '实习就业'],
  };

  for (const grade of [undefined, null, '', 'graduate', 'toString', 'constructor', '__proto__', 1]) {
    assert.deepEqual(getCareerTrack(grade), expected);
  }
});

test('每次调用返回相互隔离的对象和数组', () => {
  const first = getCareerTrack('freshman');
  const second = getCareerTrack('freshman');

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.topics, second.topics);
  assert.notStrictEqual(first.tabs, second.tabs);

  first.version = '已修改';
  first.topics.push('污染项');
  first.tabs[0] = '已污染';

  assert.deepEqual(getCareerTrack('freshman'), {
    ...TRACKS.freshman,
    welcome: '你好，这里是探索版学业与生涯服务。告诉我你的专业、目标和当前困难，我们从一个可执行的步骤开始。',
  });
});

test('浏览器环境只暴露getCareerTrack且可正常调用', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/profile.js'), 'utf8');
  const context = {};

  vm.runInNewContext(source, context);

  assert.equal(typeof context.getCareerTrack, 'function');
  assert.equal(context.CAREER_TRACKS, undefined);
  assert.equal(context.getCareerTrack('senior').version, '冲刺版');
});
