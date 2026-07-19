// 场景数据定义
const SCENES = [
  {
    name: '校园生活',
    icon: 'campus',
    description: '校园咨询',
    welcome: '你好！我是爱·合师AI辅导员，可以帮你解答校园生活相关问题。',
    tabs: ['图书馆', '教室', '食堂', '常见问题']
  },
  {
    name: '技能提升',
    icon: 'skill',
    description: '师范生技能',
    welcome: '你好！我可以帮你提升师范生教学技能。',
    tabs: ['板书练习', '表达训练', '教资备考', '微课演练']
  },
  {
    name: '心理陪伴',
    icon: 'heart',
    description: '心理支持',
    welcome: '你好，我在这里陪着你。如果你愿意，可以和我聊聊。',
    tabs: ['情绪倾诉', '压力管理', '人际交往', '自我认知']
  },
  {
    name: '事务办理',
    icon: 'task',
    description: '校园事务',
    welcome: '你好！我可以帮你办理校园事务。',
    tabs: ['困难认定', '请假证明', '奖学金', '宿舍问题']
  }
];

// 危机关键词
const CRISIS_KEYS = ['不想活','没意思','活着没意思','活着没意义','活着有何意义','伤害自己','伤害自','撑不住','放弃生命','轻生','自杀','不想活了','活不下去','离开这个世界','没有意思'];

// AI回复逻辑
function getAIReply(scene, text) {
  const t = text;
  if(scene === 0){
    if(/图书馆|入馆|借阅|自习|座位/.test(t)) return { parts:[
      { type:'text', text:'图书馆周末 8:00–22:00 开放，凭校园卡入馆、无需预约；考试周延长至 23:00 并增设三楼通宵自习区。' },
      { type:'source', text:'来源：《合肥师范学院图书馆入馆须知》2024版' } ]};
    if(/教室|空教室|考研|上课/.test(t)) return { parts:[
      { type:'text', text:'实时空教室可在教学楼大厅屏幕或教务系统查询；考研自习区分布在图书馆三楼与公共教学楼。' } ]};
    if(/食堂|吃饭|窗口|夜宵/.test(t)) return { parts:[
      { type:'text', text:'校区设 3 个学生食堂，支持校园卡与移动支付，早餐 6:30 起、夜宵至 22:30。' } ]};
    if(/常见|其他问题|还有|问题/.test(t)) return { parts:[
      { type:'text', text:'常见问题包括：校园卡补办、成绩查询、奖助学金、自习室预约等，想了解哪个我帮你查～' } ]};
    return { parts:[{ type:'text', text:'我帮你查一下校本资料～稍等，核实后回复你。' }] };
  }
  if(scene === 1){
    if(/报名|提醒|训练营/.test(t)) return { parts:[
      { type:'text', text:'已设置每周三 17:30 提醒（课前1天推送）。' },
      { type:'source', text:'来源：教师教育学院·技能训练营安排' } ]};
    if(/再想想|再考虑|暂/.test(t)) return { parts:[
      { type:'text', text:'没关系，按自己的节奏来～想练的时候随时叫我。' } ]};
    if(/板书|表达|教资|师范|教学/.test(t)) return { parts:[
      { type:'card', title:'师范生教学基本功提升路径', body:'① 每周2次板书临摹（推荐《灵飞经》）\n② 加入周三晚师范生技能训练营\n③ 对镜/录像做5分钟微课演练\n预计周期：4 周' } ]};
    return { parts:[{ type:'text', text:'收到～说说你的专业和想提升的方向，我为你定制专属提升路径。' }] };
  }
  if(scene === 2){
    return { parts:[{ type:'text', text:'我在这里陪着你。愿意多说一点吗？如果现在很难受，随时点「紧急求助」，我都在。', coral:true }] };
  }
  if(scene === 3){
    if(/预填|申请表|表单/.test(t)) return { parts:[ makeFormPart() ] };
    if(/稍后|等会|以后/.test(t)) return { parts:[{ type:'text', text:'好的，随时可以回来找我预填。' }] };
    if(/困难|认定|助学|补助|材料/.test(t)) return { parts:[
      { type:'card', title:'家庭经济困难认定 · 4 步', body:'① 填《认定申请表》\n② 班级民主评议\n③ 学院审核\n④ 学校公示' } ]};
    if(/请假|证明|在读|打印/.test(t)) return { parts:[
      { type:'text', text:'在读证明 / 请假可在「今日校园」→「事务大厅」线上申请，辅导员审批后自助打印。' } ]};
    return { parts:[{ type:'text', text:'好的，告诉我你想办理的事项，我帮你梳理流程并预填表单。' }] };
  }
  return { parts:[{ type:'text', text:'我帮你查一下～' }] };
}

// 检测危机关键词
function isCrisis(text) {
  return CRISIS_KEYS.some(k => text.indexOf(k) !== -1);
}

// 生成表单HTML
function makeFormPart() {
  return {
    type: 'form',
    html: `
      <div class="ai-form">
        <div class="field">
          <label>姓名</label>
          <input type="text" placeholder="请输入姓名">
        </div>
        <div class="field">
          <label>学号</label>
          <input type="text" placeholder="请输入学号">
        </div>
        <div class="field">
          <label>学院</label>
          <select>
            <option value="">请选择学院</option>
            <option value="1">教师教育学院</option>
            <option value="2">文学院</option>
            <option value="3">数学与统计学院</option>
            <option value="4">外国语学院</option>
          </select>
        </div>
        <button class="submit" type="button">提交预填</button>
      </div>
    `
  };
}