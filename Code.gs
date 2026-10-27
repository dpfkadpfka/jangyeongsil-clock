/**
 * 그림 시계 공방 — 서버 (구글 앱스 스크립트)
 * 만든 사람: 김예람
 *
 * 하는 일
 *  - 아이 그림 → 제미나이(나노 바나나)로 정면 시계 사진 만들기
 *  - 만든 시계의 시계판 가운데 찾기(바늘 위치)
 *  - 전시관 저장(구글 드라이브 + 시트), 좋아요, 댓글
 *
 * 제미나이 키는 이 파일 안에만 있어서 아이들 태블릿에는 보이지 않아요.
 */

// ▼ 제미나이 API 키는 [프로젝트 설정 → 스크립트 속성]에 이름 GEMINI_API_KEY 로 넣어요(코드에 쓰지 않아요)
function key_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }

// ▼ 필요하면 바꿔요
const IMAGE_MODEL = 'gemini-nano-banana-2.1'; // 나노 바나나 2.1 (그림 → 시계 사진)
const TEXT_MODEL = 'gemini-flash-latest';     // 시계판 가운데 찾기
const MAX_MAKE_PER_DAY = 150;                 // 하루에 만들 수 있는 시계 수 (요금 보호)

const CLOCK_PROMPT = [
  '첨부한 그림은 초등학교 2학년 학생이 설계한 시계예요. 이 디자인 그대로, 실제로 공장에서 만든 시계처럼 보이는 제품 사진으로 만들어 주세요.',
  '반드시 지킬 것:',
  '1. 정면: 시계를 바로 앞에서 똑바로 찍은 모습. 비스듬한 구도, 위나 옆에서 본 모습, 원근 왜곡은 안 됨.',
  '2. 바늘 없음: 시침, 분침, 초침을 절대 그리지 말 것. 시계판 한가운데에는 작은 동그란 축 하나만.',
  '3. 배경: 아무것도 없는 순수한 흰색(#FFFFFF). 탁자, 벽, 손, 바닥 그림자 없음.',
  '4. 구도: 시계 전체가 잘리지 않고 사진 한가운데에 오도록. 정사각형.',
  '5. 디자인 유지: 학생 그림의 모양, 캐릭터, 색깔, 꾸밈(별, 달, 하트 등)을 최대한 살릴 것.',
  '6. 숫자: 1부터 12까지 진짜 시계처럼 바른 자리에 또렷하게. 12는 맨 위, 3은 오른쪽, 6은 맨 아래, 9는 왼쪽. 학생이 숫자를 틀리게 썼어도 바르게 고칠 것.',
  '7. 그림 옆에 쓴 설명 글이나 이름은 시계에 넣지 말 것.'
].join('\n');

const DIGITAL_PROMPT = [
  '첨부한 그림은 초등학교 2학년 학생이 설계한 디지털시계예요. 이 디자인 그대로, 실제로 공장에서 만든 디지털시계처럼 보이는 제품 사진으로 만들어 주세요.',
  '반드시 지킬 것:',
  '1. 정면: 시계를 바로 앞에서 똑바로 찍은 모습. 비스듬한 구도, 위나 옆에서 본 모습, 원근 왜곡은 안 됨.',
  '2. 빈 화면: 숫자가 나오는 디지털 화면(액정)은 가로로 긴 직사각형 하나로, 짙은 색(검정이나 짙은 남색)의 아무것도 없는 빈 화면으로 그릴 것. 화면 안에 숫자, 콜론(:), 글자, 오전·오후 표시를 절대 넣지 말 것.',
  '3. 화면 크기: 빈 화면은 시계 앞면에서 크고 또렷하게, 다른 꾸밈에 가려지지 않게.',
  '4. 배경: 아무것도 없는 순수한 흰색(#FFFFFF). 탁자, 벽, 손, 바닥 그림자 없음.',
  '5. 구도: 시계 전체가 잘리지 않고 사진 한가운데에 오도록. 정사각형.',
  '6. 디자인 유지: 학생 그림의 모양, 캐릭터, 색깔, 꾸밈(별, 달, 하트 등)을 최대한 살릴 것.',
  '7. 그림 옆에 쓴 설명 글이나 이름은 시계에 넣지 말 것. 바늘시계 숫자판이나 바늘도 그리지 말 것.'
].join('\n');

