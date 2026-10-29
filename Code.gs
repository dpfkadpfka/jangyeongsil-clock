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
const MAX_MAKE_PER_DAY = 500;                 // 하루에 만들 수 있는 시계 수 (요금 보호)

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

const SCREEN_PROMPT = 'This is a product photo of a digital clock whose display screen is empty. Detect that empty display screen (the dark rectangle where the digits will be shown). ' +
  'Return JSON only: {"box_2d":[ymin,xmin,ymax,xmax]} with coordinates normalized to 0-1000.';

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
  // 원래 전시관 폴더·목록을 꼭 써요. 잠깐 못 열어도 새 빈 목록을 만들지 않고 다시 시도해요.
  const P = PropertiesService.getScriptProperties();
  const FOLDER = '1tESSCnyiIKKsZ_5dvqaFdeFKdPOWM_GU', SHEET = '1XEsIvHcBzd6sPFbuHlXC_ph-EXXSZB93yUl0BReptT0';
  if (P.getProperty('FOLDER_ID') !== FOLDER) P.setProperty('FOLDER_ID', FOLDER);
  if (P.getProperty('SHEET_ID') !== SHEET) P.setProperty('SHEET_ID', SHEET);
  let folder = null, ss = null, err = null;
  for (let t = 0; t < 4 && !(folder && ss); t++) {
    try { if (!folder) folder = DriveApp.getFolderById(FOLDER); if (!ss) ss = SpreadsheetApp.openById(SHEET); }
    catch (e) { err = e; Utilities.sleep(700 * (t + 1)); }
  }
  if (!folder || !ss) throw new Error('지금 전시관이 잠깐 바빠요. 조금 뒤 다시 해 주세요.');
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
      case 'teacher': return json_(teacherLogin_(q));
      case 'hide': return json_(hide_(q));
      case 'redraw': return json_(redraw_(q));
      case 'school': return json_(school_(q));
      case 'inv_chat': return json_(invChat_(q));
      case 'inv_image': return json_(invImage_(q));
      case 'inv_app': return json_(invApp_(q));
      case 'inv_video': return json_(invVideo_(q));
      case 'inv_video_check': return json_(invVideoCheck_(q));
      case 'inv_save': return json_(invSave_(q));
      case 'inv_list': return json_(invList_(q));
      case 'inv_getapp': return json_(invGetApp_(q));
      case 'delcomment': return json_(delComment_(q));
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
  if (!key_() && !sa_()) return { ok: false, error: '선생님: 스크립트 속성에 VERTEX_SA(또는 GEMINI_API_KEY)를 넣어 주세요.' };
  if (!b64ok_(q.image)) return { ok: false, error: '그림을 다시 올려 주세요.' };
  if (!countToday_()) return { ok: false, error: '오늘 만들 수 있는 시계를 다 만들었어요. 내일 다시 해요.' };

  const digital = q.kind === 'digital';
  const s = store_(), who = whoStr_(q);
  // 올린 그림은 바로 드라이브에 저장(같은 그림으로 다시 그릴 때는 다시 올리지 않아요)
  let drawingId = String(q.drawingId || '');
  if (!drawingId || !makeIds_()[drawingId]) drawingId = share_(s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.image), q.mime || 'image/jpeg', stamp_() + '_그림_' + who + '.jpg'))).getId();
  const out = genImage_(q.image, q.mime || 'image/jpeg', digital ? DIGITAL_PROMPT : CLOCK_PROMPT);
  if (!out) { logMake_(s, q, drawingId, '', '실패'); return { ok: false, error: /429/.test(LAST_ERR) ? '지금 친구들이 한꺼번에 많이 만들고 있어요. 10초 뒤에 다시 눌러 주세요.' : '시계를 만들지 못했어요. 한 번 더 눌러 주세요.', detail: LAST_ERR, drawingId: drawingId }; }
  const ext = /webp/.test(out.mime) ? '.webp' : /jpe?g/.test(out.mime) ? '.jpg' : '.png';
  const clockId = share_(s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(out.data), out.mime, stamp_() + '_AI시계_' + who + ext))).getId();
  logMake_(s, q, drawingId, clockId, '');
  const dial = digital ? findScreen_(out.data, out.mime) : findDial_(out.data, out.mime);
  return { ok: true, image: out.data, mime: out.mime, dial: dial, drawingId: drawingId, clockId: clockId };
}

function share_(f) { try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {} return f; }
function stamp_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMdd_HHmmss'); }
function whoStr_(q) { return [str_(q.school, 30).replace(/등학교$/, ''), str_(q.grade, 2) && str_(q.grade, 2) + '학년', str_(q.ban, 3) && str_(q.ban, 3) + '반', str_(q.num, 3) && str_(q.num, 3) + '번', str_(q.maker, 12)].filter(Boolean).join(' ') || '이름없음'; }
function makesSheet_(s) {
  let sh = s.ss.getSheetByName('makes');
  if (!sh) { sh = s.ss.insertSheet('makes'); sh.appendRow(['시각', '학년', '반', '번호', '이름', '종류', '그림 파일', '시계 파일', '메모', '학교']); }
  else if (sh.getRange(1, 10).getValue() !== '학교') sh.getRange(1, 10).setValue('학교');
  return sh;
}
// 만들 때마다 기록: 누가, 무엇을, 어떤 파일로
function logMake_(s, q, drawingId, clockId, memo) {
  const link = id => id ? 'https://drive.google.com/file/d/' + id + '/view' : '';
  makesSheet_(s).appendRow([new Date(), str_(q.grade, 2), str_(q.ban, 3), str_(q.num, 3), str_(q.maker, 12), q.kind === 'digital' ? '디지털' : '바늘', link(drawingId), link(clockId), memo, str_(q.school, 30)]);
}
// 이 앱이 만든 파일만 갤러리에 쓸 수 있어요
function makeIds_() {
  const out = {};
  makesSheet_(store_()).getDataRange().getValues().forEach(r => [r[6], r[7]].forEach(u => { const m = String(u).match(/\/d\/([\w-]+)/); if (m) out[m[1]] = 1; }));
  return out;
}

