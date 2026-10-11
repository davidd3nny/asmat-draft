/*
  Əsmət: два меню заведения стоят рядом, как две половины одного листа.
  Слева кухня, справа винная карта. Блюдо и его вино соединяет нить.
  Меню, цены, пары и тексты лежат в data.json, оформление в style.css.
  Здесь поведение: часы половин, сдвиг половин на телефоне, разделы и отбор вин, нить пары, режим «Пары».
*/
(function () {
  "use strict";
  var C = window.Core, D = window.DATA, U = D.ui, el = C.el;
  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var stage = $("stage"), strip = $("strip");
  var H = {
    k: { data: D.kitchen, panel: $("metbex"), scroll: $("k-scroll"), menu: $("k-menu"), spine: $("k-spine"), label: $("k-label"), jump: $("k-jump"), cur: null },
    b: { data: D.bar, panel: $("bar"), scroll: $("b-scroll"), menu: $("b-menu"), spine: $("b-spine"), label: $("b-label"), jump: $("b-jump"), cur: null }
  };
  function other(side) { return side === "k" ? "b" : "k"; }

  /* Все позиции по id и пары: у блюда и у вина один номер пары */
  var ITEM = {}, PAIR = {}, WINES = [];
  ["k", "b"].forEach(function (side) {
    H[side].data.sections.forEach(function (s) {
      s.items.forEach(function (it) { ITEM[it.id] = { it: it, side: side, sec: s.id }; if (side === "b") WINES.push(it); });
    });
  });
  D.pairs.forEach(function (p, i) { PAIR[p.dish] = i; PAIR[p.drink] = i; });
  function pairIds(i) { return { k: D.pairs[i].dish, b: D.pairs[i].drink }; }
  /* пара считается по бокалу: блюдо и один бокал вина к нему */
  function pairSum(i) { return ITEM[D.pairs[i].dish].it.price + ITEM[D.pairs[i].drink].it.glass; }
  var N_GLASS = WINES.filter(function (w) { return w.glass != null; }).length;
  var N_LOCAL = WINES.filter(function (w) { return w.local; }).length;

  /* В данных кухни строка «Название | пояснение»: черта делит её на две части */
  function nameOf(it) { return C.t(it.name).split(" | ")[0]; }
  function wineName(it) { return C.t(it.name).replace(/(\S)&(\S)/g, "$1&\u200B$2"); }   /* «Passione&Sentimento»: перенос после знака & */
  function descOf(it) { return C.t(it.name).split(" | ").slice(1).join(", "); }
  function icon(id) {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use");
    s.setAttribute("class", "ic");
    s.setAttribute("viewBox", "0 0 12 20");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    u.setAttribute("href", "#" + id);
    s.appendChild(u);
    return s;
  }

  /* ---------- состояние ---------- */
  var wide = window.matchMedia("(min-width: 1024px)");
  var view = "cover";        /* телефон: "cover" (обе половины), "k" (кухня), "b" (вино) */
  var pinned = null;         /* выбранная пара */
  var hover = null;          /* пара под курсором или в фокусе (компьютер) */
  var drawn = null;          /* для какой пары нить уже нарисована */
  var wf = "all";            /* отбор вин: "all", "glass", "local" */
  var pairsFocus = null;
  function isWide() { return wide.matches; }

  /* Вечер идёт от открытия до закрытия: все часы считаем в минутах от открытия */
  var OPEN = C.toMin(D.bar.hours.open);
  function fromOpen(hhmm) { return (C.toMin(hhmm) - OPEN + 1440) % 1440; }
  var SPAN = fromOpen(D.bar.hours.close);                 /* 17:00–01:00 = 480 минут */
  var K_END = fromOpen(D.kitchen.hours.close);            /* кухня закрывается */
  /* Время последнего заказа владелец пока не назвал: тогда кухня работает до закрытия и «последних заказов» нет */
  var HAS_LAST = !!D.kitchen.lastOrders;
  var K_LAST_FROM = HAS_LAST ? fromOpen(D.kitchen.lastFrom || D.kitchen.lastOrders) : K_END;
  var K_LAST = HAS_LAST ? fromOpen(D.kitchen.lastOrders) : K_END;
  var K_FULL = K_END >= SPAN;                              /* кухня закрывается вместе с заведением */

  /* ---------- часы и статусы половин ---------- */
  function evening() {
    var e = (C.now().min - OPEN + 1440) % 1440;
    return e < SPAN ? e : null;                           /* null: заведение закрыто */
  }
  function states(e) {
    var k = e == null ? "closed" : e < K_LAST_FROM ? "cooking" : e < K_LAST ? "last" : "late";
    return { k: k, b: e == null ? "closed" : k === "late" ? "openLate" : "open" };
  }
  function statusText(side, st) {
    var open = D.bar.hours.open;
    var map = {
      k: {
        cooking: [C.fill(C.t(U.kCooking), { t: D.kitchen.hours.close })],
        last: [C.fill(C.t(U.kLast), { t: D.kitchen.lastOrders })],
        late: [C.t(U.kLate), C.t(U.kLateMore)],
        closed: [C.fill(C.t(U.kClosed), { t: open })]
      },
      b: {
        open: [C.fill(C.t(U.bOpen), { t: D.bar.hours.close })],
        openLate: [C.fill(C.t(U.bOpen), { t: D.bar.hours.close }), C.t(U.bOpenLateMore)],
        closed: [C.fill(C.t(U.bClosed), { t: open }), C.t(U.bClosedMore)]
      }
    };
    return map[side][st];
  }
  function pct(v) { return (Math.round(v * 10000) / 100) + "%"; }
  function ruler(side, e) {
    var node = $(side + "-ruler"), n = C.now(), nowLabel = C.hhmm(n.min);
    node.textContent = "";
    function add(cls, css, text) {
      var s = el("span", cls, text);
      Object.keys(css || {}).forEach(function (k) { s.style[k] = css[k]; });
      node.appendChild(s);
      return s;
    }
    if (side === "k") {
      add("track", { width: pct(K_LAST / SPAN) });
      add("late", { left: pct(K_LAST / SPAN), width: pct((K_END - K_LAST) / SPAN) });
      add("rest", { left: pct(K_END / SPAN) });
      add("lb", { left: "0" }, D.kitchen.hours.open);
      add(K_FULL ? "lb end" : "lb mid", { left: pct(Math.min(K_END, SPAN) / SPAN) }, D.kitchen.hours.close);
    } else {
      add("track");
      add("cap", { left: "0" });
      add("cap", { left: "100%" });
      if (!K_FULL) add("tick", { left: pct(K_END / SPAN) });
      add("lb", { left: "0" }, D.bar.hours.open);
      if (!K_FULL && (SPAN - K_END) / SPAN > .22) add("lb mid", { left: pct(K_END / SPAN) }, D.kitchen.hours.close);
      add("lb end", { left: "100%" }, D.bar.hours.close);
    }
    if (e != null) add("now", { left: pct(e / SPAN) }).appendChild(el("b", null, nowLabel));
    var label = side === "k"
      ? C.fill(C.t(HAS_LAST ? U.rulerK : U.rulerK0), { a: D.kitchen.hours.open, b: D.kitchen.hours.close, l: D.kitchen.lastOrders })
      : C.fill(C.t(U.rulerB), { a: D.bar.hours.open, b: D.bar.hours.close });
    node.setAttribute("aria-label", label + " " + C.fill(C.t(U.nowAt), { t: nowLabel }));
  }
  function renderClock() {
    var e = evening(), st = states(e);
    ["k", "b"].forEach(function (side) {
      var t = statusText(side, st[side]);
      var top = $(side + "-status");
      top.textContent = t[0];
      top.dataset.state = st[side];
      var big = $(side + "-status-big");
      big.textContent = "";
      big.appendChild(el("span", "s-short", t[0] + (t[1] ? " " : "")));
      if (t[1]) big.appendChild(el("span", "s-more", t[1]));
      big.hidden = false;
      $(side + "-spine-s").textContent = t[0];
      ruler(side, e);
    });
    stage.dataset.k = st.k;
    stage.dataset.b = st.b;
  }

  /* Пара вечера для первого экрана: каждый день следующая по списку.
     После полуночи вечер ещё тот же, поэтому до закрытия считаем вчерашний день. */
  function tonightPair() {
    var day = Math.floor(C.today().getTime() / 864e5);
    if (C.now().min < C.toMin(D.bar.hours.close)) day -= 1;
    return ((day % D.pairs.length) + D.pairs.length) % D.pairs.length;
  }
  function renderTonight() {
    var i = tonightPair(), ids = pairIds(i);
    $("k-tonight").dataset.pair = $("b-tonight").dataset.pair = String(i);
    $("k-tonight-l").textContent = C.t(U.tonight);
    $("k-tonight-n").textContent = nameOf(ITEM[ids.k].it);
    $("b-tonight-n").textContent = wineName(ITEM[ids.b].it);
    $("bead").textContent = C.price(pairSum(i));
  }
  function placeBead() {                                  /* бусина с ценой пары сидит на шве, на линии нити */
    var r = $("k-tonight").getBoundingClientRect();
    if (r.height) $("bead").style.top = Math.round(r.bottom - stage.getBoundingClientRect().top - 1) + "px";
  }

  /* ---------- тексты ---------- */
  function langRow(node) {
    node.textContent = "";
    node.setAttribute("aria-label", C.t(U.lang));
    C.LANGS.forEach(function (code) {
      var b = el("button", null, code);
      b.type = "button";
      b.dataset.lang = code;
      b.lang = code;
      b.setAttribute("aria-pressed", code === C.lang ? "true" : "false");
      node.appendChild(b);
    });
  }
  function measure() {                                   /* высота плашки «черновик» нужна стилям режима «Пары» */
    document.documentElement.style.setProperty("--draft-h", (D.draft ? $("draft").offsetHeight : 0) + "px");
  }
  function renderText() {
    document.title = C.t(D.title) + (D.draft ? " (" + C.t(U.draftWord) + ")" : "");
    $("brand").textContent = D.brand;
    var draft = $("draft");
    draft.hidden = !D.draft;
    draft.textContent = C.t(U.draft);
    measure();

    $("k-label").textContent = C.t(U.kLabel);
    $("b-label").textContent = C.t(U.bLabel);
    $("k-tag").textContent = C.t(U.kTag);
    $("b-tag").textContent = C.fill(C.t(U.bTag), { n: WINES.length, g: N_GLASS });
    $("k-rule").textContent = HAS_LAST ? C.fill(C.t(U.kRule), { t: D.kitchen.lastOrders }) : C.t(U.fee);
    $("b-rule").textContent = C.t(U.bRule);
    $("k-enter").textContent = C.t(U.kEnter);
    $("b-enter").textContent = C.t(U.bEnter);
    $("k-book").textContent = C.t(U.book);
    $("k-book").href = C.wa(D.phone, C.t(U.waText));
    $("b-find").textContent = C.t(U.find);

    $("k-foot-h").textContent = C.t(U.bookHead);
    $("k-foot-note").textContent = C.t(U.bookNote);
    $("k-wa").textContent = C.t(U.book);
    $("k-wa").href = C.wa(D.phone, C.t(U.waText));
    $("k-call").textContent = C.t(U.call);
    $("k-call").href = C.tel(D.phone);
    $("k-tel").textContent = D.phoneDisplay;
    $("b-foot-h").textContent = C.t(U.find);
    $("b-addr").textContent = C.t(D.address);
    $("b-hours").textContent = C.fill(C.t(K_FULL ? U.hoursLine0 : U.hoursLine), { b: D.kitchen.hours.close, c: D.bar.hours.open, d: D.bar.hours.close });
    $("b-rule2").textContent = C.t(U.bRule);
    $("b-map").textContent = C.t(U.openMap);
    $("b-map").href = D.mapUrl;
    $("b-ig").textContent = D.instagram.handle;
    $("b-ig").href = D.instagram.url;

    all('[data-t="pairs"]').forEach(function (n) { n.textContent = C.t(U.pairs); });
    all('[data-t="pairs-n"]').forEach(function (n) { n.textContent = String(D.pairs.length); });
    all('[data-t="fee"]').forEach(function (n) { n.textContent = C.t(U.fee); });
    all('[data-t="concept"]').forEach(function (n) { n.textContent = D.draft ? C.t(U.concept) : ""; });
    all('[data-t="credit"]').forEach(function (n) { n.textContent = D.credit ? C.fill(C.t(U.credit), { who: D.credit }) : ""; });
    $("pairs-open").textContent = C.t(U.pairs);

    var lg = $("b-legend");
    lg.textContent = "";
    lg.appendChild(icon("glass"));
    lg.appendChild(document.createTextNode(C.t(U.legend)));

    $("lang").setAttribute("aria-label", C.t(U.lang));
    C.LANGS.forEach(function (code) { $("lang-" + code).setAttribute("aria-pressed", code === C.lang ? "true" : "false"); });
    all(".lang-row").forEach(langRow);
    $("k-spine-l").textContent = C.t(U.kLabel);
    $("b-spine-l").textContent = C.t(U.bLabel);
    H.k.spine.setAttribute("aria-label", C.t(U.kEnter));
    H.b.spine.setAttribute("aria-label", C.t(U.bEnter));
  }

  /* ---------- меню половин ---------- */
  function winePrice(it) {                               /* «бокал 15 / 79 ₼», «79 ₼», «бокал 9 ₼» или год и цена */
    var pr = el("span", "pr");
    if (it.vint) {
      it.vint.forEach(function (v) {
        var row = el("span", "vt");
        row.appendChild(el("span", "vy", String(v.y)));
        row.appendChild(document.createTextNode(" " + C.price(v.bottle)));
        pr.appendChild(row);
      });
      return pr;
    }
    if (it.glass != null) {
      var g = el("span", "gl");
      g.appendChild(icon("glass"));
      g.appendChild(el("span", "vh", C.t(U.wGlass) + " "));
      g.appendChild(document.createTextNode(it.bottle != null ? C.money(it.glass) : C.price(it.glass)));
      pr.appendChild(g);
    }
    if (it.bottle != null) {
      if (it.glass != null) pr.appendChild(el("span", "sl", " / "));
      var b = el("span", "bt");
      if (it.glass != null) b.appendChild(el("span", "vh", C.t(U.wBottle) + " "));
      b.appendChild(document.createTextNode(C.price(it.bottle)));
      pr.appendChild(b);
    }
    return pr;
  }
  function itemNode(it, side) {
    var pi = PAIR[it.id], paired = pi != null;
    var n = el(paired ? "button" : "div", "item" + (paired ? " has-pair" : "") + (paired && pi === pinned ? " lit" : ""));
    n.id = "i-" + it.id;
    if (paired) { n.type = "button"; n.dataset.id = it.id; }
    if (side === "k") {
      n.appendChild(el("span", "nm", nameOf(it)));
      n.appendChild(el("span", "pr", C.price(it.price)));
      if (descOf(it)) n.appendChild(el("span", "ds", descOf(it)));
    } else {
      n.appendChild(el("span", "nm", wineName(it)));
      n.appendChild(winePrice(it));
      var sub = [it.org, it.grp].filter(Boolean).join(" | ");
      if (sub) n.appendChild(el("span", "ds", sub));
    }
    if (paired) {                                       /* имя пары набрано шрифтом другой половины */
      var mate = ITEM[pairIds(pi)[other(side)]].it;
      var pl = el("span", "pl");
      pl.appendChild(el("span", "vh", C.t(U.hasPair) + ": "));
      pl.appendChild(document.createTextNode("+ " + (side === "k" ? wineName(mate) : nameOf(mate))));
      /* у выбранной пары строка договаривает: кухне вино объясняет «почему», вину кухня называет сумму */
      pl.appendChild(el("span", "wy", ". " + (side === "k" ? C.t(D.pairs[pi].why) : C.fill(C.t(U.together), { p: C.price(pairSum(pi)) }) + ".")));
      n.appendChild(pl);
      var plug = el("span", "plug");
      plug.setAttribute("aria-hidden", "true");
      n.appendChild(plug);
    }
    return n;
  }
  function renderMenu(side) {
    var box = H[side].menu;
    box.textContent = "";
    H[side].data.sections.forEach(function (s) {
      var sec = el("section", "sec");
      sec.dataset.sec = s.id;
      var h = el("h3", "sec-h", C.t(s.name));
      h.id = side + "-sec-" + s.id;
      sec.setAttribute("aria-labelledby", h.id);
      sec.appendChild(h);
      if (s.note) sec.appendChild(el("p", "sec-note", C.t(s.note)));
      var ul = el("ul");
      s.items.forEach(function (it) { var li = el("li"); li.dataset.id = it.id; li.appendChild(itemNode(it, side)); ul.appendChild(li); });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
  }
  function markLit() {
    all(".item.lit").forEach(function (n) { n.classList.remove("lit"); });
    if (pinned == null) return;
    var ids = pairIds(pinned);
    $("i-" + ids.k).classList.add("lit");
    $("i-" + ids.b).classList.add("lit");
  }
  function flash(id) {
    var n = $("i-" + id);
    if (!n) return;
    n.classList.remove("flash");
    void n.offsetWidth;
    n.classList.add("flash");
    setTimeout(function () { n.classList.remove("flash"); }, 1200);
  }

  /* ---------- разделы: строка быстрых переходов под шапкой половины ---------- */
  function renderJump(side) {
    var nav = H[side].jump;
    nav.textContent = "";
    nav.setAttribute("aria-label", C.t(U.sections) + ": " + C.t(side === "k" ? U.kLabel : U.bLabel));
    H[side].data.sections.forEach(function (s) {
      var b = el("button", null, C.t(s.name));
      b.type = "button";
      b.dataset.jump = s.id;
      b.dataset.side = side;
      nav.appendChild(b);
    });
    H[side].cur = null;
  }
  function stickH(side) {                                /* сколько места сверху занимают шапка и строка разделов */
    var top = H[side].scroll.querySelector(".top").offsetHeight, j = H[side].jump;
    return top + (j.offsetHeight || 0);
  }
  function jumpTo(side, sid) {
    var s = H[side].scroll, h = $(side + "-sec-" + sid);
    if (!h) return;
    s.scrollTo({ top: Math.max(0, offsetIn(side, h) - stickH(side) - 6), behavior: C.reducedMotion ? "auto" : "smooth" });
  }
  function syncJump(side) {                              /* подсветить раздел, который сейчас под шапкой */
    var s = H[side].scroll, nav = H[side].jump;
    if (!nav.offsetHeight) return;
    var line = s.getBoundingClientRect().top + stickH(side) + 18, cur = null;
    all("#" + H[side].menu.id + " .sec").forEach(function (sec) {
      if (!sec.hidden && sec.getBoundingClientRect().top <= line) cur = sec.dataset.sec;
    });
    if (cur === H[side].cur) return;
    H[side].cur = cur;
    Array.prototype.forEach.call(nav.children, function (b) {
      var on = b.dataset.jump === cur;
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      if (on) nav.scrollLeft = Math.max(0, b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2);
    });
  }

  /* ---------- отбор вин: все, бокалами, из Азербайджана ---------- */
  function renderFilter() {
    var box = $("b-filter");
    box.textContent = "";
    box.setAttribute("aria-label", C.t(U.filter));
    [["all", U.fAll, WINES.length], ["glass", U.fGlass, N_GLASS], ["local", U.fLocal, N_LOCAL]].forEach(function (f) {
      var b = el("button", null, C.t(f[1]) + " ");
      b.type = "button";
      b.dataset.f = f[0];
      b.setAttribute("aria-pressed", wf === f[0] ? "true" : "false");
      b.appendChild(el("b", null, String(f[2])));
      box.appendChild(b);
    });
  }
  function passes(it) { return wf === "all" || (wf === "glass" ? it.glass != null : !!it.local); }
  function applyFilter() {
    all("#b-menu .sec").forEach(function (sec) {
      var shown = 0;
      Array.prototype.forEach.call(sec.querySelectorAll("li"), function (li) {
        var ok = passes(ITEM[li.dataset.id].it);
        li.hidden = !ok;
        if (ok) shown++;
      });
      sec.hidden = !shown;
      var chip = H.b.jump.querySelector('[data-jump="' + sec.dataset.sec + '"]');
      if (chip) chip.hidden = !shown;
    });
    Array.prototype.forEach.call($("b-filter").children, function (b) { b.setAttribute("aria-pressed", wf === b.dataset.f ? "true" : "false"); });
    stage.dataset.wf = wf;
    H.b.cur = null;
  }
  function setFilter(f) {
    wf = f;
    if (pinned != null && !passes(ITEM[pairIds(pinned).b].it)) unpin();   /* вино выбранной пары скрыто: пара снимается */
    applyFilter();
    syncJump("b");
    redraw();
  }
  function showPair(i) {                                 /* перед тем как вести к вину, убедиться, что оно не скрыто отбором */
    if (!passes(ITEM[pairIds(i).b].it)) { wf = "all"; applyFilter(); }
  }

  /* ---------- режим «Пары» ---------- */
  function renderPairs() {
    $("pairs-close").textContent = C.t(U.backToMenu);
    $("pairs-h").setAttribute("aria-label", C.t(U.pairs));
    $("pairs-l").textContent = C.t(U.pairsL);
    $("pairs-r").textContent = C.t(U.pairsR);
    $("pairs-lead-k").textContent = C.fill(C.t(U.pairsCount), { n: D.pairs.length });
    $("pairs-lead-b").textContent = C.t(U.pairsLead);
    var list = $("pairs-list");
    list.textContent = "";
    D.pairs.forEach(function (p, i) {
      var dish = ITEM[p.dish].it, drink = ITEM[p.drink].it, li = el("li", "pair");
      var a = el("button", "pk");
      a.type = "button"; a.dataset.pair = i; a.dataset.side = "k";
      a.appendChild(el("span", "nm", nameOf(dish)));
      if (descOf(dish)) a.appendChild(el("span", "ds", descOf(dish)));
      a.appendChild(el("span", "pr", C.price(dish.price)));
      var b = el("button", "pb");
      b.type = "button"; b.dataset.pair = i; b.dataset.side = "b";
      b.appendChild(el("span", "nm", wineName(drink)));
      b.appendChild(el("span", "ds", C.t(p.why)));
      b.appendChild(el("span", "pr", C.fill(C.t(U.byGlass), { p: C.price(drink.glass) })));
      li.appendChild(a);
      li.appendChild(b);
      var sum = el("span", "sum", C.price(pairSum(i)));
      sum.setAttribute("aria-label", C.fill(C.t(U.together), { p: C.price(pairSum(i)) }));
      li.appendChild(sum);
      list.appendChild(li);
    });
  }
  function openPairs() {
    var box = $("cutlukler");
    if (!box.hidden) return;
    pairsFocus = document.activeElement;
    box.hidden = false;
    box.scrollTop = 0;
    stage.inert = true;
    drawThread();
    renderPairBar();
    $("pairs-close").focus();
  }
  function closePairs(restore) {
    var box = $("cutlukler");
    if (box.hidden) return;
    box.hidden = true;
    stage.inert = false;
    if (restore !== false && pairsFocus && pairsFocus.focus) pairsFocus.focus();
    drawThread();
    renderPairBar();
  }

  /* ---------- телефон: лента из двух половин ---------- */
  function maxLeft() { return Math.max(0, strip.scrollWidth - strip.clientWidth); }
  function coverLeft() { return H.k.panel.offsetWidth - strip.clientWidth / 2; }
  function setP(p) { stage.style.setProperty("--p", String(Math.round(clamp(p, 0, 1) * 1000) / 1000)); }
  function setView(v) {
    view = v;
    stage.dataset.view = v === "cover" ? "cover" : v === "k" ? "kitchen" : "bar";
    var phone = !isWide();
    H.k.scroll.inert = phone && v === "b";            /* скрытая половина не ловит фокус */
    H.b.scroll.inert = phone && v === "k";
    H.k.spine.hidden = !(phone && v === "b");
    H.b.spine.hidden = !(phone && v === "k");
  }
  function place() {                                    /* поставить ленту по состоянию, без движения */
    if (isWide()) { strip.scrollLeft = 0; setP(.5); return; }
    strip.scrollLeft = view === "cover" ? coverLeft() : view === "k" ? 0 : maxLeft();
    setP(view === "cover" ? .5 : view === "k" ? 0 : 1);
    placeBead();
  }
  function slideTo(v, done) {
    if (isWide()) { setView(v); if (done) done(); return; }
    var from = strip.scrollLeft;
    strip.classList.add("sliding");
    H.k.spine.hidden = false;
    H.b.spine.hidden = false;
    setView(v);
    H.k.spine.hidden = false;                           /* во время движения видны обе полосы, они проявляются плавно */
    H.b.spine.hidden = false;
    var to = v === "k" ? 0 : maxLeft();
    function finish() {
      strip.scrollLeft = to;
      setP(v === "k" ? 0 : 1);
      strip.classList.remove("sliding");
      setView(v);
      renderPairBar();
      syncJump(v);
      if (done) done();
    }
    if (C.reducedMotion || Math.abs(to - from) < 2) { finish(); return; }
    var t0 = null, dur = 340;
    requestAnimationFrame(function step(ts) {
      if (t0 == null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      strip.scrollLeft = from + (to - from) * ease;
      setP(maxLeft() ? strip.scrollLeft / maxLeft() : 0);
      if (k < 1) requestAnimationFrame(step); else finish();
    });
  }
  var settle = null;
  strip.addEventListener("scroll", function () {         /* половину сдвинули пальцем */
    if (isWide() || view === "cover" || strip.classList.contains("sliding")) return;
    var m = maxLeft();
    setP(m ? strip.scrollLeft / m : 0);
    H.k.spine.hidden = false;
    H.b.spine.hidden = false;
    clearTimeout(settle);
    settle = setTimeout(function () {
      var mm = maxLeft(), v = mm && strip.scrollLeft / mm > .5 ? "b" : "k";
      var changed = v !== view;
      setView(v);
      if (changed) {
        renderPairBar();
        syncJump(v);
        if (pinned != null) { scrollToItem(pairIds(pinned)[v], true); flash(pairIds(pinned)[v]); }
      }
    }, 110);
  }, { passive: true });

  /* ---------- прокрутка внутри половины ---------- */
  function topH() { return H.k.scroll.querySelector(".top").offsetHeight; }
  function offsetIn(side, node) {                        /* расстояние от начала прокрутки до элемента */
    var s = H[side].scroll;
    return node.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
  }
  function scrollToItem(id, smooth) {
    var side = ITEM[id].side, s = H[side].scroll, n = $("i-" + id);
    s.scrollTo({ top: Math.max(0, offsetIn(side, n) - s.clientHeight * .34), behavior: smooth && !C.reducedMotion ? "smooth" : "auto" });
  }
  function scrollToMenu(side) {
    var s = H[side].scroll;
    s.scrollTop = Math.max(0, offsetIn(side, H[side].jump) - topH());
  }

  /* ---------- пары ---------- */
  function unpin() {
    pinned = null;
    markLit();
    renderPairBar();
    drawThread();
  }
  /* Компьютер: вторая колонка прокручивается так, чтобы пара встала на одну линию */
  function alignPair(i, fromSide) {
    var ids = pairIds(i), smooth = C.reducedMotion ? "auto" : "smooth";
    if (!fromSide) {
      var sk = H.k.scroll;
      sk.scrollTo({ top: Math.max(0, offsetIn("k", $("i-" + ids.k)) - sk.clientHeight * .42), behavior: "auto" });
      fromSide = "k";
    }
    var to = other(fromSide), sTo = H[to].scroll;
    var yFrom = $("i-" + ids[fromSide]).getBoundingClientRect().bottom;
    var yTo = $("i-" + ids[to]).getBoundingClientRect().bottom;
    var need = yTo - yFrom;
    var can = clamp(sTo.scrollTop + need, 0, sTo.scrollHeight - sTo.clientHeight) - sTo.scrollTop;
    sTo.scrollBy({ top: can, behavior: smooth });
    /* вторая колонка упёрлась в начало или конец: остаток пути проходит первая */
    if (Math.abs(need - can) > 1) H[fromSide].scroll.scrollBy({ top: can - need, behavior: smooth });
  }
  function pin(i, fromSide) {
    if (pinned === i && fromSide) { unpin(); return; }
    showPair(i);
    pinned = i;
    markLit();
    if (isWide()) alignPair(i, fromSide);
    renderPairBar();
    drawThread();
  }

  /* Телефон: планка пары внизу, в цветах другой половины */
  function renderPairBar() {
    var bar = $("pairbar");
    if (isWide() || pinned == null || view === "cover" || !$("cutlukler").hidden) {
      bar.hidden = true;
      stage.classList.remove("has-pairbar");
      return;
    }
    var show = other(view), p = D.pairs[pinned], it = ITEM[pairIds(pinned)[show]].it;
    bar.dataset.side = show;
    $("pb-l").textContent = C.t(U.goesWith);
    var n = $("pb-n");
    n.textContent = (show === "k" ? nameOf(it) : wineName(it)) + " ";
    n.appendChild(el("b", null, show === "k" ? C.price(it.price) : C.fill(C.t(U.byGlass), { p: C.price(it.glass) })));
    $("pb-w").textContent = C.t(p.why) + " " + C.fill(C.t(U.together), { p: C.price(pairSum(pinned)) });
    $("pb-go").textContent = C.t(show === "b" ? U.bEnter : U.kEnter);
    $("pb-x").setAttribute("aria-label", C.t(U.close));
    bar.hidden = false;
    stage.classList.add("has-pairbar");
  }
  function goPartner() {
    if (pinned == null) return;
    var side = other(view), id = pairIds(pinned)[side];
    slideTo(side, function () {
      scrollToItem(id, false);
      flash(id);
      $("i-" + id).focus({ preventScroll: true });
    });
  }

  /* Компьютер: нить идёт под строкой блюда, через шов и под строкой вина */
  function drawThread() {
    var svg = $("thread"), path = $("thread-p"), ca = $("thread-a"), cb = $("thread-b"), why = $("why");
    var i = hover != null ? hover : pinned;
    if (!isWide() || i == null || !$("cutlukler").hidden) {
      path.setAttribute("d", "");
      ca.style.display = cb.style.display = "none";
      svg.removeAttribute("data-pair");
      svg.classList.remove("draw");
      why.hidden = true;
      $("say").textContent = "";
      drawn = null;
      return;
    }
    var ids = pairIds(i), ra = $("i-" + ids.k).getBoundingClientRect(), rb = $("i-" + ids.b).getBoundingClientRect();
    var seam = H.b.panel.getBoundingClientRect().left + 1;
    var st = stage.getBoundingClientRect().top;
    var topA = st + stickH("k") + 8, topB = st + stickH("b") + 8, bot = window.innerHeight - 8;
    var ya = clamp(ra.bottom, topA, bot), yb = clamp(rb.bottom, topB, bot);
    var seenA = ra.bottom >= topA && ra.bottom <= bot, seenB = rb.bottom >= topB && rb.bottom <= bot;
    var r = clamp(Math.abs(yb - ya) * .4, 34, 120);
    var xa = seenA ? ra.left + 8 : seam - r, xb = seenB ? rb.right - 8 : seam + r;
    function f(v) { return Math.round(v * 10) / 10; }
    var d = "M" + f(xa) + " " + f(ya);
    if (seenA) d += "H" + f(seam - r);
    d += "C" + f(seam + r * .35) + " " + f(ya) + " " + f(seam - r * .35) + " " + f(yb) + " " + f(seam + r) + " " + f(yb);
    if (seenB) d += "H" + f(xb);
    path.setAttribute("d", d);
    ca.style.display = cb.style.display = "";
    ca.setAttribute("cx", f(xa)); ca.setAttribute("cy", f(ya)); ca.style.opacity = seenA ? "1" : ".45";
    cb.setAttribute("cx", f(xb)); cb.setAttribute("cy", f(yb)); cb.style.opacity = seenB ? "1" : ".45";
    svg.dataset.pair = String(i);                        /* для проверок: где сейчас концы нити */
    svg.dataset.ya = String(f(ya));
    svg.dataset.yb = String(f(yb));
    if (drawn !== i) {                                   /* нить рисуется заново только для новой пары */
      drawn = i;
      svg.classList.remove("draw");
      void path.getBoundingClientRect();
      svg.classList.add("draw");
      why.textContent = C.price(pairSum(i));               /* бусина на шве: цена пары */
      $("say").textContent = C.t(D.pairs[i].why) + " " + C.fill(C.t(U.together), { p: C.price(pairSum(i)) });
    }
    why.style.top = f(clamp((ya + yb) / 2, Math.max(topA, topB) + 14, bot - 14)) + "px";
    why.hidden = false;
  }
  var raf = 0;
  function redraw() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; drawThread(); syncJump("k"); syncJump("b"); });
  }

  /* ---------- всё вместе ---------- */
  function renderAll() {
    renderText();
    renderMenu("k");
    renderMenu("b");
    renderJump("k");
    renderJump("b");
    renderFilter();
    applyFilter();
    renderClock();
    renderTonight();
    renderPairs();
    renderPairBar();
    drawn = null;
    redraw();
  }

  /* Адрес страницы: #metbex и #menu открывают кухню, #serab вино, #cutlukler пары */
  function fromHash() {
    var h = (window.location.hash || "").slice(1);
    if (h === "cutlukler") { openPairs(); return; }
    var side = (h === "serab" || h === "bar") ? "b" : (h === "metbex" || h === "menu") ? "k" : null;
    if (!side) return;
    closePairs(false);
    if (!isWide()) { setView(side); place(); }
    if (h === "menu" || h === "serab" || isWide()) scrollToMenu(side);
    syncJump(side);
  }

  /* ---------- действия ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    var lang = t.closest("button[data-lang]");
    if (lang) { C.setLang(lang.dataset.lang); return; }
    if (t.closest("[data-pairs]")) { openPairs(); return; }
    var jump = t.closest("button[data-jump]");
    if (jump) { jumpTo(jump.dataset.side, jump.dataset.jump); return; }
    var f = t.closest("button[data-f]");
    if (f) { setFilter(f.dataset.f); return; }
    var item = t.closest(".item.has-pair");
    if (item) {
      hover = null;                                        /* на сенсорном экране «наведение» не уходит само */
      pin(PAIR[item.dataset.id], ITEM[item.dataset.id].side);
      return;
    }
    var row = t.closest("button[data-pair]");            /* строка в режиме «Пары» или пара вечера на первом экране */
    if (row) {
      var i = +row.dataset.pair, side = row.dataset.side, id = pairIds(i)[side];
      closePairs(false);
      showPair(i);
      pinned = i;
      markLit();
      if (isWide()) {
        alignPair(i, null);
        drawThread();
        $("i-" + id).focus({ preventScroll: true });
      } else {
        slideTo(side, function () { scrollToItem(id, false); flash(id); $("i-" + id).focus({ preventScroll: true }); });
      }
      return;
    }
  });
  $("k-enter").addEventListener("click", function () { slideTo("k", function () { H.k.label.focus({ preventScroll: true }); }); });
  $("b-enter").addEventListener("click", function () { slideTo("b", function () { H.b.label.focus({ preventScroll: true }); }); });
  H.k.spine.addEventListener("click", function () { slideTo("k", function () { H.k.label.focus({ preventScroll: true }); }); });
  H.b.spine.addEventListener("click", function () { slideTo("b", function () { H.b.label.focus({ preventScroll: true }); }); });
  $("b-find").addEventListener("click", function () {
    slideTo("b", function () {
      var foot = $("b-foot"), s = H.b.scroll;
      s.scrollTo({ top: Math.max(0, offsetIn("b", foot) - stickH("b") - 12), behavior: C.reducedMotion ? "auto" : "smooth" });
      foot.focus({ preventScroll: true });
    });
  });
  $("pairs-close").addEventListener("click", function () { closePairs(); });
  $("pb-go").addEventListener("click", goPartner);
  $("pb-x").addEventListener("click", function () {
    var id = pinned != null ? pairIds(pinned)[view] : null;
    unpin();
    if (id && $("i-" + id)) $("i-" + id).focus({ preventScroll: true });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("cutlukler").hidden) closePairs(); else if (pinned != null) unpin();
  });

  /* наведение и фокус на компьютере: нить показывается, не дожидаясь нажатия */
  function over(e) {
    var item = e.target.closest ? e.target.closest(".item.has-pair") : null;
    var i = item ? PAIR[item.dataset.id] : null;
    if (i === hover) return;
    hover = i;
    redraw();
  }
  stage.addEventListener("mouseover", over);
  stage.addEventListener("focusin", over);
  stage.addEventListener("mouseleave", function () { if (hover != null) { hover = null; redraw(); } });
  stage.addEventListener("focusout", function () { if (hover != null) { hover = null; redraw(); } });

  H.k.scroll.addEventListener("scroll", redraw, { passive: true });
  H.b.scroll.addEventListener("scroll", redraw, { passive: true });
  function relayout() { measure(); setView(view); place(); renderPairBar(); redraw(); }
  window.addEventListener("resize", relayout);
  if (wide.addEventListener) wide.addEventListener("change", relayout);
  window.addEventListener("hashchange", fromHash);
  C.onLang(function () { renderAll(); markLit(); place(); });

  H.k.label.tabIndex = -1;
  H.b.label.tabIndex = -1;
  renderAll();
  setView("cover");
  place();
  fromHash();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); place(); redraw(); });
  window.addEventListener("load", function () { place(); redraw(); });
  setInterval(renderClock, 30000);
})();