const SCREEN_PROMPT = 'This is a product photo of a digital clock whose display screen is empty. Find that empty display screen (the dark rectangle where the digits will be shown). ' +
  'Return JSON only: {"x":0-1,"y":0-1,"w":0-1,"h":0-1} = left, top, width, height of the screen as fractions of image width and height.';

const DIAL_PROMPT = 'This is a product photo of a clock (no hands). Find the clock dial where hands would rotate: the circle that has the numbers 1-12 around it. ' +
  'Return JSON only: {"cx":0-1,"cy":0-1,"r":0-1} where cx,cy are the dial center as fractions of image width/height, ' +
  'and r is the distance from the center to the ring of numbers, as a fraction of image width.';

/* ---------- 처음 한 번 실행: 저장 폴더와 시트 만들기 ---------- */
function setup() {
  const s = store_();
  Logger.log('준비 완료! 폴더: ' + s.folder.getUrl());
  Logger.log('시트: ' + s.ss.getUrl());
}

function store_() {
  const P = PropertiesService.getScriptProperties();
  let folder, ss;
  try { folder = DriveApp.getFolderById(P.getProperty('FOLDER_ID')); } catch (e) { folder = null; }
  if (!folder) { folder = DriveApp.createFolder('그림 시계 전시관'); P.setProperty('FOLDER_ID', folder.getId()); }
  try { ss = SpreadsheetApp.openById(P.getProperty('SHEET_ID')); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('그림 시계 전시관 목록');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    const c = ss.getSheets()[0]; c.setName('clocks');
    c.appendRow(['id', '올린 시각', '만든 사람', '시계 이름', '특징', 'drawingId', 'clockId', 'cx', 'cy', 'r', 'hand', 'bg', 'device', '숨기기(Y)', 'kind', 'bx', 'by', 'bw', 'bh', '반', '번호']);
    ss.insertSheet('likes').appendRow(['clockId', 'device', '시각']);
    ss.insertSheet('comments').appendRow(['clockId', '이름', '댓글', '시각', 'device']);
    P.setProperty('SHEET_ID', ss.getId());
  }
  return { folder: folder, ss: ss };
}

/* ---------- 웹 요청 ---------- */
function doGet() { return json_({ ok: true, msg: '그림 시계 서버가 켜져 있어요.' }); }