function countToday_() {
  // 하루 개수 제한 없음(선생님 요청). 몇 개 만들었는지만 기록해요. 바쁠 때 기다리지 않게 잠금 없이 대충 셉니다.
  try { const P = PropertiesService.getScriptProperties(), k = 'cnt_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'); P.setProperty(k, String(Number(P.getProperty(k) || 0) + 1)); } catch (e) {}
  return true;
}

let LAST_ERR = '';
const VERTEX_IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
const VERTEX_TEXT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3-flash-preview'];

// ▼ 구글 클라우드 크레딧(버텍스 AI)을 쓰려면 [스크립트 속성]에 VERTEX_SA = 서비스 계정 키(JSON 전체)를 넣어요.
//   없으면 GEMINI_API_KEY(AI 스튜디오)로 해요.
function sa_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('VERTEX_SA') || ''); } catch (e) { return null; } }

function vertexToken_(sa) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('vtok');
  if (hit) return hit;
  const now = Math.floor(Date.now() / 1000);
  const b64u = x => Utilities.base64EncodeWebSafe(x).replace(/=+$/, '');
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64u(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig } });
  const d = JSON.parse(r.getContentText());
  if (!d.access_token) throw new Error('토큰 실패 ' + r.getContentText().slice(0, 200));
  cache.put('vtok', d.access_token, 3000);
  return d.access_token;
}

// 버텍스 AI 또는 AI 스튜디오에 generateContent 요청 (모델 여러 개를 차례로 시도)
function gen_(parts, image, models, studioModels) {
  const body = { contents: [{ role: 'user', parts: parts }] };
  const wantImg = image === true || image === 'wide';
  if (image === true) body.generationConfig = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } };
  else if (image === 'wide') body.generationConfig = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } };
  else if (image === 'text') body.generationConfig = { maxOutputTokens: 16000, temperature: 0.7 };
  else if (image === 'app') body.generationConfig = { maxOutputTokens: 9000, temperature: 0.6 };
  else body.generationConfig = { responseMimeType: 'application/json' };
  const sa = sa_(), errs = [];
  if (sa) {
    let tok = '';
    try { tok = vertexToken_(sa); } catch (e) { errs.push(String(e.message || e)); }
    // 한 곳이 붐비면(429) 다른 지역 서버로, 그래도 안 되면 잠깐 쉬고 한 번 더
    const LOCS = ['global', 'us-central1', 'asia-northeast3', 'asia-northeast1', 'europe-west4'];
    if (tok) for (let round = 0; round < 2; round++) {
      for (const m of models) for (const loc of LOCS) {
        const host = loc === 'global' ? 'aiplatform.googleapis.com' : loc + '-aiplatform.googleapis.com';
        const r = UrlFetchApp.fetch('https://' + host + '/v1/projects/' + sa.project_id + '/locations/' + loc + '/publishers/google/models/' + m + ':generateContent', {
          method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true, payload: JSON.stringify(body) });
        const code = r.getResponseCode();
        if (code === 200) { const j = JSON.parse(r.getContentText()); if (!wantImg || findImage_(j)) return j; errs.push(m + '@' + loc + ' 그림 없음'); break; }
        errs.push(m + '@' + loc + ' ' + code);
        if (code !== 429 && code !== 503 && code !== 404) break;   // 붐빔·지역 없음이 아니면 다른 지역도 같은 결과
      }
      if (round === 0) Utilities.sleep(4000);
    }
  }
  if (key_()) for (const m of studioModels) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key_() }, muteHttpExceptions: true, payload: JSON.stringify(body) });
    if (r.getResponseCode() === 200) { const j = JSON.parse(r.getContentText()); if (!wantImg || findImage_(j)) return j; errs.push(m + ' 그림 없음'); }
    else errs.push('studio ' + m + ' ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  }
  LAST_ERR = errs.join(' | ');
  Logger.log(LAST_ERR);
  return null;
}

function genImage_(b64, mime, prompt) {
  const j = gen_([{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }], true, VERTEX_IMAGE_MODELS, [IMAGE_MODEL]);
  return j ? findImage_(j) : null;
}

