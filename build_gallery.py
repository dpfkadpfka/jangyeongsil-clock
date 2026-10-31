# 작품 전시관(보기 전용) 페이지 만들기
# 원본 앱(index.html, invent/index.html)을 고친 뒤 `python3 build_gallery.py`를 다시 실행하면
# gallery/index.html, invent/gallery/index.html 이 원본 갤러리 그대로 새로 만들어져요.
# 전시관에서는 만들기(AI 생성)·고치기·선생님 모드 버튼이 모두 빠지고, 보기·좋아요·댓글만 돼요.
import os

HERE = os.path.dirname(os.path.abspath(__file__))

HIDE_CSS = """<style id="view-only">
#v-start,#v-make,#b-back,#b-teacher,.redraw,#m-edit{display:none!important}
body.is-start .hero,body.is-form .hero{display:none!important}
</style>"""


def build(src, dst, title_from, title_to, extra=()):
    s = open(os.path.join(HERE, src), encoding='utf8').read()
    reps = [
        ('<head>', '<head><base href="../">'),
        (title_from, title_to),
        ('function view(v){', "function view(v){v='gal';"),
        ("if(h==='gallery'){from='start';view('gal');}", "if(true){from='gal';view('gal');}"),
        ('</head>', HIDE_CSS + '</head>'),
        (' · <button class="tlink" id="b-teacher">', '<button class="tlink" id="b-teacher">'),
        *extra,
    ]
    for a, b in reps:
        n = s.count(a)
        if n != 1:
            raise SystemExit(f'{src}: "{a[:40]}" 이(가) {n}번 나와요 — 원본 구조가 바뀌었는지 확인해 주세요.')
        s = s.replace(a, b)
    out = os.path.join(HERE, dst)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf8').write(s)
    print('만듦:', dst)


build('index.html', 'gallery/index.html',
      '<title>나도 장영실! 시계 발명가</title>', '<title>시계 발명가 작품 전시관</title>',
      extra=[('function canEdit(it){', 'function canEdit(it){return false;'),
             ("<b>아직 올라온 작품이 없어요</b>시계 만들기에서 첫 작품을 올려 보세요.", "<b>아직 올라온 작품이 없어요</b>작품이 올라오면 여기에서 볼 수 있어요."),
             ("첫 작품을 올려 보세요. '전체'를 누르면", "'전체'를 누르면")])

build('invent/index.html', 'invent/gallery/index.html',
      '<title>나도 발명가! 생활 발명 연구소</title>', '<title>생활 발명 연구소 작품 전시관</title>')