function doPost(e) {
  try {
    const q = JSON.parse(e.postData.contents || '{}');
    switch (q.action) {
      case 'make': return json_(make_(q));
      case 'save': return json_(save_(q));
      case 'list': return json_(list_(q));
      case 'img': return json_(img_(q));
      case 'like': return json_(like_(q));
      case 'comment': return json_(comment_(q));
      default: return json_({ ok: false, error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
const str_ = (v, n) => String(v == null ? '' : v).slice(0, n);
const num_ = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const b64ok_ = s => typeof s === 'string' && s.length < 3500000 && /^[A-Za-z0-9+/=]+$/.test(s);

/* ---------- 1) 그림 → 시계 사진 ---------- */
function make_(q) {
  if (!key_()) return { ok: false, error: '선생님: 스크립트 속성에 GEMINI_API_KEY를 넣어 주세요.' };
  if (!b64ok_(q.image)) return { ok: false, error: '그림을 다시 올려 주세요.' };
  if (!countToday_()) return { ok: false, error: '오늘 만들 수 있는 시계를 다 만들었어요. 내일 다시 해요.' };

  const digital = q.kind === 'digital';
  const out = genImage_(q.image, q.mime || 'image/jpeg', digital ? DIGITAL_PROMPT : CLOCK_PROMPT);
  if (!out) return { ok: false, error: '시계를 만들지 못했어요. 한 번 더 눌러 주세요.' };
  const dial = digital ? findScreen_(out.data, out.mime) : findDial_(out.data, out.mime);
  return { ok: true, image: out.data, mime: out.mime, dial: dial };
}

function countToday_() {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const P = PropertiesService.getScriptProperties();
    const k = 'cnt_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
    const n = Number(P.getProperty(k) || 0);
    if (n >= MAX_MAKE_PER_DAY) return false;
    P.setProperty(k, String(n + 1));
    return true;
  } finally { lock.releaseLock(); }
}

function genImage_(b64, mime, prompt) {
  // 공식 문서 방식(Interactions API)으로 먼저, 안 되면 generateContent로 한 번 더
  const base = 'https://generativelanguage.googleapis.com/v1beta/';
  const head = { 'x-goog-api-key': key_() };
  let r = UrlFetchApp.fetch(base + 'interactions', {
    method: 'post', contentType: 'application/json', headers: head, muteHttpExceptions: true,
    payload: JSON.stringify({ model: IMAGE_MODEL, input: [
      { type: 'text', text: prompt },
      { type: 'image', mime_type: mime, data: b64 }] })
  });
  let img = r.getResponseCode() === 200 ? findImage_(JSON.parse(r.getContentText())) : null;
  if (!img) {
    r = UrlFetchApp.fetch(base + 'models/' + IMAGE_MODEL + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: head, muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
    });
    if (r.getResponseCode() === 200) img = findImage_(JSON.parse(r.getContentText()));
    else Logger.log('이미지 생성 실패 ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 500));
  }
  return img;
}

// 응답 안에서 마지막 이미지(base64)를 찾아요 — 응답 모양이 바뀌어도 동작하게
function findImage_(o) {
  let found = null;
  (function walk(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    const inl = x.inlineData || x.inline_data;
    if (inl && typeof inl.data === 'string' && inl.data.length > 1000) found = { data: inl.data, mime: inl.mimeType || inl.mime_type || 'image/png' };
    else if (typeof x.data === 'string' && x.data.length > 1000 && /image/.test(String(x.mime_type || x.mimeType || x.type || ''))) found = { data: x.data, mime: x.mime_type || x.mimeType || 'image/png' };
    Object.keys(x).forEach(k => { if (k !== 'data') walk(x[k]); });
  })(o);
  return found;
}

function askJson_(prompt, b64, mime) {
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TEXT_MODEL + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key_() }, muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
      generationConfig: { responseMimeType: 'application/json' } })
  });
  if (r.getResponseCode() !== 200) return null;
  const t = JSON.parse(r.getContentText()).candidates[0].content.parts.map(p => p.text || '').join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

function findScreen_(b64, mime) {
  const fallback = { bx: 0.25, by: 0.38, bw: 0.5, bh: 0.24, auto: false };
  try {
    const d = askJson_(SCREEN_PROMPT, b64, mime);
    if (!d) return fallback;
    const bx = num_(d.x, 0, 0.95, 0.25), by = num_(d.y, 0, 0.95, 0.38);
    return { bx: bx, by: by, bw: num_(d.w, 0.05, 1 - bx, 0.5), bh: num_(d.h, 0.03, 1 - by, 0.24), auto: true };
  } catch (e) { return fallback; }
}

function findDial_(b64, mime) {
  const fallback = { cx: 0.5, cy: 0.5, r: 0.3, auto: false };
  try {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TEXT_MODEL + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key_() }, muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: DIAL_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseMimeType: 'application/json' } })
    });
    if (r.getResponseCode() !== 200) return fallback;
    const j = JSON.parse(r.getContentText());
    const t = j.candidates[0].content.parts.map(p => p.text || '').join('');
    const d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return { cx: num_(d.cx, 0, 1, 0.5), cy: num_(d.cy, 0, 1, 0.5), r: num_(d.r, 0.05, 0.5, 0.3), auto: true };
  } catch (e) { return fallback; }
}