function askJson_(prompt, b64, mime) {
  const j = gen_([{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }], false, VERTEX_TEXT_MODELS, [TEXT_MODEL]);
  if (!j) return null;
  const t = j.candidates[0].content.parts.map(p => p.text || '').join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
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

function findScreen_(b64, mime) {
  const fallback = { bx: 0.25, by: 0.38, bw: 0.5, bh: 0.24, auto: false };
  try {
    const d = askJson_(SCREEN_PROMPT, b64, mime);
    let b = d && (d.box_2d || (Array.isArray(d) && d[0] && d[0].box_2d) || d.box);
    if (!Array.isArray(b) || b.length !== 4) return fallback;
    b = b.map(Number); const k = Math.max.apply(null, b) > 1.5 ? 1000 : 1;
    const y0 = b[0] / k, x0 = b[1] / k, y1 = b[2] / k, x1 = b[3] / k;
    if (!(x1 > x0 && y1 > y0)) return fallback;
    return { bx: num_(x0, 0, 1, 0.25), by: num_(y0, 0, 1, 0.38), bw: num_(x1 - x0, 0.05, 1, 0.5), bh: num_(y1 - y0, 0.03, 1, 0.24), auto: true };
  } catch (e) { return fallback; }
}

function findDial_(b64, mime) {
  const fallback = { cx: 0.5, cy: 0.5, r: 0.3, auto: false };
  try {
    const d = askJson_(DIAL_PROMPT, b64, mime);
    if (!d) return fallback;
    return { cx: num_(d.cx, 0, 1, 0.5), cy: num_(d.cy, 0, 1, 0.5), r: num_(d.r, 0.05, 0.5, 0.3), auto: true };
  } catch (e) { return fallback; }
}

/* ---------- 2) 전시관에 걸기 ---------- */
function save_(q) {
  const s = store_();
  const ids = (q.drawingId || q.clockId) ? makeIds_() : {};
  if (q.editId) rows_('clocks').forEach(r => { ids[r[5]] = 1; ids[r[6]] = 1; });
  const reuseD = q.drawingId && ids[q.drawingId], reuseC = q.clockId && ids[q.clockId];
  if ((!reuseD && !b64ok_(q.drawing)) || (!reuseC && !b64ok_(q.clock))) return { ok: false, error: '그림을 다시 만들어 주세요.' };
  const sh = s.ss.getSheetByName('clocks');
  if (sh.getRange(1, 27).getValue() !== '학교코드') sh.getRange(1, 15, 1, 13).setValues([['kind', 'bx', 'by', 'bw', 'bh', '반', '번호', '학년', '분침', '초침', '바늘크기', '학교', '학교코드']]);
  const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const maker = str_(q.maker, 12), name = str_(q.name, 20);
  // 갤러리에서 빨리 보이도록 링크가 있는 사람만 볼 수 있게(목록에 없는 파일은 주소를 알 수 없음)
  const d = reuseD ? { getId: () => q.drawingId } : share_(s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.drawing), 'image/jpeg', id + '_설계도_' + maker + '.jpg')));
  const cm = ['image/webp', 'image/jpeg', 'image/png'].indexOf(q.clockMime) >= 0 ? q.clockMime : 'image/png';
  const c = reuseC ? { getId: () => q.clockId } : share_(s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.clock), cm, id + '_시계_' + maker + '.' + cm.split('/')[1].replace('jpeg', 'jpg'))));
  const hex = v => /^#[0-9a-fA-F]{6}$/.test(String(v)) ? v : '#1b2433';
  const row = [id, new Date(), maker, name, str_(q.feature, 80), d.getId(), c.getId(),
    num_(q.cx, 0, 1, 0.5), num_(q.cy, 0, 1, 0.5), num_(q.r, 0.05, 0.5, 0.3), hex(q.hand), hex(q.bg), str_(q.dev, 40), '',
    q.kind === 'digital' ? 'digital' : 'analog', num_(q.bx, 0, 1, 0.25), num_(q.by, 0, 1, 0.38), num_(q.bw, 0, 1, 0.5), num_(q.bh, 0, 1, 0.24), str_(q.ban, 3), str_(q.num, 3), str_(q.grade, 2), hex(q.min), hex(q.sec), num_(q.size, 0.5, 1.5, 1), str_(q.school, 30), str_(q.schoolCode, 20)];
  // 고치기: 만든 사람(학년·반·번호·이름이 같음)이나 선생님만, 같은 줄을 새 내용으로 바꿔요
  if (q.editId) {
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) if (v[i][0] === q.editId) {
      const same = (a, b) => String(a).trim() === String(b).trim();
      const mine = same(v[i][2], q.maker) && same(v[i][19], q.ban) && same(v[i][20], q.num) && same(v[i][21], q.grade);
      if (!mine && !canManage_(q.pin, v[i][25], v[i][21], v[i][19])) return { ok: false, error: '내가 만든 시계만 고칠 수 있어요.' };
      row[0] = q.editId; row[1] = v[i][1]; row[12] = v[i][12]; row[13] = v[i][13];
      if (!mine) { row[2] = v[i][2]; row[19] = v[i][19]; row[20] = v[i][20]; row[21] = v[i][21]; row[25] = v[i][25]; row[26] = v[i][26]; }   // 선생님이 고쳐도 만든 사람은 그대로
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]); dirty_();
      return { ok: true, id: q.editId, edited: true };
    }
    return { ok: false, error: '작품을 찾지 못했어요.' };
  }
  sh.appendRow(row); dirty_();
  return { ok: true, id: id };
}

/* ---------- 3) 전시관 목록 ---------- */
// 시트 읽기는 10초 동안 기억해 두어 여러 명이 동시에 갤러리를 봐도 가볍게
function rows_(name) {
  const cache = CacheService.getScriptCache(), k = 'rows_' + name, hit = cache.get(k);
  if (hit) try { return JSON.parse(hit); } catch (e) {}
  const v = store_().ss.getSheetByName(name).getDataRange().getValues(); v.shift();
  const out = v.map(r => r.map(x => x instanceof Date ? x.getTime() : x));
  try { cache.put(k, JSON.stringify(out), 10); } catch (e) {}
  return out;
}
function dirty_() { CacheService.getScriptCache().removeAll(['rows_clocks', 'rows_likes', 'rows_comments', 'rows_inventions']); }

