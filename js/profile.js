(function exposeCareerProfile(root) {
  'use strict';

  const DEFAULT_TRACK = Object.freeze({
    version: '通用版',
    welcome: '你好！告诉我你的年级、专业和当前目标，我可以协助你规划学习、升学、竞赛、实习或就业。',
    topics: Object.freeze([]),
    tabs: Object.freeze(['课程学习', '升学备考', '竞赛科研', '实习就业']),
  });

  const CAREER_TRACKS = Object.freeze({
    freshman: Object.freeze({
      version: '探索版',
      topics: Object.freeze(['专业认知', '兴趣与优势探索', '大学目标制定', '校园资源推荐', '生涯人物访谈']),
      tabs: Object.freeze(['专业认知', '优势探索', '大学目标', '资源推荐']),
    }),
    sophomore: Object.freeze({
      version: '定位版',
      topics: Object.freeze(['职业方向探索', '能力差距分析', '竞赛与项目建议', '考研考公就业初步比较', '学期能力提升计划']),
      tabs: Object.freeze(['职业方向', '能力差距', '竞赛项目', '路径比较']),
    }),
    junior: Object.freeze({
      version: '行动版',
      topics: Object.freeze(['实习推荐与准备', '简历素材积累', '岗位能力训练', '考研院校与方向分析', '模拟面试']),
      tabs: Object.freeze(['实习准备', '简历素材', '院校方向', '模拟面试']),
    }),
    senior: Object.freeze({
      version: '冲刺版',
      topics: Object.freeze(['招聘信息分析', '简历精准修改', '面试训练', '升学复试', 'Offer与就业选择', '未就业学生重点帮扶']),
      tabs: Object.freeze(['招聘分析', '简历修改', '升学复试', '就业选择']),
    }),
  });

  function getCareerTrack(grade) {
    const isKnownGrade = typeof grade === 'string'
      && Object.prototype.hasOwnProperty.call(CAREER_TRACKS, grade);
    const track = isKnownGrade ? CAREER_TRACKS[grade] : DEFAULT_TRACK;
    const welcome = track === DEFAULT_TRACK
      ? track.welcome
      : `你好，这里是${track.version}学业与生涯服务。告诉我你的专业、目标和当前困难，我们从一个可执行的步骤开始。`;

    return {
      version: track.version,
      welcome,
      topics: [...track.topics],
      tabs: [...track.tabs],
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCareerTrack };
  } else if (root) {
    root.getCareerTrack = getCareerTrack;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
