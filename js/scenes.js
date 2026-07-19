// 场景展示数据和网络失败时的安全兜底。
const SCENES = [
  {
    name: '校园生活',
    icon: 'campus',
    description: '校园咨询',
    welcome: '你好！我可以帮你查找校园场所、生活服务和安全信息。具体时间与流程会先核验学校官方来源。',
    tabs: ['图书馆', '教室', '食堂', '宿舍']
  },
  {
    name: '学业与生涯成长',
    icon: 'growth',
    description: '学业与生涯',
    welcome: '你好！告诉我你的年级、专业和当前目标，我可以协助你规划学习、升学、竞赛、实习或就业。',
    tabs: ['课程学习', '升学备考', '竞赛科研', '实习就业']
  },
  {
    name: '心理陪伴',
    icon: 'heart',
    description: '心理支持',
    welcome: '你好，我会认真听你说。你可以从情绪、压力、人际、睡眠或学习困扰谈起；如果涉及现实危险，请立即使用紧急求助。',
    tabs: ['情绪倾诉', '压力调节', '人际关系', '睡眠困扰']
  },
  {
    name: '事务办理',
    icon: 'task',
    description: '校园事务',
    welcome: '你好！我可以帮你核验奖助、证明、评优、党团、学籍和教务事项的官方办理要求。',
    tabs: ['奖助学金', '证明开具', '学籍教务', '评优党团']
  }
];

const CRISIS_KEYS = [
  '想死', '去死', '不想活', '活不下去', '结束生命', '结束自己的生命',
  '自杀', '轻生', '自残', '自伤', '割腕', '跳楼', '跳河', '跳桥',
  '上吊', '服毒', '吞药', '伤害自己', '伤害他人', '杀了他', '杀了她',
  '离开这个世界', '放弃生命', 'suicide', 'killmyself', 'endmylife', 'hurtmyself'
];

function getAIReply(scene) {
  if (scene === 0) {
    return { parts: [{
      type: 'text',
      text: '当前暂时无法核验学校最新的场所与生活信息。请稍后重试，或通过合肥师范学院官网查询对应部门的最新通知。'
    }] };
  }
  if (scene === 1) {
    return { parts: [{
      type: 'text',
      text: '当前服务暂时不可用。你可以先记录自己的年级、专业、目标和最想解决的一个问题，稍后重试后我会据此提供学业与生涯建议。'
    }] };
  }
  if (scene === 2) {
    return { parts: [{
      type: 'text',
      coral: true,
      text: '当前对话服务暂时不可用。如果你正处于危险中，请不要独处，立即联系身边可信任的人，并拨打110、120、12356或0551-63666903寻求现实帮助。'
    }] };
  }
  if (scene === 3) {
    return { parts: [{
      type: 'text',
      text: '当前暂时无法核验学校最新办事要求。请稍后重试，或先查看合肥师范学院官网对应部门发布的正式通知。'
    }] };
  }
  return { parts: [{ type: 'text', text: '当前服务暂时不可用，请稍后重试。' }] };
}

function isCrisis(text) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, '');
  return CRISIS_KEYS.some(keyword => normalized.includes(keyword));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CRISIS_KEYS, SCENES, getAIReply, isCrisis };
}