function list_(q) {
  const dev = str_(q.dev, 40);
  const likes = rows_('likes'), comments = rows_('comments');
  const items = rows_('clocks').filter(r => r[0] && String(r[13]).toUpperCase() !== 'Y').reverse().map(r => ({
    id: r[0], time: new Date(r[1]).getTime(), maker: r[2], name: r[3], feature: r[4], drawingId: r[5], clockId: r[6],
    cx: r[7], cy: r[8], r: r[9], hand: r[10], bg: r[11],
    kind: r[14] || 'analog', bx: r[15], by: r[16], bw: r[17], bh: r[18], ban: r[19] || '', num: r[20] || '', grade: r[21] || '', min: r[22] || '', sec: r[23] || '', size: r[24] || 1, school: r[25] || '',
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
  invRows_().forEach(r => String(r[12] || '').split(',').concat([r[11]]).forEach(x => { if (x) allowed[x] = 1; }));
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
  const want = q.want === undefined ? null : !!q.want;   // 새 앱: 바라는 상태를 보내요(두 번 가도 뒤집히지 않음)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: '잠시 뒤 다시 눌러 주세요.' };
  try {
    const sh = store_().ss.getSheetByName('likes'), v = sh.getDataRange().getValues();
    let row = -1;
    for (let i = v.length - 1; i >= 1; i--) if (v[i][0] === id && v[i][1] === dev) { row = i + 1; break; }
    const now = row > 0, next = want === null ? !now : want;
    if (next && !now) sh.appendRow([id, dev, new Date()]);
    if (!next && now) sh.deleteRow(row);
    if (next !== now) dirty_();
    return { ok: true, liked: next };
  } finally { lock.releaseLock(); }
}

function comment_(q) {
  const id = str_(q.id, 40), name = str_(q.name, 12).trim(), text = str_(q.text, 80).trim();
  if (!id || !name || !text) return { ok: false, error: '이름과 댓글을 모두 써 주세요.' };
  store_().ss.getSheetByName('comments').appendRow([id, name, text, new Date(), str_(q.dev, 40)]); dirty_();
  return { ok: true };
}

/* ---------- 5) 선생님만: 작품·댓글 지우기 ----------
   [스크립트 속성]에 TEACHER_PIN = 선생님 비밀번호(숫자 4자리 이상 권장)를 넣어요. */
function pinOk_(pin) {
  const real = PropertiesService.getScriptProperties().getProperty('TEACHER_PIN') || '';
  if (!real) return false;
  const cache = CacheService.getScriptCache(), n = Number(cache.get('pinfail') || 0);
  if (n >= 20) return false;                       // 10분에 20번 넘게 틀리면 잠깐 잠금
  if (String(pin || '') === real) return true;
  cache.put('pinfail', String(n + 1), 600);
  return false;
}

/* ---------- 반별 선생님 ----------
   선생님이 학교·학년·반·비밀번호를 넣으면 그 반 작품만 관리해요.
   처음 들어온 선생님의 비밀번호로 그 반이 등록돼요(teachers 시트). 예람쌤 비밀번호(TEACHER_PIN)는 모든 반을 관리해요.
   pin은 '학교\u0001학년\u0001반\u0001비밀번호' 꼴로 와요(예전처럼 비밀번호만 와도 돼요). */
function teacherSheet_() {
  const ss = store_().ss;
  let sh = ss.getSheetByName('teachers');
  if (!sh) { sh = ss.insertSheet('teachers'); sh.appendRow(['학교', '학년', '반', '비밀번호 암호', '등록 시각']); }
  return sh;
}
function pinHash_(s, g, b, p) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'gc|' + s + '|' + g + '|' + b + '|' + p, Utilities.Charset.UTF_8));
}
function masterOk_(p) { const real = PropertiesService.getScriptProperties().getProperty('TEACHER_PIN') || ''; return !!real && String(p || '') === real; }
function splitPin_(pin) {
  const a = String(pin || '').split('\u0001');
  if (a.length < 4) return { p: a[0] };
  return { s: a[0].trim(), g: String(a[1]).trim(), b: String(a[2]).trim(), p: a.slice(3).join('\u0001') };
}
function teacherAuth_(pin) {
  if (!pin) return null;
  const cache = CacheService.getScriptCache(), ck = 'ta_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(pin), Utilities.Charset.UTF_8));
  const hit = cache.get(ck); if (hit) return JSON.parse(hit);
  const fails = Number(cache.get('pinfail') || 0);
  if (fails >= 30) return null;                     // 10분에 30번 넘게 틀리면 잠깐 잠금
  const x = splitPin_(pin);
  let a = null;
  if (masterOk_(x.p)) a = { all: true };
  else if (x.s && x.g && x.b) {
    const h = pinHash_(x.s, x.g, x.b, x.p);
    if (teacherSheet_().getDataRange().getValues().some(r => String(r[0]).trim() === x.s && String(r[1]).trim() === x.g && String(r[2]).trim() === x.b && r[3] === h)) a = { s: x.s, g: x.g, b: x.b };
  }
  if (a) cache.put(ck, JSON.stringify(a), 600); else cache.put('pinfail', String(fails + 1), 600);
  return a;
}
function canManage_(pin, school, grade, ban) {
  const a = teacherAuth_(pin); if (!a) return false; if (a.all) return true;
  const eq = (x, y) => String(x == null ? '' : x).trim() === String(y == null ? '' : y).trim();
  return eq(school, a.s) && eq(grade, a.g) && eq(ban, a.b);
}
function itemManage_(pin, id) {
  const a = teacherAuth_(pin); if (!a) return false; if (a.all) return true;
  if (id.charAt(0) === 'i') { const r = invSheet_().getDataRange().getValues().find(r => r[0] === id); return !!r && canManage_(pin, r[2], r[3], r[4]); }
  const r = rows_('clocks').find(r => r[0] === id); return !!r && canManage_(pin, r[25], r[21], r[19]);
}
function teacherLogin_(q) {
  const x = splitPin_(q.pin);
  if (masterOk_(x.p)) return { ok: true, all: true };
  if (!x.s || !x.g || !x.b) return { ok: false, error: '학교·학년·반을 골라 주세요.' };
  if (String(x.p).length < 4) return { ok: false, error: '비밀번호는 4자리 이상으로 해 주세요.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = teacherSheet_(), v = sh.getDataRange().getValues();
    const row = v.find(r => String(r[0]).trim() === x.s && String(r[1]).trim() === x.g && String(r[2]).trim() === x.b);
    if (!row) {
      if (!q.register) return { ok: false, need: 'register' };
      sh.appendRow([x.s, x.g, x.b, pinHash_(x.s, x.g, x.b, x.p), new Date()]);
      return { ok: true, created: true };
    }
    if (teacherAuth_(q.pin)) return { ok: true };
    return { ok: false, error: '비밀번호가 맞지 않아요. 잊어버렸으면 예람쌤(dpfkadpfka@gmail.com)께 알려 주세요.' };
  } finally { lock.releaseLock(); }
}

