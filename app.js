(function(){
  "use strict";
  var TYPES = { choice: "4択", calc: "計算", written: "記述" };
  var PASS_RATE = 0.65;
  var SITE_NAME = "テスドリ";
  /* このHTMLがどのページとして書き出されたか（ビルド時に設定） */
  var PAGE = window.PAGE || { name: "index" };
  var BASE_TITLE = document.title;

  /* ---------- ライト／ダークの切り替え（右上のボタン） ---------- */
  var darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function isDark(){
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : !!(darkMQ && darkMQ.matches);
  }
  function syncThemeBtn(){
    var d = isDark(), b = document.getElementById("theme-btn");
    if (!b) return;
    document.getElementById("theme-label").textContent = d ? "ライト" : "ダーク";
    b.setAttribute("aria-label", d ? "ライトモードに切り替える" : "ダークモードに切り替える");
    b.title = b.getAttribute("aria-label");
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", d ? "#12151b" : "#2f6fde");
  }
  (function(){
    var b = document.getElementById("theme-btn");
    if (b) b.onclick = function(){
      var next = isDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("jstqb-theme", next); } catch(e){}
      syncThemeBtn();
    };
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", syncThemeBtn);
    syncThemeBtn();
  })();
  /* 資格ごとの設定。dist は本番の章ごとの出題数（FL：ISTQB CTFL v4.0、TM：ISTQB CTAL-TM v3.0 の試験構成） */
  /* 資格ごとの設定（render.js の EXAM_CONF と問題データから作る） */
  var EXAMS = {};
  Object.keys(window.EXAM_CONF).forEach(function(k){ EXAMS[k] = R.exam(k); });
  var EX = null, Q = [], CHAPTERS = {}, MOCK_DIST = {}, MOCK_MIN = 60, MOCK_N = 40, SETS = {}, STORE_KEY = "";
  var store = { q: {}, mock: [] };
  /* 配点：学習目標のKレベルから決める（K2=1点、K3=2点、K4=3点）。k がない問題は1点 */
  function pt(q){ return R.points(EX, q); }

  /* ---------- 成績の保存（ブラウザ内のみ。使えない環境でも動くようにする） ---------- */
  function loadStore(){
    var st = {};
    try { st = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch(e){ st = {}; }
    if (!st.q) { st = { q: st, mock: [] }; }   /* 旧形式からの移行 */
    if (!st.mock) st.mock = [];
    return st;
  }
  function save(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch(e){} }

  function selectExam(key){
    EX = EXAMS[key]; Q = EX.questions; CHAPTERS = EX.chapters; MOCK_DIST = EX.dist; MOCK_MIN = EX.minutes;
    MOCK_N = Object.keys(MOCK_DIST).reduce(function(s, k){ return s + MOCK_DIST[k]; }, 0);
    SETS = EX.sets; STORE_KEY = EX.storeKey; store = loadStore();
    $("sub").textContent = EX.sub;
    $("footer-src").textContent = EX.src;
    document.title = EX.name + "の練習問題｜" + SITE_NAME;
  }

  var $ = function(id){ return document.getElementById(id); };
  var tab = "choice";
  var state = { list: [], i: 0, results: [] };
  var mock = null, timerId = null;

  function setNav(name){
    Array.prototype.forEach.call(document.querySelectorAll("#gnav a"), function(a){
      a.classList.toggle("on", a.getAttribute("data-nav") === name);
    });
  }
  function show(view){
    ["top","home","quiz","mock","result","explain","explain-set","about","glossary","privacy","notfound","howto","faq","operator","contact","changelog"].forEach(function(v){ var el = $("view-"+v); if (el) el.classList.toggle("hidden", v!==view); });
    window.scrollTo(0,0);
  }
  function shuffle(a){ a = a.slice(); for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
  function byType(t){ return Q.filter(function(q){ return q.type === t; }); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  /* ---------- ホーム ---------- */
  function renderHome(){
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(b){
      b.classList.toggle("on", b.getAttribute("data-tab") === tab);
    });
    $("pane-practice").classList.toggle("hidden", tab === "mock");
    $("pane-mock").classList.toggle("hidden", tab !== "mock");
    $("written-note").classList.toggle("hidden", tab !== "written");
    if (tab === "mock") renderMockHome(); else renderPractice();
    renderResume();
  }

  /* 中断中の模擬試験があれば、どのタブでも上部に「再開する」を出す */
  function renderResume(){
    var m = loadMock(), box = $("mock-resume");
    box.classList.toggle("hidden", !m);
    if (!m) return;
    if (m.stale){
      box.innerHTML = '<b>中断中の模擬試験を再開できません</b><div class="small" style="margin-top:4px">問題の更新により、中断していた模擬試験の問題が変わりました。お手数ですが、新しく始め直してください。</div>' +
        '<div class="row" style="margin-top:8px"><button class="btn" id="resume-drop">閉じる</button></div>';
      $("resume-drop").onclick = function(){ clearMock(); renderResume(); };
      return;
    }
    var answered = m.ans.filter(function(a){ return a !== null; }).length;
    box.innerHTML = '<b>中断中の模擬試験があります</b>' +
      '<div class="small" style="margin-top:4px">' + (m.set ? "セット" + m.set : "完全ランダム") + '／解答済み ' + answered + ' / ' + m.list.length +
      '問／残り時間 ' + fmtLeft(m.left) + '（中断中は時間が止まっています）</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="resume-go">続きから再開する</button>' +
      '<button class="btn" id="resume-drop">破棄する</button></div>';
    $("resume-go").onclick = resumeMock;
    $("resume-drop").onclick = function(){
      askConfirm("中断中の模擬試験を破棄してよろしいですか？\n途中の解答は消え、元に戻すことはできません（採点もされません）。", "破棄する", function(){ clearMock(); renderResume(); }, true);
    };
  }

  function practiceTarget(ch){
    var onlyWrong = $("only-wrong").checked;
    return byType(tab).filter(function(q){
      if (ch && q.ch !== ch) return false;
      if (onlyWrong && !(store.q[q.id] && store.q[q.id].last === false)) return false;
      return true;
    });
  }

  function renderPractice(){
    var box = $("chapters"); box.innerHTML = "";
    Object.keys(CHAPTERS).forEach(function(k){
      var ch = +k;
      var all = byType(tab).filter(function(q){ return q.ch === ch; });
      if (!all.length) return;   /* この形式の問題がない章は表示しない */
      var target = practiceTarget(ch);
      var b = document.createElement("button");
      b.className = "chapter";
      b.disabled = target.length === 0;
      var done = all.filter(function(q){ return store.q[q.id]; });
      var good = done.filter(function(q){ return store.q[q.id].last === true; }).length;
      var pct = all.length ? Math.round(done.length / all.length * 100) : 0;
      b.innerHTML = '<div style="flex:1"><div class="t">第' + ch + '章　' + CHAPTERS[ch] + '</div>' +
        '<div class="small muted">' + ($("only-wrong").checked ? '間違えた問題 ' + target.length + '問' : all.length + '問') +
        (done.length ? '<span class="prog">　解いた ' + done.length + '問・前回正解 ' + good + '問（' + Math.round(good / done.length * 100) + '%）</span>' : '<span class="prog">　未着手</span>') + '</div>' +
        '<div class="pbar" role="progressbar" aria-label="第' + ch + '章の進み具合" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div></div>';
      b.onclick = function(){ startPractice(target); };
      box.appendChild(b);
    });
    var allTarget = practiceTarget(null);
    $("start-all").disabled = allTarget.length === 0;
    $("start-all").textContent = TYPES[tab] + "を全章からまとめて解く（" + allTarget.length + "問）";
  }

  /* ---------- 練習モード ---------- */
  function startPractice(list){
    if (!list.length) return;
    state.list = $("shuffle").checked ? shuffle(list) : list.slice();
    state.i = 0; state.results = [];
    show("quiz"); updateScore(); renderQuestion();
  }

  function head(q){
    return '<div><span class="tag">第' + q.ch + '章</span><span class="tag">' + TYPES[q.type] + '</span><span class="tag">シラバス ' + q.sec + '</span><span class="qid">ID ' + q.id + '</span></div>';
  }

  var explText = R.explText;

  function renderQuestion(){
    var q = state.list[state.i];
    $("q-progress").textContent = TYPES[q.type] + "　" + (state.i+1) + " / " + state.list.length + "問";
    var card = $("q-card");
    var html = head(q) + '<div class="qtext">' + q.q + '</div>';
    if (q.type === "choice"){
      var order = state.order = shuffle(q.options.map(function(_, i){ return i; }));
      order.forEach(function(oi, n){
        html += '<button class="opt" data-i="' + oi + '"><span class="k">' + "ABCD"[n] + '</span>' + q.options[oi] + '</button>';
      });
    } else if (q.type === "calc"){
      html += '<div class="calcrow"><input type="text" id="calc-in" inputmode="decimal" placeholder="数値を入力" autocomplete="off">' +
              '<span>' + (q.unit || "") + '</span><button class="btn primary" id="calc-go">解答する</button></div>';
    } else {
      html += '<textarea id="w-in" placeholder="ここに自分の解答を書いてから、模範解答を確認しましょう"></textarea>' +
              '<div class="row" style="margin-top:8px"><button class="btn primary" id="w-go">模範解答を見る</button></div>';
    }
    html += '<div id="fb" role="status" aria-live="polite"></div><div class="row" style="margin-top:12px"><button class="btn primary hidden" id="next">次へ</button></div>';
    card.innerHTML = html;

    if (q.type === "choice"){
      Array.prototype.forEach.call(card.querySelectorAll(".opt"), function(b){
        b.onclick = function(){ answerChoice(q, +b.getAttribute("data-i")); };
      });
    } else if (q.type === "calc"){
      var go = function(){ answerCalc(q); };
      $("calc-go").onclick = go;
      $("calc-in").addEventListener("keydown", function(e){ if (e.key === "Enter") go(); });
    } else {
      $("w-go").onclick = function(){ revealWritten(q); };
    }
    $("next").onclick = next;
  }

  /* 演習中の正解数・正答率（模擬試験では出さない） */
  function updateScore(){
    var n = state.results.length, ok = state.results.filter(function(r){ return r.ok; }).length;
    $("q-score").innerHTML = '正解数 <b>' + ok + ' / ' + n + '</b> 問中　正答率 <b>' + (n ? (ok / n * 100).toFixed(1) + '%' : '−') + '</b>';
  }
  function bar(p){ return '<div class="rep-bar"><i style="width:' + p + '%"></i></div>'; }
  function openReport(){
    var res = {}; state.results.forEach(function(r){ res[r.q.id] = r; });
    var n = state.results.length, ok = state.results.filter(function(r){ return r.ok; }).length, rate = n ? ok / n * 100 : 0;
    var left = '<div class="rep-box"><h3>全体（' + TYPES[state.list[0].type] + '）</h3><div class="rep-stats">' +
      '<div><small>出題数</small><b>' + n + '</b>問</div><div><small>正解数</small><b>' + ok + '</b>問</div>' +
      '<div><small>正答率</small><b>' + (n ? rate.toFixed(1) : '−') + '</b>' + (n ? '%' : '') + '</div></div>' + bar(rate) +
      '<div class="small muted" style="margin-top:6px">全' + state.list.length + '問中 ' + n + '問に解答</div></div>';
    var chs = []; state.list.forEach(function(q){ if (chs.indexOf(q.ch) < 0) chs.push(q.ch); }); chs.sort();
    left += '<div class="rep-box"><h3>章別</h3>' + chs.map(function(c){
      var rs = state.results.filter(function(r){ return r.q.ch === c; }), g = rs.filter(function(r){ return r.ok; }).length;
      return '<div class="rep-row"><span>第' + c + '章 ' + CHAPTERS[c] + (rs.length ? '<small>正解 ' + g + ' / ' + rs.length + '</small>' : '') + '</span><span>' +
        (rs.length ? (g / rs.length * 100).toFixed(1) + '%' : '−') + '</span></div>' + bar(rs.length ? g / rs.length * 100 : 0);
    }).join("") + '</div>';
    var right = '<div class="rep-box" style="overflow-x:auto"><table class="rep-tbl"><tr><th>No.</th><th>結果</th><th>章</th><th>シラバス</th><th>問題ID</th></tr>' +
      state.list.map(function(q, i){
        var r = res[q.id], mark = r ? (r.ok ? '<span class="r-ok" aria-label="正解">○</span>' : '<span class="r-ng" aria-label="不正解">×</span>') : '<span class="r-na" aria-label="未解答">−</span>';
        return '<tr><td>' + (i + 1) + '</td><td>' + mark + '</td><td>第' + q.ch + '章</td><td>' + q.sec + '</td><td>' + q.id + '</td></tr>';
      }).join("") + '</table></div>';
    $("report-body").innerHTML = '<div>' + left + '</div><div>' + right + '</div>';
    $("report").classList.remove("hidden");
    document.body.style.overflow = "hidden";   /* 背面のページはスクロールさせない */
    $("report-body").scrollTop = 0;
    $("report-close").focus();
  }
  function closeReport(){ $("report").classList.add("hidden"); document.body.style.overflow = ""; var b = $("q-report"); if (b) b.focus(); }

  function record(q, ok, picked){
    state.results.push({ q:q, ok:ok, picked:picked });
    updateScore();
    store.q[q.id] = { last: ok, t: Date.now() };
    save();
  }
  function showNext(){
    $("next").classList.remove("hidden");
    $("next").textContent = state.i + 1 < state.list.length ? "次へ" : "結果を見る";
  }
  function feedback(ok, title, q){
    $("fb").innerHTML = '<div class="fb ' + (ok ? "ok" : "ng") + '"><div class="h">' + title + '</div>' +
      '<div>' + explText(q, state.order) + '</div><div class="small muted" style="margin-top:6px">根拠：シラバス ' + q.sec + '</div>' +
      R.reportHTML(EX.key, q, "第" + q.ch + "章の" + TYPES[q.type] + "演習") + '</div>';
    showNext();
  }

  function answerChoice(q, picked){
    var ok = picked === q.answer;
    Array.prototype.forEach.call(document.querySelectorAll("#q-card .opt"), function(b){
      var i = +b.getAttribute("data-i");
      b.disabled = true;
      if (i === q.answer){ b.classList.add("ok"); b.insertAdjacentHTML("beforeend", '<span class="badge ok">正解</span>' + (i === picked ? '<span class="badge ok">あなたの解答</span>' : '')); }
      else if (i === picked){ b.classList.add("ng"); b.insertAdjacentHTML("beforeend", '<span class="badge ng">あなたの解答</span>'); }
    });
    record(q, ok, picked);
    feedback(ok, ok ? "正解" : "不正解（正解：" + q.options[q.answer] + "）", q);
  }

  function toNumber(s){
    s = String(s).replace(/[０-９．－]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
                 .replace(/[,，%％\s]/g, "").replace(/[^\d.\-]/g, "");
    return s === "" ? NaN : Number(s);
  }
  function answerCalc(q){
    var v = toNumber($("calc-in").value);
    if (isNaN(v)){
      $("fb").innerHTML = '<div class="calc-msg" role="alert">数値を入力してください（例：75、1,200、66.6）。</div>';
      $("calc-in").focus(); return;
    }
    var ok = Math.abs(v - q.answer) < 1e-9;
    $("calc-in").disabled = true; $("calc-go").disabled = true;
    record(q, ok, v);
    feedback(ok, (ok ? "正解" : "不正解") + "（正解：" + q.answer + (q.unit || "") + "）", q);
  }

  function revealWritten(q){
    $("w-go").disabled = true;
    var pts = q.points.map(function(p, i){
      return '<label><input type="checkbox" class="pt" data-i="' + i + '"><span>' + p + '</span></label>';
    }).join("");
    $("fb").innerHTML =
      '<div class="fb neutral"><div class="h">模範解答</div><div>' + q.model + '</div></div>' +
      '<div class="card points" style="margin-top:12px"><div style="font-weight:700">自己採点：満たしている項目にチェック</div>' + pts +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="w-score">採点する</button></div><div id="w-res"></div></div>' +
      '<div class="small muted">' + q.expl + '<br>根拠：シラバス ' + q.sec + '</div>' + R.reportHTML(EX.key, q, "第" + q.ch + "章の記述演習");
    $("w-score").onclick = function(){
      var boxes = document.querySelectorAll(".pt"), required = 0, got = 0;
      Array.prototype.forEach.call(boxes, function(b){
        if (!/^（加点）/.test(q.points[+b.getAttribute("data-i")])){ required++; if (b.checked) got++; }
        b.disabled = true;
      });
      var ok = got === required;
      this.disabled = true;
      record(q, ok);
      $("w-res").innerHTML = '<div class="fb ' + (ok ? "ok" : "ng") + '"><div class="h">' + (ok ? "合格" : "もう一歩") + '（必須項目 ' + got + '/' + required + '）</div></div>';
      showNext();
    };
  }

  function next(){
    if (state.i + 1 < state.list.length){ state.i++; renderQuestion(); window.scrollTo(0,0); }
    else renderPracticeResult();
  }

  function renderPracticeResult(){
    var n = state.results.length, ok = state.results.filter(function(r){ return r.ok; }).length;
    var wrong = state.results.filter(function(r){ return !r.ok; });
    var html = '<h2>結果</h2><div class="big">' + ok + ' / ' + n + '　<span class="muted" style="font-size:1rem">正答率 ' + (n ? (ok / n * 100).toFixed(1) : '0.0') + '%</span></div>';
    if (wrong.length){
      html += '<h2 style="margin-top:16px">間違えた問題（' + wrong.length + '問）</h2><div class="small muted">問題を押すと、正解と解説が開きます。</div><div class="wrongs">' + wrong.map(function(r){
        var q = r.q, plain = q.q.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        var body = '<div class="qtext">' + q.q + '</div>';
        if (q.type === "choice"){
          var ord = [0, 1, 2, 3];
          body += '<ol class="olist">' + ord.map(function(oi, n){
            return '<li class="' + (oi === q.answer ? "right" : (oi === r.picked ? "wrong" : "")) + '"><b>' + "ABCD"[n] + '</b>　' + q.options[oi] +
              (oi === q.answer ? '<span class="badge ok">正解</span>' : '') + (oi === r.picked ? '<span class="badge ng">あなたの解答</span>' : '') + '</li>';
          }).join("") + '</ol>';
          body += '<div class="small" style="margin-top:6px">' + explText(q, ord) + '</div>';
        } else if (q.type === "calc"){
          body += '<div style="margin-top:6px"><b>正解：' + q.answer + (q.unit || "") + '</b>' + (r.picked !== undefined ? '（あなたの解答：' + r.picked + (q.unit || "") + '）' : '') + '</div>' +
            '<div class="small" style="margin-top:6px">' + q.expl + '</div>';
        } else {
          body += '<div style="margin-top:6px"><b>模範解答</b><div>' + q.model + '</div></div><div class="small" style="margin-top:6px">' + q.expl + '</div>';
        }
        body += '<div class="small muted" style="margin-top:4px">根拠：シラバス ' + q.sec + '</div>' + R.reportHTML(EX.key, q, "第" + q.ch + "章の" + TYPES[q.type] + "演習の結果");
        return '<details><summary>第' + q.ch + '章・' + TYPES[q.type] + '　' + (plain.length > 40 ? plain.slice(0, 40) + '…' : plain) + ' <span class="qid">ID ' + q.id + '</span></summary>' + body + '</details>';
      }).join("") + '</div>';
    }
    html += '<div class="row" style="margin-top:12px">' +
      (wrong.length ? '<button class="btn primary" id="retry-wrong">間違えた問題をもう一度</button>' : '') +
      '<button class="btn" id="to-home">トップへ戻る</button></div>';
    $("result").innerHTML = html;
    if (wrong.length) $("retry-wrong").onclick = function(){ startPractice(wrong.map(function(r){ return r.q; })); };
    $("to-home").onclick = goHome;
    show("result");
  }

  /* ---------- 模擬試験 ---------- */
  function fmtDate(t){
    var d = new Date(t);
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + ('0'+d.getMinutes()).slice(-2);
  }

  function renderMockHome(){
    var sets = SETS, html = "";
    $("mock-title").textContent = "模擬試験（4択・" + MOCK_N + "問・" + MOCK_MIN + "分）";
    var distTxt = Object.keys(MOCK_DIST).map(function(k){ return k + "章" + MOCK_DIST[k] + "問"; }).join("・");
    $("mock-desc").textContent = "本番と同じ章ごとの出題数（" + distTxt + "）で出題します。解答中は正解を表示せず、最後にまとめて採点します。" +
      (EX.points ? "配点は問題ごとに異なり（学習目標の知識レベルに応じて1〜3点の目安）、合格ラインは満点の65%です。"
                 : "合格ラインは65%（" + Math.ceil(MOCK_N * PASS_RATE) + "問）です。");
    $("mock-random-desc").textContent = "すべての4択問題から、章ごとの出題数に合わせて毎回ランダムに" + MOCK_N + "問を選びます。";
    Object.keys(sets).forEach(function(name){
      var hist = store.mock.filter(function(h){ return h.set === name; });
      var last = hist[hist.length - 1];
      html += '<button class="setbtn" data-set="' + name + '"><div class="nm">セット' + name + '</div>' +
        (last ? '<div class="st ' + (last.pass ? "pass" : "fail") + '">前回 ' + last.score + '/' + (last.max || 40) + '</div>'
              : '<div class="st">未受験</div>') + '</button>';
    });
    $("mock-sets").innerHTML = html || '<div class="small muted">セットがありません。</div>';
    Array.prototype.forEach.call(document.querySelectorAll("#mock-sets .setbtn"), function(b){
      b.onclick = function(){ startMock(b.getAttribute("data-set")); };
    });

    var hist = store.mock.slice(-5).reverse();
    $("mock-history").innerHTML = '<h2>最近の模擬試験</h2>' + (hist.length
      ? '<table class="dist"><tr><th>日時</th><th>種類</th><th>得点</th><th>判定</th></tr>' + hist.map(function(h){
          return '<tr><td>' + fmtDate(h.t) + '</td><td>' + (h.set ? 'セット' + h.set : 'ランダム') +
            '</td><td class="n">' + h.score + '/' + (h.max || 40) + (EX.points ? '点' : '') + '</td><td class="' + (h.pass ? "pass" : "fail") + '">' + (h.pass ? "合格" : "不合格") + '</td></tr>';
        }).join("") + '</table>'
      : '<div class="small muted">まだ受験記録はありません。</div>');
  }

  /* ---------- 途中の模擬試験の保存と再開 ---------- */
  function mockKey(){ return STORE_KEY + "-mock"; }
  function saveMock(){
    if (!mock || mock.done) return;
    var left = Math.max(0, mock.end - Date.now());
    try {
      localStorage.setItem(mockKey(), JSON.stringify({
        ids: mock.list.map(function(q){ return q.id; }), order: mock.order, ans: mock.ans, flag: mock.flag,
        i: mock.i, left: left, set: mock.set, t: Date.now()
      }));
    } catch(e){}
  }
  function loadMock(){
    try {
      var m = JSON.parse(localStorage.getItem(mockKey()) || "null");
      if (!m || !m.ids) return null;
      var byId = {};
      Q.forEach(function(q){ byId[q.id] = q; });
      var list = m.ids.map(function(id){ return byId[id]; });
      if (list.some(function(q){ return !q; })) return { stale: true };   /* 問題が差し替わっていたら再開しない */
      m.list = list;
      return m;
    } catch(e){ return null; }
  }
  function clearMock(){ try { localStorage.removeItem(mockKey()); } catch(e){} }
  function fmtLeft(ms){ var s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }

  function runMock(m){
    mock = m;
    show("mock"); renderMockQ(); tick();
    clearInterval(timerId); timerId = setInterval(tick, 1000);
    window.scrollTo(0, 0);
  }
  function resumeMock(){
    var m = loadMock();
    if (!m || m.stale){ clearMock(); renderHome(); return; }
    runMock({ list: m.list, order: m.order, ans: m.ans, flag: m.flag || m.list.map(function(){ return false; }),
              i: m.i || 0, end: Date.now() + m.left, set: m.set, done: false });
  }

  /* setName を渡すとそのセット、省略すると完全ランダム */
  function startMock(setName){
    var saved = loadMock();
    if (saved && !saved.stale){
      askConfirm("中断中の模擬試験があります。\n破棄して新しく始めますか？（中断中の解答は元に戻せません）", "破棄して始める", function(){ clearMock(); startMock(setName); }, true);
      return;
    }
    clearMock();
    var list = [];
    if (setName){
      var byId = {};
      Q.forEach(function(q){ byId[q.id] = q; });
      list = (SETS[setName] || []).map(function(id){ return byId[id]; }).filter(Boolean);
      list.sort(function(a, b){ return a.ch - b.ch; });   /* 章の順に並べる */
    } else {
      var pool = byType("choice");
      Object.keys(MOCK_DIST).forEach(function(k){
        list = list.concat(shuffle(pool.filter(function(q){ return q.ch === +k; })).slice(0, MOCK_DIST[k]));
      });
    }
    runMock({
      list: list,
      order: list.map(function(q){ return shuffle(q.options.map(function(_, i){ return i; })); }),
      ans: list.map(function(){ return null; }),
      flag: list.map(function(){ return false; }),
      i: 0,
      end: Date.now() + MOCK_MIN * 60 * 1000,
      set: setName || null,
      done: false
    });
    saveMock();
  }

  function tick(){
    if (!mock || mock.done) return;
    var left = Math.max(0, Math.round((mock.end - Date.now()) / 1000));
    var t = $("m-timer");
    t.textContent = "残り " + Math.floor(left/60) + ":" + ("0" + left % 60).slice(-2);
    t.classList.toggle("low", left <= 300);
    if (left === 0){ closeModal(); submitMock(true); return; }
    if (left % 5 === 0) saveMock();   /* 残り時間を定期的に保存（閉じても続きから再開できる） */
  }

  function renderMockQ(){
    /* 書き直してもキーボードの操作位置を保つ */
    var fa = document.activeElement, keep = null;
    if (fa && fa.id === "m-flag") keep = "#m-flag";
    else if (fa && fa.classList && fa.classList.contains("opt") && fa.closest("#m-card")) keep = '#m-card .opt[data-i="' + fa.getAttribute("data-i") + '"]';
    else if (fa && fa.closest && fa.closest("#m-grid")) keep = "#m-grid button.cur";
    var q = mock.list[mock.i], sel = mock.ans[mock.i];
    var answered = mock.ans.filter(function(a){ return a !== null; }).length;
    $("m-progress").textContent = "問" + (mock.i+1) + " / " + mock.list.length + "　（解答済み " + answered + "）";
    var html = '<div class="qhead"><span class="tag">問' + (mock.i+1) + '</span><span class="tag">第' + q.ch + '章</span>' +
      (EX.points ? '<span class="tag">' + pt(q) + '点</span>' : '') +
      '<button class="btn small flagbtn' + (mock.flag[mock.i] ? " on" : "") + '" id="m-flag" type="button" aria-pressed="' + !!mock.flag[mock.i] + '">' +
      (mock.flag[mock.i] ? "● 見直しマークを外す" : "○ 見直しマークを付ける") + '</button></div><div class="qtext">' + q.q + '</div>';
    mock.order[mock.i].forEach(function(oi, n){
      html += '<button class="opt' + (sel === oi ? " sel" : "") + '" data-i="' + oi + '" aria-pressed="' + (sel === oi) + '"><span class="k">' + "ABCD"[n] + '</span>' + q.options[oi] + '</button>';
    });
    html += '<div class="kbd-hint">キーボード：1〜4 で選択、← → で前後の問題、F で見直しマーク</div>';
    $("m-card").innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll("#m-card .opt"), function(b){
      b.onclick = function(){ mock.ans[mock.i] = +b.getAttribute("data-i"); renderMockQ(); };
    });
    $("m-flag").onclick = toggleFlag;
    saveMock();
    $("m-prev").disabled = mock.i === 0;
    $("m-next").disabled = mock.i === mock.list.length - 1;
    var g = "";
    for (var i = 0; i < mock.list.length; i++){
      g += '<button data-i="' + i + '" class="' + (mock.ans[i] !== null ? "done" : "") + (mock.flag[i] ? " flag" : "") + (i === mock.i ? " cur" : "") + '"' +
        ' aria-label="問' + (i+1) + (mock.ans[i] !== null ? "（解答済み）" : "（未解答）") + (mock.flag[i] ? "（見直し）" : "") + '">' + (i+1) + '</button>';
    }
    $("m-grid").innerHTML = g;
    Array.prototype.forEach.call(document.querySelectorAll("#m-grid button"), function(b){
      b.onclick = function(){ mock.i = +b.getAttribute("data-i"); renderMockQ(); window.scrollTo(0,0); };
    });
    if (keep){ var k = document.querySelector(keep); if (k) k.focus({ preventScroll: true }); }
  }

  function toggleFlag(){ mock.flag[mock.i] = !mock.flag[mock.i]; renderMockQ(); }

  /* ---------- ポップアップ ---------- */
  function closeModal(){
    if ($("modal").classList.contains("hidden")) return;
    $("modal").classList.add("hidden");
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  /* 確認のポップアップ（ブラウザ標準の confirm はプレビューなどで表示されないことがあるため、自前のものを使う） */
  function askConfirm(msg, okLabel, onOk, danger){
    openModal(msg, null, [
      { label: "キャンセル" },
      { label: okLabel, primary: !danger, danger: !!danger, fn: onOk }
    ]);
  }
  function openModal(msg, nums, acts, numsKind){
    $("modal-msg").textContent = msg;
    $("modal-nums").innerHTML = "";
    (nums || []).forEach(function(i){
      var b = document.createElement("button");
      b.textContent = "問" + (i + 1);
      if (numsKind) b.className = numsKind;
      b.onclick = function(){ closeModal(); mock.i = i; renderMockQ(); window.scrollTo(0,0); };
      $("modal-nums").appendChild(b);
    });
    $("modal-acts").innerHTML = "";
    acts.forEach(function(a){
      var b = document.createElement("button");
      b.className = "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "");
      b.textContent = a.label;
      b.onclick = function(){ closeModal(); if (a.fn) a.fn(); };
      $("modal-acts").appendChild(b);
    });
    $("modal").classList.remove("hidden");
    lastFocus = document.activeElement;
    var first = $("modal-acts").querySelector(".primary") || $("modal-acts").querySelector("button");
    if (first) first.focus();
  }
  var lastFocus = null;
  if ($("modal")) $("modal").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  /* ポップアップ：Esc で閉じる、Tab はポップアップの中だけを移動する */
  document.addEventListener("keydown", function(e){
    if ($("modal").classList.contains("hidden")) return;
    if (e.key === "Escape"){ closeModal(); e.preventDefault(); }
    else if (e.key === "Tab"){
      var f = $("modal").querySelectorAll("button"); if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a){ z.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === z){ a.focus(); e.preventDefault(); }
    }
  });

  /* 「解答を提出して採点する」ボタン：未解答の有無で表示を分ける */
  function confirmSubmit(){
    if (!mock || mock.done) return;
    var blank = [];
    mock.ans.forEach(function(a, i){ if (a === null) blank.push(i); });
    if (blank.length){
      openModal("未解答の問があります。", blank, [{ label: "閉じる", primary: true }]);
    } else {
      var flagged = [];
      mock.flag.forEach(function(f, i){ if (f) flagged.push(i); });
      openModal("こちらで提出してよろしいですか？\n元に戻ることはできません" + (flagged.length ? "\n\n見直しマークが付いている問があります。" : ""), flagged, [
        { label: "キャンセル" },
        { label: "提出する", primary: true, fn: function(){ submitMock(false); } }
      ], "flagnum");
    }
  }

  function submitMock(timeUp){
    if (!mock || mock.done) return;
    var used = Math.min(MOCK_MIN * 60, MOCK_MIN * 60 - Math.round(Math.max(0, mock.end - Date.now()) / 1000));
    mock.done = true; clearInterval(timerId); clearMock();
    var correct = 0, pts = 0, maxPts = 0, byCh = {};
    mock.list.forEach(function(q, i){
      var ok = mock.ans[i] === q.answer, p = pt(q);
      maxPts += p;
      if (ok){ correct++; pts += p; }
      byCh[q.ch] = byCh[q.ch] || { ok:0, n:0, p:0, max:0 }; byCh[q.ch].n++; byCh[q.ch].max += p;
      if (ok){ byCh[q.ch].ok++; byCh[q.ch].p += p; }
      store.q[q.id] = { last: ok, t: Date.now() };
    });
    var need = Math.ceil(maxPts * PASS_RATE), pass = pts >= need;
    store.mock.push({ t: Date.now(), score: pts, max: maxPts, correct: correct, pass: pass, set: mock.set });
    save();

    var html = '<h2>模擬試験の結果（' + (mock.set ? 'セット' + mock.set : '完全ランダム') + '）' + (timeUp ? '（時間切れ）' : '') + '</h2>' +
      (EX.points
        ? '<div class="big ' + (pass ? "pass" : "fail") + '">' + pts + ' / ' + maxPts + '点　' + (pass ? "合格" : "不合格") + '</div>' +
          '<div class="small muted">正答 ' + correct + ' / ' + mock.list.length + '問 ／ 合格ライン ' + need + '点（65%）／ 所要時間 ' + Math.floor(used/60) + '分' + (used%60) + '秒</div>'
        : '<div class="big ' + (pass ? "pass" : "fail") + '">' + correct + ' / ' + mock.list.length + '　' + (pass ? "合格" : "不合格") + '</div>' +
          '<div class="small muted">合格ライン ' + need + '問（65%）／ 所要時間 ' + Math.floor(used/60) + '分' + (used%60) + '秒</div>') +
      '<table class="dist"><tr><th>章</th><th>正解</th>' + (EX.points ? '<th>得点</th>' : '') + '</tr>' + Object.keys(MOCK_DIST).map(function(k){
        var c = byCh[k] || { ok:0, n:0, p:0, max:0 };
        return '<tr><td>第' + k + '章　' + CHAPTERS[k] + '</td><td class="n">' + c.ok + ' / ' + c.n + '</td>' +
          (EX.points ? '<td class="n">' + c.p + ' / ' + c.max + '</td>' : '') + '</tr>';
      }).join("") + '</table>' +
      '<div class="small muted" style="margin-top:12px">番号を押すとその問題の解説へ移動します（緑：正解／赤：不正解・未解答）</div>' +
      '<div class="grid">' + mock.list.map(function(q, i){
        var st = mock.ans[i] === q.answer ? "正解" : (mock.ans[i] === null ? "未解答" : "不正解");
        return '<button onclick="document.getElementById(\'rv' + i + '\').scrollIntoView({behavior:\'smooth\'})" class="' + (mock.ans[i] === q.answer ? "ok" : "ng") + '" aria-label="問' + (i+1) + '（' + st + '）">' + (i+1) + '</button>';
      }).join("") + '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="mock-again">もう一度受ける</button><button class="btn" id="to-home">トップへ戻る</button></div>' +
      '<label class="small" style="display:block;margin-top:16px"><input type="checkbox" id="only-ng"> 間違えた問題（未解答を含む）だけ表示する</label>';

    mock.list.forEach(function(q, i){
      var a = mock.ans[i], ok = a === q.answer;
      html += '<div class="review' + (ok ? " rv-ok" : "") + '" id="rv' + i + '"><div><span class="tag">問' + (i+1) + '</span><span class="tag">第' + q.ch + '章</span><span class="tag">シラバス ' + q.sec + '</span>' +
        (EX.points ? '<span class="tag">' + pt(q) + '点</span>' : '') + '<span class="qid">ID ' + q.id + '</span> ' +
        '<b class="' + (ok ? "pass" : "fail") + '">' + (ok ? "正解" : (a === null ? "未解答" : "不正解")) + '</b></div>' +
        '<div class="qtext">' + q.q + '</div>';
      mock.order[i].forEach(function(oi, n){
        var cls = oi === q.answer ? " ok" : (oi === a ? " ng" : "");
        var badge = oi === q.answer ? '<span class="badge ok">正解</span>' + (oi === a ? '<span class="badge ok">あなたの解答</span>' : '')
                  : (oi === a ? '<span class="badge ng">あなたの解答</span>' : '');
        html += '<div class="opt' + cls + '"><span class="k">' + "ABCD"[n] + '</span>' + q.options[oi] + badge + '</div>';
      });
      html += '<div class="small">' + explText(q, mock.order[i]) + '</div>' +
        R.reportHTML(EX.key, q, (mock.set ? "模擬試験セット" + mock.set : "模擬試験（完全ランダム）") + " 問" + (i+1)) + '</div>';
    });

    $("result").innerHTML = html;
    $("only-ng").onchange = function(){
      var on = this.checked;
      Array.prototype.forEach.call(document.querySelectorAll("#result .rv-ok"), function(d){ d.classList.toggle("hidden", on); });
    };
    var again = mock.set; $("mock-again").onclick = function(){ startMock(again); };
    $("to-home").onclick = function(){ tab = "mock"; goHome(); };
    show("result");
  }

  function goHome(){ clearInterval(timerId); renderHome(); show("home"); }
  function resetHeader(){
    mock = null; EX = null;
    $("sub").textContent = "非公式オリジナル問題";
    $("footer-src").textContent = "出典：ISTQB® テスト技術者資格制度 Foundation Level シラバス、Advanced Level シラバス テストマネジメント（著作権：International Software Testing Qualifications Board）およびその日本語翻訳版（著作権：JSTQB®）。";
  }
  function goTop(){ clearInterval(timerId); resetHeader(); document.title = BASE_TITLE; show("top"); }
  function mockRunning(){ var v = $("view-mock"); return !!(mock && !mock.done && v && !v.classList.contains("hidden")); }
  /* URLの末尾（#fl / #tm）で開く資格を決める。ブックマークや共有にも使える */
  function route(){
    clearInterval(timerId);
    if (PAGE.name !== "index"){
      resetHeader();
      if (PAGE.name === "explain-set"){ setNav("explain"); renderExplainSet(PAGE.exam, PAGE.set); show("explain-set"); }
      else if (PAGE.name === "explain"){ setNav("explain"); renderExplainList(); show("explain"); }
      else if (PAGE.name === "about"){ setNav("about"); show("about"); }
      else if (PAGE.name === "glossary"){ setNav("glossary"); renderGlossary(); show("glossary"); }
      else if (PAGE.name === "privacy"){ setNav(""); show("privacy"); }
      else if (PAGE.name === "contact"){ setNav(""); renderReportBox(); show("contact"); }
      else if (PAGE.name === "changelog"){ setNav(""); $("changelog-list").innerHTML = R.changelogHTML(); show("changelog"); }
      else if (["notfound","howto","faq","operator"].indexOf(PAGE.name) >= 0){ setNav(""); show(PAGE.name); }
      return;
    }
    var parts = (location.hash || "").replace("#", "").split("/");
    var key = parts[0];
    if (EXAMS[key]){ selectExam(key); tab = "choice"; setNav("practice"); goHome(); return; }
    /* 以前の #explain などのURLで来た場合は、新しいページへ移動する */
    if (key === "explain"){ goPage(parts[2] ? "explain-" + parts[1] + "-" + parts[2] + ".html" : "explain.html", true); return; }
    if (key === "about" || key === "glossary"){ goPage(key + ".html", true); return; }
    resetHeader(); setNav("practice"); goTop();
  }

  /* ページ移動。プレビュー版（1ファイルに全ページが入っている）では、ファイルを開き直さずに画面を切り替える */
  function pageFromFile(f){
    var m = /^explain-([a-z]+)-([A-Z])\.html$/.exec(f);
    if (m) return { name: "explain-set", exam: m[1], set: m[2] };
    var n = f.replace(/\.html$/, "");
    return { name: n === "404" ? "notfound" : n };
  }
  function goPage(href, replace){
    if (!window.PREVIEW){ if (replace) location.replace(href); else location.href = href; return; }
    var qs = href.indexOf("?") >= 0 ? href.slice(href.indexOf("?")).split("#")[0] : "";
    window.PREVIEW_QUERY = qs;
    href = href.replace(/\?[^#]*/, "");
    var parts = href.split("#"), f = parts[0] || "index.html", pg = pageFromFile(f);
    if (mockRunning()){ saveMock(); mock.done = true; }
    PAGE.name = pg.name; PAGE.exam = pg.exam; PAGE.set = pg.set;
    if ($("explain-set")) $("explain-set").innerHTML = "";
    var h = parts[1] ? "#" + parts[1] : "";
    if (pg.name === "index" && location.hash !== h){ location.hash = h; return; }   /* hashchange で route() が動く */
    route(); window.scrollTo(0, 0);
  }
  if (window.PREVIEW){
    document.addEventListener("click", function(ev){
      var a = ev.target.closest && ev.target.closest("a[href]");
      if (!a || ev.defaultPrevented) return;
      var href = a.getAttribute("href");
      if (!/^[\w-]+\.html([?#].*)?$/.test(href)) return;
      ev.preventDefault();
      if (a.target === "_blank"){   /* プレビューでは別タブを開けないので、内容をポップアップで見せる（演習の途中経過を消さない） */
        var sp = new URLSearchParams(href.indexOf("?") >= 0 ? href.slice(href.indexOf("?")).split("#")[0] : "");
        var info = R.reportInfo(sp.get("q"), sp.get("w"));
        openModal((info ? info + "\n\n" : "") + "（プレビューのため、ここに表示しています。公開したサイトでは、お問い合わせページが新しいタブで開きます）", null, [{ label: "閉じる", primary: true }]);
        return;
      }
      goPage(href);
    });
  }

  /* お問い合わせページ：「誤りを報告」から来たときは、報告する問題の情報を表示する */
  function renderReportBox(){
    var box = $("report-box"); if (!box) return;
    var sp = new URLSearchParams(window.PREVIEW ? (window.PREVIEW_QUERY || "") : location.search);
    var info = R.reportInfo(sp.get("q"), sp.get("w"));
    box.classList.toggle("hidden", !info);
    if (!info) return;
    box.innerHTML = '<b>報告する問題</b><div class="small" style="margin-top:4px">次の内容をコピーして、フォームの「お問い合わせ内容」に貼り付け、どこが誤りかを書き足してください（お問い合わせ種別は「不具合報告」を選んでください）。</div>' +
      '<pre id="report-text"></pre><button class="btn small" id="report-copy" type="button">内容をコピーする</button> <span class="small muted" id="report-copied" role="status"></span>';
    $("report-text").textContent = info;
    $("report-copy").onclick = function(){
      var done = function(){ $("report-copied").textContent = "コピーしました"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(info).then(done, selectText);
      else selectText();
    };
    function selectText(){
      var r = document.createRange(); r.selectNodeContents($("report-text"));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      $("report-copied").textContent = "選択しました。コピーしてください";
    }
  }

  /* ---------- 問題解説 ---------- */
  function renderExplainList(){ $("explain-list").innerHTML = R.explainListHTML(); }

  function renderExplainSet(k, name){
    if (!$("explain-set").firstElementChild) $("explain-set").innerHTML = R.explainSetHTML(k, name);   /* ビルド時に書き出し済みならそのまま使う */
    Array.prototype.forEach.call(document.querySelectorAll("#explain-set details"), function(d){
      d.addEventListener("toggle", function(){
        Array.prototype.forEach.call(d.parentNode.querySelectorAll(".olist li"), function(li){
          li.classList.toggle("right", d.open && li.getAttribute("data-right") === "1");
        });
      });
    });
    $("ex-toggle").textContent = "すべての解答・解説を開く";
  }

  /* ---------- 用語集 ---------- */
  var glCat = "すべて";
  function renderGlossary(){
    $("gl-cats").innerHTML = R.glossaryCatsHTML(glCat);
    Array.prototype.forEach.call(document.querySelectorAll("#gl-cats .chip"), function(b){
      b.onclick = function(){
        glCat = b.getAttribute("data-cat"); renderGlossary();
        var again = document.querySelector('#gl-cats .chip[data-cat="' + glCat + '"]'); if (again) again.focus();
      };
    });
    $("gl-list").innerHTML = R.glossaryListHTML(glCat, $("gl-q").value);
    Array.prototype.forEach.call(document.querySelectorAll("#gl-list a[data-see]"), function(a){
      a.onclick = function(ev){
        ev.preventDefault();
        var t = a.getAttribute("data-see");
        glCat = "すべて"; $("gl-q").value = ""; renderGlossary();
        var el = document.getElementById("gl-" + encodeURIComponent(t));
        if (el){
          el.scrollIntoView({ block: "start" });
          el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
          el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true });
        }
      };
    });
  }

  /* ---------- イベント ---------- */
  /* ページによっては存在しない要素もあるので、あるときだけ登録する */
  function bind(id, prop, fn){ var el = $(id); if (el) el[prop] = fn; }
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(b){
    b.onclick = function(){ tab = b.getAttribute("data-tab"); renderHome(); };
  });
  bind("home-link", "onclick", function(ev){
    ev.preventDefault();
    if (PAGE.name !== "index"){ goPage("index.html"); return; }
    /* どの画面からでも、資格を選ぶトップ画面に戻る */
    var toTop = function(){
      if (location.hash){ location.hash = ""; return; }   /* hashchange で route() → トップ */
      goTop(); setNav("practice");
    };
    if (mockRunning()){
      askConfirm("模擬試験を中断してトップへ戻りますか？\n（途中の解答は保存され、あとで再開できます）", "中断して戻る", function(){ saveMock(); mock.done = true; toTop(); });
      return;
    }
    toTop();
  });
  Array.prototype.forEach.call(document.querySelectorAll("#view-top .exam"), function(b){
    b.onclick = function(){ location.hash = b.getAttribute("data-exam"); };
  });
  bind("gl-q", "oninput", renderGlossary);
  bind("ex-toggle", "onclick", function(){
    var ds = document.querySelectorAll("#explain-set details"), open = this.textContent.indexOf("開く") >= 0;
    Array.prototype.forEach.call(ds, function(d){ d.open = open; });
    this.textContent = open ? "すべての解答・解説を閉じる" : "すべての解答・解説を開く";
  });
  /* 模擬試験の途中で、メニュー以外のリンク（フッターなど）を押したときも確認する */
  document.addEventListener("click", function(ev){
    if (!mockRunning()) return;
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.closest("#gnav") || a.id === "home-link") return;
    var href = a.getAttribute("href");
    if (!/^[\w-]+\.html([?#].*)?$/.test(href)) return;
    ev.preventDefault(); ev.stopPropagation();
    askConfirm("模擬試験を中断して移動しますか？\n（途中の解答は保存され、あとで再開できます）", "中断して移動", function(){
      saveMock(); mock.done = true; goPage(href);
    });
  }, true);
  /* 模擬試験の途中でメニューを押したときは確認する */
  Array.prototype.forEach.call(document.querySelectorAll("#gnav a"), function(a){
    a.addEventListener("click", function(ev){
      if (mockRunning()){
        ev.preventDefault();
        askConfirm("模擬試験を中断して移動しますか？\n（途中の解答は保存され、あとで再開できます）", "中断して移動", function(){
          saveMock(); mock.done = true;
          if (PAGE.name === "index" && a.getAttribute("data-nav") === "practice"){ if (location.hash) location.hash = ""; else route(); }
          else goPage(a.getAttribute("href"));
        });
      }
      else if (PAGE.name === "index" && a.getAttribute("data-nav") === "practice"){ ev.preventDefault(); if (mockRunning()){ saveMock(); mock.done = true; } if (location.hash) location.hash = ""; else route(); }
    });
  });
  window.addEventListener("hashchange", function(){
    if (PAGE.name !== "index") return;
    if (mockRunning()){ saveMock(); mock.done = true; }
    route();
  });
  bind("q-report", "onclick", openReport);
  bind("report-close", "onclick", closeReport);
  if ($("report")) $("report").addEventListener("click", function(e){ if (e.target === this) closeReport(); });
  document.addEventListener("keydown", function(e){
    if (!$("report") || $("report").classList.contains("hidden")) return;
    if (e.key === "Escape"){ closeReport(); e.preventDefault(); return; }
    if (e.key === "Tab"){   /* 成績詳細の中だけでフォーカスを移動する */
      var f = $("report").querySelectorAll("button, a[href], [tabindex='0']"); if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a){ z.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === z){ a.focus(); e.preventDefault(); }
      else if (!$("report").contains(document.activeElement)){ a.focus(); e.preventDefault(); }
    }
  });
  bind("quit", "onclick", function(){ if (state.results.length) renderPracticeResult(); else goHome(); });
  bind("start-all", "onclick", function(){ startPractice(practiceTarget(null)); });
  bind("only-wrong", "onchange", renderHome);
  bind("mock-random", "onclick", function(){ startMock(null); });
  bind("m-prev", "onclick", function(){ mock.i--; renderMockQ(); window.scrollTo(0,0); });
  bind("m-next", "onclick", function(){ mock.i++; renderMockQ(); window.scrollTo(0,0); });
  bind("m-submit", "onclick", confirmSubmit);
  bind("m-abort", "onclick", function(){
    askConfirm("模擬試験を中断しますか？\n途中の解答と残り時間は保存され、「模擬試験」タブからあとで再開できます。", "中断する", function(){
      saveMock(); mock.done = true; tab = "mock"; goHome();
    });
  });
  bind("reset", "onclick", function(){
    askConfirm("このブラウザに保存された、この資格の成績と模擬試験の記録（中断中の模擬試験を含む）をすべて消去しますか？\n元に戻すことはできません。", "消去する", function(){
      store = { q: {}, mock: [] }; save(); clearMock(); renderHome();
    }, true);
  });

  /* ページを閉じる・隠すときにも残り時間を保存する */
  window.addEventListener("pagehide", function(){ if (mock && !mock.done) saveMock(); });
  document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "hidden" && mock && !mock.done) saveMock(); });

  /* キーボード操作（入力欄やポップアップの表示中は無効） */
  document.addEventListener("keydown", function(e){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || !$("modal").classList.contains("hidden") || ($("report") && !$("report").classList.contains("hidden"))) return;
    var vq = $("view-quiz");
    var k = e.key, n = "1234".indexOf(k) >= 0 ? +k - 1 : "abcd".indexOf(k.toLowerCase());
    if (k.length !== 1) n = -1;
    if (mockRunning()){
      if (n >= 0){ var b = document.querySelectorAll("#m-card .opt")[n]; if (b){ b.click(); e.preventDefault(); } }
      else if (k === "ArrowLeft" && mock.i > 0){ $("m-prev").click(); e.preventDefault(); }
      else if (k === "ArrowRight" && mock.i < mock.list.length - 1){ $("m-next").click(); e.preventDefault(); }
      else if (k === "f" || k === "F"){ toggleFlag(); e.preventDefault(); }
    } else if (vq && !vq.classList.contains("hidden")){
      var opts = document.querySelectorAll("#q-card .opt");
      if (n >= 0 && opts[n] && !opts[n].disabled){ opts[n].click(); e.preventDefault(); }
      else if (k === "Enter" && t !== "BUTTON" && t !== "A" && !$("next").classList.contains("hidden")){ $("next").click(); e.preventDefault(); }
    }
  });

  route();
})();