/* ---------- 2) 전시관에 걸기 ---------- */
function save_(q) {
  if (!b64ok_(q.drawing) || !b64ok_(q.clock)) return { ok: false, error: '그림을 다시 만들어 주세요.' };
  const s = store_();
  const sh = s.ss.getSheetByName('clocks');
  if (sh.getRange(1, 20).getValue() !== '반') sh.getRange(1, 15, 1, 7).setValues([['kind', 'bx', 'by', 'bw', 'bh', '반', '번호']]);
  const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const maker = str_(q.maker, 12), name = str_(q.name, 20);
  const d = s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.drawing), 'image/jpeg', id + '_설계도_' + maker + '.jpg'));
  const c = s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.clock), 'image/png', id + '_시계_' + maker + '.png'));
  const hex = v => /^#[0-9a-fA-F]{6}$/.test(String(v)) ? v : '#1b2433';
  sh.appendRow([id, new Date(), maker, name, str_(q.feature, 80), d.getId(), c.getId(),
    num_(q.cx, 0, 1, 0.5), num_(q.cy, 0, 1, 0.5), num_(q.r, 0.05, 0.5, 0.3), hex(q.hand), hex(q.bg), str_(q.dev, 40), '',
    q.kind === 'digital' ? 'digital' : 'analog', num_(q.bx, 0, 1, 0.25), num_(q.by, 0, 1, 0.38), num_(q.bw, 0, 1, 0.5), num_(q.bh, 0, 1, 0.24), str_(q.ban, 3), str_(q.num, 3)]);
  return { ok: true, id: id };
}

/* ---------- 3) 전시관 목록 ---------- */
function rows_(name) { const v = store_().ss.getSheetByName(name).getDataRange().getValues(); v.shift(); return v; }

function list_(q) {
  const dev = str_(q.dev, 40);
  const likes = rows_('likes'), comments = rows_('comments');
  const items = rows_('clocks').filter(r => r[0] && String(r[13]).toUpperCase() !== 'Y').reverse().map(r => ({
    id: r[0], time: new Date(r[1]).getTime(), maker: r[2], name: r[3], feature: r[4], drawingId: r[5], clockId: r[6],
    cx: r[7], cy: r[8], r: r[9], hand: r[10], bg: r[11],
    kind: r[14] || 'analog', bx: r[15], by: r[16], bw: r[17], bh: r[18], ban: r[19] || '', num: r[20] || '',
    likes: likes.filter(l => l[0] === r[0]).length,
    liked: likes.some(l => l[0] === r[0] && l[1] === dev),
    comments: comments.filter(c => c[0] === r[0]).map(c => ({ name: c[1], text: c[2], time: new Date(c[3]).getTime(), mine: c[4] === dev }))
  }));
  return { ok: true, items: items };
}

// 전시관에 있는 그림만 꺼낼 수 있어요(드라이브의 다른 파일은 안 돼요)
function img_(q) {
  const allowed = {};
  rows_('clocks').forEach(r => { allowed[r[5]] = 1; allowed[r[6]] = 1; });
  const ids = (Array.isArray(q.ids) ? q.ids : []).slice(0, 12).filter(id => allowed[id]);
  const out = {};
  ids.forEach(id => {
    const b = DriveApp.getFileById(id).getBlob();
    out[id] = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  });
  return { ok: true, images: out };
}

/* ---------- 4) 좋아요·댓글 ---------- */
function like_(q) {
  const id = str_(q.id, 40), dev = str_(q.dev, 40);
  if (!id || !dev) return { ok: false };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = store_().ss.getSheetByName('likes'), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) if (v[i][0] === id && v[i][1] === dev) { sh.deleteRow(i + 1); return { ok: true, liked: false }; }
    sh.appendRow([id, dev, new Date()]);
    return { ok: true, liked: true };
  } finally { lock.releaseLock(); }
}

function comment_(q) {
  const id = str_(q.id, 40), name = str_(q.name, 12).trim(), text = str_(q.text, 80).trim();
  if (!id || !name || !text) return { ok: false, error: '이름과 댓글을 모두 써 주세요.' };
  store_().ss.getSheetByName('comments').appendRow([id, name, text, new Date(), str_(q.dev, 40)]);
  return { ok: true };
}