function hide_(q) {
  if (!teacherAuth_(q.pin)) return { ok: false, error: '선생님 비밀번호가 맞지 않아요.' };
  const inv = String(q.id).charAt(0) === 'i';
  const sh = inv ? invSheet_() : store_().ss.getSheetByName('clocks'), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][0] === q.id) {
    const ok = inv ? canManage_(q.pin, v[i][2], v[i][3], v[i][4]) : canManage_(q.pin, v[i][25], v[i][21], v[i][19]);
    if (!ok) return { ok: false, error: '우리 반 작품만 지울 수 있어요.' };
    sh.getRange(i + 1, inv ? 16 : 14).setValue('Y'); dirty_(); return { ok: true }; }
  return { ok: false, error: '작품을 찾지 못했어요.' };
}

function delComment_(q) {
  if (!teacherAuth_(q.pin)) return { ok: false, error: '선생님 비밀번호가 맞지 않아요.' };
  if (!itemManage_(q.pin, String(q.id))) return { ok: false, error: '우리 반 작품의 댓글만 지울 수 있어요.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = store_().ss.getSheetByName('comments'), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--)
      if (v[i][0] === q.id && new Date(v[i][3]).getTime() === Number(q.time)) { sh.deleteRow(i + 1); dirty_(); return { ok: true }; }
    return { ok: false, error: '댓글을 찾지 못했어요.' };
  } finally { lock.releaseLock(); }
}

/* ---------- 6) 갤러리에 올린 그림(설계도) 사진만 바꾸기: 만든 사람이나 선생님만 ---------- */
function redraw_(q) {
  if (!b64ok_(q.drawing)) return { ok: false, error: '그림을 다시 골라 주세요.' };
  const s = store_(), sh = s.ss.getSheetByName('clocks'), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][0] === q.id) {
    const same = (a, b) => String(a).trim() === String(b).trim();
    const mine = same(v[i][2], q.maker) && same(v[i][19], q.ban) && same(v[i][20], q.num) && same(v[i][21], q.grade);
    if (!mine && !canManage_(q.pin, v[i][25], v[i][21], v[i][19])) return { ok: false, error: '내가 만든 작품만 바꿀 수 있어요.' };
    const f = share_(s.folder.createFile(Utilities.newBlob(Utilities.base64Decode(q.drawing), 'image/jpeg', q.id + '_설계도_바꿈_' + stamp_() + '.jpg')));
    sh.getRange(i + 1, 6).setValue(f.getId()); dirty_();
    return { ok: true, drawingId: f.getId() };
  }
  return { ok: false, error: '작품을 찾지 못했어요.' };
}

/* ---------- 7) 학교 찾기: 나이스 교육정보 개방 포털(학교 기본정보) ----------
   [스크립트 속성]에 NEIS_KEY(인증키)를 넣으면 더 많은 결과가 나와요. 없어도 5개까지는 돼요. */
function school_(q) {
  const name = str_(q.q, 30).trim();
  if (name.length < 2) return { ok: true, schools: [] };
  const cache = CacheService.getScriptCache(), ck = 'sch_' + Utilities.base64EncodeWebSafe(name).slice(0, 200);
  const hit = cache.get(ck);
  if (hit) return { ok: true, schools: JSON.parse(hit) };
  const key = PropertiesService.getScriptProperties().getProperty('NEIS_KEY') || '';
  const url = 'https://open.neis.go.kr/hub/schoolInfo?Type=json&pIndex=1&pSize=' + (key ? 30 : 5) + (key ? '&KEY=' + encodeURIComponent(key) : '') + '&SCHUL_NM=' + encodeURIComponent(name);
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  let rows = [];
  try { const j = JSON.parse(r.getContentText()); rows = (j.schoolInfo && j.schoolInfo[1] && j.schoolInfo[1].row) || []; } catch (e) {}
  const order = k => /초등/.test(k) ? 0 : /중학/.test(k) ? 1 : 2;
  const list = rows.map(x => ({ name: x.SCHUL_NM, code: x.ATPT_OFCDC_SC_CODE + '-' + x.SD_SCHUL_CODE, kind: x.SCHUL_KND_SC_NM,
    region: x.LCTN_SC_NM, addr: String(x.ORG_RDNMA || '').split(' ').slice(0, 3).join(' ') }))
    .sort((a, b) => order(a.kind) - order(b.kind));
  if (list.length) cache.put(ck, JSON.stringify(list), 21600);
  return { ok: true, schools: list };
}

