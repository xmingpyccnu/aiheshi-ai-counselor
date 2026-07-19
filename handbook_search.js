const handbook = require('./data/student_handbook.json');

const STOP_WORDS = new Set([
  '什么', '怎么', '如何', '需要', '可以', '是否', '学生', '本科生', '规定',
  '学校', '合肥', '师范学院', '一个', '一下', '关于', '受到', '之后',
]);

const EXPANSIONS = [
  ['转专业', ['转专业', '专业调整', '普通本科学生转专业']],
  ['休学', ['休学', '复学', '保留学籍']],
  ['复学', ['复学', '休学', '保留学籍']],
  ['退学', ['退学', '学籍处理', '申诉']],
  ['奖学金', ['奖学金', '评定', '评审']],
  ['助学金', ['助学金', '家庭经济困难', '资助']],
  ['困难认定', ['家庭经济困难学生认定', '困难认定', '资助']],
  ['处分解除', ['违纪处分解除', '处分解除', '解除办法']],
  ['违纪', ['违纪处分', '纪律处分', '申诉']],
  ['宿舍', ['学生公寓', '宿舍', '住宿']],
  ['公寓', ['学生公寓', '宿舍', '住宿']],
  ['第二课堂', ['第二课堂', '素质教育']],
  ['团籍', ['团员团籍', '团籍处理']],
  ['入党', ['入党积极分子', '发展党员', '推优']],
  ['借书', ['图书馆借书', '借阅', '一卡通']],
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function queryTerms(query) {
  const terms = [];
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  for (const item of segmenter.segment(query)) {
    const word = item.segment.trim().toLowerCase();
    if (item.isWordLike && word.length >= 2 && !STOP_WORDS.has(word)) terms.push(word);
  }
  for (const [trigger, related] of EXPANSIONS) {
    if (query.includes(trigger)) terms.push(...related.map(normalize));
  }
  return [...new Set(terms.map(normalize).filter(term => term.length >= 2))];
}

function countOccurrences(text, term) {
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(term, position)) !== -1) {
    count += 1;
    position += term.length;
  }
  return count;
}

function excerptFor(page, terms) {
  const compact = page.text.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const normalizedText = normalize(compact);
  const matchedTerm = terms.find(term => normalizedText.includes(term));
  if (!matchedTerm || compact.length <= 700) return compact.slice(0, 700);

  const rawIndex = compact.toLowerCase().indexOf(matchedTerm);
  const start = Math.max(0, rawIndex - 160);
  const end = Math.min(compact.length, start + 700);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function contextForDocument(page, terms, includeAdjacentPages) {
  if (!includeAdjacentPages) {
    return `[手册第${page.printedPage}页]\n${excerptFor(page, terms)}`;
  }

  const candidates = handbook.pages.filter(candidate =>
    candidate.documentTitle === page.documentTitle &&
    [page.documentStartPage, page.printedPage, page.printedPage + 1].includes(candidate.printedPage)
  );
  const uniquePages = [...new Map(candidates.map(candidate => [candidate.printedPage, candidate])).values()]
    .sort((a, b) => a.printedPage - b.printedPage);

  return uniquePages.map(candidate =>
    `[手册第${candidate.printedPage}页]\n${excerptFor(candidate, terms)}`
  ).join('\n');
}

function searchHandbook(rawQuery, limit = 4) {
  const query = normalize(rawQuery);
  if (!query) return '请输入要检索的问题。';
  const terms = queryTerms(query);
  if (!terms.length) terms.push(query);

  const ranked = handbook.pages
    .filter(page => page.printedPage && page.text)
    .map(page => {
      const title = normalize(page.documentTitle);
      const text = normalize(page.text);
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 80 + term.length * 4;
        score += Math.min(countOccurrences(text, term), 8) * (term.length + 2);
      }
      if (text.includes(query)) score += 120;
      return { page, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page.pdfPage - b.page.pdfPage);

  const selected = [];
  const seenDocuments = new Set();
  for (const item of ranked) {
    const key = item.page.documentTitle;
    if (seenDocuments.has(key)) continue;
    seenDocuments.add(key);
    selected.push(item.page);
    if (selected.length >= Math.max(1, Math.min(limit, 6))) break;
  }

  if (!selected.length) {
    return `未在《${handbook.sourceTitle}》中找到与“${rawQuery}”直接对应的依据。该手册为2023年7月版本，请继续核验学校最新通知。`;
  }

  const results = selected.map((page, index) => {
    const startPdfPage = page.documentStartPage + 6;
    return `${index + 1}. 制度:${page.documentTitle}\n` +
      `   位置:手册第${page.documentStartPage}页起，PDF第${startPdfPage}页起；本次命中手册第${page.printedPage}页（PDF第${page.pdfPage}页）\n` +
      `   原文片段:\n${contextForDocument(page, terms, index === 0)}`;
  });

  return `《${handbook.sourceTitle}》检索结果（2023年7月版本）:\n\n${results.join('\n\n')}\n\n` +
    '使用提醒:手册内容可能已被后续文件调整；涉及当前时间、金额、入口或联系方式时，必须继续核验学校最新正式通知。';
}

module.exports = { queryTerms, searchHandbook };
