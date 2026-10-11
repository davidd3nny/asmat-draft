/*
  core.js — общие невидимые помощники для всех сайтов.
  Здесь нет ни вёрстки, ни стилей: только язык, время в Баку, цены и поиск.
  Каждый сайт рисует себя сам, своим кодом.

  Быстрый просмотр состояний через адрес страницы:
    ?lang=ru        язык: az, ru, en
    ?at=20:30       показать сайт так, будто в Баку сейчас 20:30
    ?day=5          будто сегодня пятница (0 воскресенье … 6 суббота)
*/
window.Core = (function () {
  "use strict";

  var LANGS = ["az", "ru", "en"];
  var listeners = [];

  /* ---------- Память браузера (может быть недоступна) ---------- */
  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) { window.localStorage.removeItem(key); return null; }
      window.localStorage.setItem(key, value);
      return value;
    } catch (e) { return null; }
  }

  function query() {
    try { return new URLSearchParams(window.location.search); }
    catch (e) { return { get: function () { return null; } }; }
  }

  /* ---------- Язык ---------- */
  function pickLang(fallback) {
    var nav = (navigator.language || "").slice(0, 2).toLowerCase();
    var order = [query().get("lang"), store("site-lang"), nav, fallback, "az"];
    for (var i = 0; i < order.length; i++) if (LANGS.indexOf(order[i]) > -1) return order[i];
    return "az";
  }
  var lang = pickLang();
  document.documentElement.lang = lang;

  function setLang(code) {
    if (LANGS.indexOf(code) < 0 || code === lang) return;
    lang = code;
    store("site-lang", code);
    document.documentElement.lang = code;
    listeners.forEach(function (fn) { fn(code); });
  }
  function onLang(fn) { listeners.push(fn); }

  /* t({az, ru, en}) → строка на текущем языке */
  function t(v) {
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    return v[lang] || v.en || v.az || v.ru || "";
  }
  /* fill("До {t}", {t: "23:00"}) */
  function fill(str, map) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return map[k] == null ? "" : map[k]; });
  }
  /* Заглавные буквы с учётом языка: в азербайджанском i → İ, ı → I */
  function upper(s, code) {
    code = code || lang;
    return code === "az" ? String(s).toLocaleUpperCase("az") : String(s).toUpperCase();
  }
  /* Русские числительные: plural(3, ["блюдо", "блюда", "блюд"]) */
  function plural(n, forms) {
    if (lang !== "ru" || !forms || forms.length < 3) return forms ? forms[n === 1 ? 0 : forms.length - 1] : "";
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  /* ---------- Цены ---------- */
  function money(p) {
    if (typeof p !== "number") return String(p == null ? "" : p);
    var s = Number.isInteger(p) ? String(p) : p.toFixed(2);
    return lang === "en" ? s : s.replace(".", ",");
  }
  function price(p, currency) {
    return money(p) + " " + (currency || "₼");
  }

  /* ---------- Поиск без учёта диакритики: «dusbere» находит «Düşbərə» ---------- */
  var FOLD = { "ə": "e", "ı": "i", "i̇": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "ё": "е", "é": "e" };
  function fold(s) {
    return String(s).toLowerCase().replace(/i̇|[əıöüşçğёé]/g, function (c) { return FOLD[c] || c; });
  }

  /* ---------- Время в городе заведения ---------- */
  function toMin(hhmm) { var a = String(hhmm).split(":"); return (+a[0]) * 60 + (+a[1] || 0); }
  function hhmm(min) {
    min = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function now(tz) {
    var out = { min: 0, h: 0, mi: 0, y: 2026, m: 1, d: 1, dow: 0 };
    try {
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz || "Asia/Baku", hour12: false,
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short"
      }).formatToParts(new Date());
      var wd = "Sun";
      parts.forEach(function (p) {
        if (p.type === "hour") out.h = +p.value % 24;
        if (p.type === "minute") out.mi = +p.value;
        if (p.type === "year") out.y = +p.value;
        if (p.type === "month") out.m = +p.value;
        if (p.type === "day") out.d = +p.value;
        if (p.type === "weekday") wd = p.value;
      });
      out.dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    } catch (e) {
      var dt = new Date();
      out = { h: dt.getHours(), mi: dt.getMinutes(), y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), dow: dt.getDay(), min: 0 };
    }
    /* предпросмотр: ?at=20:30 и ?day=5 */
    var at = query().get("at"), day = query().get("day");
    if (at && /^\d{1,2}:\d{2}$/.test(at)) { var mm = toMin(at); out.h = Math.floor(mm / 60) % 24; out.mi = mm % 60; }
    if (day != null && /^[0-6]$/.test(day)) {
      var shift = (+day - out.dow + 7) % 7;
      var moved = new Date(Date.UTC(out.y, out.m - 1, out.d + shift));
      out.y = moved.getUTCFullYear(); out.m = moved.getUTCMonth() + 1; out.d = moved.getUTCDate(); out.dow = +day;
    }
    out.min = out.h * 60 + out.mi;
    return out;
  }

  /* hours = {open: "09:00", close: "23:00"}; закрытие после полуночи тоже понимается */
  function isOpen(hours, n) {
    if (!hours) return null;
    var o = toMin(hours.open), c = toMin(hours.close), m = (n || now()).min;
    return o < c ? (m >= o && m < c) : (m >= o || m < c);
  }
  /* status(hours) → {open: true, until: "23:00"} или {open: false, opens: "09:00", minutesLeft: …} */
  function status(hours, n) {
    n = n || now();
    var o = toMin(hours.open), c = toMin(hours.close), open = isOpen(hours, n);
    var left = open ? ((c - n.min + 1440) % 1440) : ((o - n.min + 1440) % 1440);
    return open ? { open: true, until: hours.close, minutesLeft: left }
                : { open: false, opens: hours.open, minutesLeft: left };
  }

  /* Ближайшая дата для дня недели: upcoming(5, "21:00") → {delta: 2, date: Date(UTC), key} */
  function upcoming(dow, time, graceMin, n) {
    n = n || now();
    var delta = (dow - n.dow + 7) % 7;
    if (delta === 0 && n.min > toMin(time || "23:59") + (graceMin == null ? 150 : graceMin)) delta = 7;
    var date = new Date(Date.UTC(n.y, n.m - 1, n.d + delta));
    return { delta: delta, date: date, key: delta * 1440 + toMin(time || "00:00") };
  }
  function today(n) { n = n || now(); return new Date(Date.UTC(n.y, n.m - 1, n.d)); }

  var MONTHS = {
    az: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
    ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  };
  var DAYS = {
    az: ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"],
    ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  };
  var DAYS_SHORT = {
    az: ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."],
    ru: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
    en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  };
  /* dateLabel(date) → «6 oktyabr» / «6 октября» / «6 October» (date в UTC, как из upcoming) */
  function dateLabel(date) {
    var d = date.getUTCDate(), m = MONTHS[lang][date.getUTCMonth()];
    return lang === "en" ? d + " " + m : d + " " + m;
  }
  function dayName(dow, short) { return (short ? DAYS_SHORT : DAYS)[lang][dow]; }

  /* ---------- Ссылки ---------- */
  function tel(phone) { return "tel:" + String(phone || "").replace(/[^+\d]/g, ""); }
  function wa(phone, text) {
    return "https://wa.me/" + String(phone || "").replace(/\D/g, "") + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  /* ---------- Мелочи для DOM ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  var reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  return {
    LANGS: LANGS, MONTHS: MONTHS, DAYS: DAYS, DAYS_SHORT: DAYS_SHORT,
    get lang() { return lang; },
    setLang: setLang, onLang: onLang, pickLang: pickLang,
    t: t, fill: fill, upper: upper, plural: plural,
    money: money, price: price, fold: fold,
    now: now, today: today, toMin: toMin, hhmm: hhmm, isOpen: isOpen, status: status, upcoming: upcoming,
    dateLabel: dateLabel, dayName: dayName,
    tel: tel, wa: wa, store: store, query: query, el: el, ready: ready,
    reducedMotion: reducedMotion
  };
})();