/* =====================================================================
   나도 발명가! 생활 속 발명 연구소 (2학년)
   불편한 일 → 바라는 것 → AI 친구와 아이디어 → 그림 3장 → 앱/영상 → 갤러리
   ===================================================================== */
const INV_TEXT_MODELS = ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'];
const VEO_MODELS = ['veo-3.1-fast-generate-001', 'veo-3.1-generate-001', 'veo-3.0-fast-generate-001'];
const MAX_VIDEO_PER_DAY = 60, MAX_APP_PER_DAY = 300;

function limit_(name, max) {
  // 하루 개수 제한 없음(선생님 요청). 기록만 해요.
  try { const P = PropertiesService.getScriptProperties(), k = name + '_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'); P.setProperty(k, String(Number(P.getProperty(k) || 0) + 1)); } catch (e) {}
  return true;
}
function invSheet_() {
  const ss = store_().ss;
  let sh = ss.getSheetByName('inventions');
  if (!sh) { sh = ss.insertSheet('inventions'); sh.appendRow(['id', '올린 시각', '학교', '학년', '반', '번호', '이름', '불편한 점', '바라는 점', '발명품 이름', '설명', '대표 그림', '그림들', '앱 파일', '영상 파일', '숨기기(Y)', 'device', '학교코드', '만든 방법']); }
  return sh;
}
function invRows_() { invSheet_(); return rows_('inventions'); }
function invLog_(q, kind, fileId, memo) {
  const ss = store_().ss;
  let sh = ss.getSheetByName('inv_makes');
  if (!sh) { sh = ss.insertSheet('inv_makes'); sh.appendRow(['시각', '학교', '학년', '반', '번호', '이름', '종류', '파일', '메모']); }
  sh.appendRow([new Date(), str_(q.school, 30), str_(q.grade, 2), str_(q.ban, 3), str_(q.num, 3), str_(q.maker, 12), kind, fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '', str_(memo, 300)]);
}
const KID_RULES = '너는 초등학교 2학년 친구의 발명을 돕는 다정한 AI 친구 "발명 도우미"야. 반말로, 아주 쉬운 낱말로, 한 문장은 짧게 말해. ' +
  '친구 생각을 먼저 칭찬하고 키워 줘. 위험하거나 남을 다치게 하는 것, 무서운 것, 어른 내용은 부드럽게 다른 쪽으로 돌려. 개인정보(주소, 전화번호)는 묻지 마.';

// 1) AI 친구와 아이디어 대화: 처음엔 아이디어 3개, 그다음엔 친구 말을 받아서 아이디어를 고쳐 줘요
function invChat_(q) {
  const problem = str_(q.problem, 200), wish = str_(q.wish, 200);
  const hist = (Array.isArray(q.history) ? q.history : []).slice(-12).map(m => (m.who === 'me' ? '친구: ' : '도우미: ') + str_(m.text, 300)).join('\n');
  const idea = q.idea ? JSON.stringify(q.idea).slice(0, 1200) : '';
  const prompt = KID_RULES + '\n\n[친구가 불편한 점] ' + problem + '\n[친구가 바라는 점] ' + wish +
    (idea ? '\n[지금 고른 아이디어] ' + idea : '') + (hist ? '\n[지금까지 대화]\n' + hist : '') + '\n[친구가 방금 한 말] ' + str_(q.text, 300) +
    '\n\n해야 할 일:\n' + (idea
      ? '- 친구 말을 반영해서 아이디어를 더 좋게 고쳐 줘. reply에는 바뀐 점을 2~3문장으로 말하고, 끝에 "또 바꾸고 싶은 게 있어?"처럼 물어봐.\n- idea에 고친 아이디어를 넣어.'
      : '- 불편함을 해결하는 서로 다른 발명 아이디어 3개를 만들어. 실제로 있을 법하고 재미있게. reply에는 "이런 건 어때?"처럼 1~2문장.') +
    '\n\nJSON으로만 대답해: {"reply":"...", ' + (idea ? '"idea":{"emoji":"하나","title":"발명품 이름(10자 이내)","desc":"어떤 발명품인지 2문장","features":["기능1","기능2","기능3"]}' : '"ideas":[{"emoji":"하나","title":"발명품 이름(10자 이내)","desc":"어떤 발명품인지 2문장","features":["기능1","기능2","기능3"]}]') + '}';
  const j = gen_([{ text: prompt }], false, INV_TEXT_MODELS, [TEXT_MODEL]);
  if (!j) return { ok: false, error: /429/.test(LAST_ERR) ? '지금 친구들이 많이 쓰고 있어요. 10초 뒤에 다시 해 봐요.' : 'AI 친구가 대답하지 못했어요. 다시 보내 볼까요?' };
  try {
    const t = j.candidates[0].content.parts.map(p => p.text || '').join('');
    const d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return { ok: true, reply: str_(d.reply, 600), ideas: d.ideas || null, idea: d.idea || null };
  } catch (e) { return { ok: false, error: 'AI 친구 말을 알아듣지 못했어요. 다시 보내 볼까요?' }; }
}

// 2) 아이디어 그림 (한 번에 한 장, 화면에서 3번 불러요)
const INV_STYLES = [
  '실제로 공장에서 만든 것 같은 제품 사진. 깨끗한 흰 배경, 정면에서 조금 위.',
  '아이가 그 발명품을 쓰고 있는 생활 장면. 밝고 따뜻한 3D 애니메이션 그림체.',
  '발명품 설명 그림. 귀여운 그림책 그림체, 기능마다 작은 화살표 그림(글자 없이).'
];
function invImage_(q) {
  if (!countToday_()) return { ok: false, error: '오늘 만들 수 있는 그림을 다 만들었어요. 내일 다시 해요.' };
  const idea = q.idea || {}, style = INV_STYLES[num_(q.style, 0, 2, 0)];
  const prompt = '초등학교 2학년 학생이 생각한 발명품을 그려 줘.\n발명품 이름: ' + str_(idea.title, 30) + '\n설명: ' + str_(idea.desc, 300) +
    '\n기능: ' + (Array.isArray(idea.features) ? idea.features.slice(0, 5).map(x => str_(x, 60)).join(', ') : '') +
    '\n그림 방식: ' + style + '\n지킬 것: 아이에게 안전하고 밝은 그림. 그림 안에 글자, 숫자, 로고를 넣지 말 것. 정사각형.';
  const parts = [{ text: prompt }];
  if (b64ok_(q.ref)) parts.push({ inlineData: { mimeType: q.refMime || 'image/jpeg', data: q.ref } });   // 아이가 그린 그림이 있으면 참고
  const j = gen_(parts, true, VERTEX_IMAGE_MODELS, [IMAGE_MODEL]);
  const out = j && findImage_(j);
  if (!out) return { ok: false, error: /429/.test(LAST_ERR) ? '지금 친구들이 한꺼번에 많이 그리고 있어요. 10초 뒤에 다시 눌러 주세요.' : '그림을 그리지 못했어요. 다시 눌러 주세요.' };
  const f = share_(store_().folder.createFile(Utilities.newBlob(Utilities.base64Decode(out.data), out.mime, stamp_() + '_발명그림_' + whoStr_(q) + (/png/.test(out.mime) ? '.png' : '.jpg'))));
  invLog_(q, '그림', f.getId(), str_(idea.title, 30));
  return { ok: true, image: out.data, mime: out.mime, id: f.getId() };
}

// 3) 바이브코딩: 발명품을 눌러 볼 수 있는 작은 웹앱(한 파일 HTML)
function invApp_(q) {
  if (!limit_('app', MAX_APP_PER_DAY)) return { ok: false, error: '오늘 만들 수 있는 앱을 다 만들었어요. 내일 다시 해요.' };
  const idea = q.idea || {};
  const prompt = '초등학교 2학년 학생의 발명품을 실제로 눌러 보며 체험하는 작은 웹앱을 만들어 줘.\n' +
    '발명품 이름: ' + str_(idea.title, 30) + '\n설명: ' + str_(idea.desc, 300) + '\n기능: ' + (Array.isArray(idea.features) ? idea.features.slice(0, 5).map(x => str_(x, 60)).join(' / ') : '') +
    '\n학생이 바라는 점: ' + str_(q.wish, 200) + (q.request ? '\n학생이 고쳐 달라고 한 것: ' + str_(q.request, 300) : '') +
    '\n\n규칙:\n- HTML 파일 하나(<!doctype html>부터)로만 대답해. 설명 글, 코드 블록 표시(```)는 쓰지 마.\n- CSS와 JavaScript는 파일 안에. 바깥 주소(CDN, 글꼴, 이미지 주소, fetch)는 절대 쓰지 마.\n' +
    '- 발명품 그림은 <img src="{{IMAGE}}">로 넣어(이 글자는 그대로 둬, 나중에 바뀜).\n- 기능마다 큰 버튼이 있고 누르면 그 기능이 화면에서 움직임·소리 없는 효과·말풍선으로 보여야 해. 2학년이 바로 알 수 있게 쉬운 한국어.\n' +
    '- 휴대폰과 태블릿 화면에 맞게, 밝고 귀여운 색. 짧고 깔끔하게 150줄 이내.';
  // 앱은 빠른 모델부터 써서 기다리는 시간을 줄여요
  const j = gen_([{ text: prompt }], 'app', ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3-flash-preview'], [TEXT_MODEL]);
  if (!j) return { ok: false, error: /429/.test(LAST_ERR) ? '지금 친구들이 많이 쓰고 있어요. 10초 뒤에 다시 해 봐요.' : '앱을 만들지 못했어요. 다시 눌러 주세요.' };
  let html = j.candidates[0].content.parts.map(p => p.text || '').join('');
  html = html.replace(/^[\s\S]*?(<!doctype html|<html)/i, '$1').replace(/```[\s\S]*$/, '').trim();
  if (!/<html|<body|<div/i.test(html)) return { ok: false, error: '앱을 만들지 못했어요. 다시 눌러 주세요.' };
  const f = share_(store_().folder.createFile(Utilities.newBlob(html, 'text/html', stamp_() + '_발명앱_' + whoStr_(q) + '.html')));
  invLog_(q, '앱', f.getId(), str_(idea.title, 30));
  return { ok: true, html: html, id: f.getId() };
}

// 4) AI 영상(Veo): 고른 그림으로 8초 영상. 오래 걸려서 시작 → 확인을 나눠요
function veoBase_(sa, m) { return 'https://us-central1-aiplatform.googleapis.com/v1/projects/' + sa.project_id + '/locations/us-central1/publishers/google/models/' + m; }
function invVideo_(q) {
  const sa = sa_();
  if (!sa) return { ok: false, error: '선생님: 영상은 VERTEX_SA가 있어야 만들 수 있어요.' };
  if (!b64ok_(q.image)) return { ok: false, error: '먼저 그림을 골라 주세요.' };
  if (!limit_('video', MAX_VIDEO_PER_DAY)) return { ok: false, error: '오늘 만들 수 있는 영상을 다 만들었어요. 내일 다시 해요.' };
  const idea = q.idea || {};
  const prompt = 'A short, cheerful, kid-friendly product demo of a child\'s invention called "' + str_(idea.title, 30) + '". ' + str_(idea.desc, 300) +
    ' Show the invention working by itself in a bright, cozy everyday place (a kid\'s room, classroom or kitchen). No people, no faces. Smooth gentle camera motion, playful animation style, bright colors, no text, no logos. Keep the invention looking exactly like the reference image.';
  const tok = vertexToken_(sa), errs = [];
  for (const m of VEO_MODELS) {
    const r = UrlFetchApp.fetch(veoBase_(sa, m) + ':predictLongRunning', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
      payload: JSON.stringify({ instances: [{ prompt: prompt, image: { bytesBase64Encoded: q.image, mimeType: q.mime || 'image/png' } }],
        parameters: { aspectRatio: '16:9', durationSeconds: 8, sampleCount: 1, generateAudio: false, resolution: '720p' } }) });
    if (r.getResponseCode() === 200) { const d = JSON.parse(r.getContentText()); if (d.name) return { ok: true, op: d.name, model: m }; }
    errs.push(m + ' ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  }
  Logger.log(errs.join(' | '));
  return { ok: false, error: '영상을 시작하지 못했어요. 조금 뒤에 다시 눌러 주세요.', detail: errs.join(' | ').slice(0, 600) };
}
function invVideoCheck_(q) {
  const sa = sa_(), m = VEO_MODELS.indexOf(q.model) >= 0 ? q.model : VEO_MODELS[0];
  const r = UrlFetchApp.fetch(veoBase_(sa, m) + ':fetchPredictOperation', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + vertexToken_(sa) }, muteHttpExceptions: true,
    payload: JSON.stringify({ operationName: str_(q.op, 400) }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: '영상 상태를 확인하지 못했어요.', detail: r.getContentText().slice(0, 300) };
  const d = JSON.parse(r.getContentText());
  if (!d.done) return { ok: true, done: false };
  if (d.error) return { ok: false, error: '영상을 만들지 못했어요. 다시 눌러 주세요.', detail: JSON.stringify(d.error).slice(0, 300) };
  const v = d.response && d.response.videos && d.response.videos[0];
  if (!v || !v.bytesBase64Encoded) return { ok: false, error: '이 그림으로는 영상을 만들 수 없었어요. 다른 그림으로 해 볼까요?' };
  const f = share_(store_().folder.createFile(Utilities.newBlob(Utilities.base64Decode(v.bytesBase64Encoded), v.mimeType || 'video/mp4', stamp_() + '_발명영상_' + whoStr_(q) + '.mp4')));
  invLog_(q, '영상', f.getId(), '');
  return { ok: true, done: true, video: v.bytesBase64Encoded, mime: v.mimeType || 'video/mp4', id: f.getId() };
}

// 5) 갤러리에 올리기 / 목록 / 앱 열기
function invSave_(q) {
  const sh = invSheet_(), id = 'i' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ok = {}; invMakeIds_().forEach(x => ok[x] = 1);
  const imgs = (Array.isArray(q.imageIds) ? q.imageIds : []).filter(x => ok[x]).slice(0, 6);
  const main = ok[q.imageId] ? q.imageId : (imgs[0] || '');
  sh.appendRow([id, new Date(), str_(q.school, 30), str_(q.grade, 2), str_(q.ban, 3), str_(q.num, 3), str_(q.maker, 12), str_(q.problem, 200), str_(q.wish, 200),
    str_(q.title, 30), str_(q.desc, 400), main, imgs.join(','), ok[q.appId] ? q.appId : '', ok[q.videoId] ? q.videoId : '', '', str_(q.dev, 40), str_(q.schoolCode, 20), str_(q.how, 20)]);
  dirty_();
  return { ok: true, id: id };
}
function invMakeIds_() {
  const sh = store_().ss.getSheetByName('inv_makes'); if (!sh) return [];
  return sh.getDataRange().getValues().map(r => (String(r[7]).match(/\/d\/([\w-]+)/) || [])[1]).filter(Boolean);
}
function invList_(q) {
  const dev = str_(q.dev, 40), likes = rows_('likes'), comments = rows_('comments');
  const items = invRows_().filter(r => r[0] && String(r[15]).toUpperCase() !== 'Y').reverse().map(r => ({
    id: r[0], time: new Date(r[1]).getTime(), school: r[2], grade: r[3], ban: r[4], num: r[5], maker: r[6], problem: r[7], wish: r[8], name: r[9], feature: r[10],
    imageId: r[11], imageIds: String(r[12] || '').split(',').filter(Boolean), appId: r[13], videoId: r[14],
    likes: likes.filter(l => l[0] === r[0]).length, liked: likes.some(l => l[0] === r[0] && l[1] === dev),
    comments: comments.filter(c => c[0] === r[0]).map(c => ({ name: c[1], text: c[2], time: new Date(c[3]).getTime(), mine: c[4] === dev }))
  }));
  return { ok: true, items: items };
}
function invGetApp_(q) {
  const id = str_(q.id, 80);
  if (!invRows_().some(r => r[13] === id)) return { ok: false, error: '앱을 찾지 못했어요.' };
  return { ok: true, html: DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8') };
}

/* 한 번만 실행: 예전에 올린 그림·시계 파일도 링크로 볼 수 있게(갤러리가 빨리 뜨도록) */
function shareAllFiles() {
  const ids = {};
  rows_('clocks').forEach(r => { if (r[5]) ids[r[5]] = 1; if (r[6]) ids[r[6]] = 1; });
  let n = 0;
  Object.keys(ids).forEach(id => { try { const f = DriveApp.getFileById(id); if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) { share_(f); n++; } } catch (e) {} });
  Logger.log('링크 공유로 바꾼 파일: ' + n + '개');
  return n;
}
