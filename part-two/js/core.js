// Shared helpers: navigation, scrollytelling, theming, chart scaffolding, math.
(function () {
  const App = (window.App = { widgets: {} });

  // ---------- Math ----------
  App.rng = function (seed) {
    // mulberry32: deterministic so every run of the talk shows the same "random" data
    let a = seed >>> 0;
    const next = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = () => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return next;
  };
  App.mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  App.sd = (a) => { const m = App.mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  App.ols = (xs, ys) => {
    const mx = App.mean(xs), my = App.mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    const resid = ys.map((y, i) => y - a - b * xs[i]);
    return { a, b, corr: sxy / Math.sqrt(sxx * syy), residSd: App.sd(resid) };
  };

  // ---------- Formatting ----------
  // Signs use a true minus, and values that round to zero never show as "−0"
  const sign = (x, d) => (+Math.abs(x).toFixed(d) === 0 ? 0 : Math.sign(x));
  App.pct = (x, d = 1) => (sign(x, d) < 0 ? "−" : "") + Math.abs(x).toFixed(d) + "%";
  App.spct = (x, d = 1) => (sign(x, d) > 0 ? "+" : sign(x, d) < 0 ? "−" : "") + Math.abs(x).toFixed(d) + "%";
  App.num = (x, d = 2) => (sign(x, d) < 0 ? "−" : "") + Math.abs(x).toFixed(d);
  App.usd = (x, d = 0, unit = "") => (sign(x, d) < 0 ? "−" : "") + "$" + Math.abs(x).toFixed(d) + unit;

  // ---------- Tweening a numeric state field ----------
  App.tween = function (state, targets, render, ms = 700) {
    const start = {}; for (const k in targets) start[k] = state[k];
    if (state._timer) state._timer.stop();
    const ease = d3.easeCubicInOut;
    state._timer = d3.timer((el) => {
      const t = Math.min(1, el / ms), e = ease(t);
      for (const k in targets) state[k] = start[k] + (targets[k] - start[k]) * e;
      render();
      if (t >= 1) state._timer.stop();
    });
  };

  // ---------- Chart scaffold ----------
  // Returns a function that (re)builds an SVG sized to its container each call.
  App.frame = function (el, margin = { t: 16, r: 20, b: 44, l: 52 }) {
    const svg = d3.select(el).append("svg");
    return function () {
      const W = el.clientWidth, H = el.clientHeight;
      svg.attr("viewBox", `0 0 ${W} ${H}`);
      svg.selectAll("*").remove();
      const g = svg.append("g").attr("transform", `translate(${margin.l},${margin.t})`);
      return { svg, g, w: Math.max(50, W - margin.l - margin.r), h: Math.max(50, H - margin.t - margin.b), W, H };
    };
  };
  App.axes = function (g, x, y, w, h, opts = {}) {
    // Fewer x ticks on narrow (phone) charts so labels don't collide
    if (w < 420) opts = { ...opts, xt: Math.min(opts.xt || 6, 4) };
    const xa = d3.axisBottom(x).ticks(opts.xt || 6).tickSizeOuter(0);
    const ya = d3.axisLeft(y).ticks(opts.yt || 6).tickSizeOuter(0);
    if (opts.xf) xa.tickFormat(opts.xf);
    if (opts.yf) ya.tickFormat(opts.yf);
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(opts.yt || 6).tickSize(-w).tickFormat(""));
    if (opts.xgrid) g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(opts.xt || 6).tickSize(-h).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(xa);
    g.append("g").attr("class", "axis").call(ya);
    if (opts.xl) g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 36).attr("text-anchor", "end").text(opts.xl);
    if (opts.yl) g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -6).attr("text-anchor", "start").text(opts.yl);
  };

  // ---------- Tooltip ----------
  const tip = document.createElement("div"); tip.id = "tip"; document.body.appendChild(tip);
  App.tip = {
    show(html, ev) { tip.innerHTML = html; tip.style.opacity = 1; App.tip.move(ev); },
    move(ev) { tip.style.left = Math.min(ev.clientX + 14, innerWidth - 250) + "px"; tip.style.top = ev.clientY + 14 + "px"; },
    hide() { tip.style.opacity = 0; },
  };
  App.hover = (sel, html) => sel.style("cursor", "default")
    .on("pointerenter", (ev, d) => App.tip.show(html(d), ev))
    .on("pointermove", (ev) => App.tip.move(ev))
    .on("pointerleave", App.tip.hide);

  // ---------- Controls ----------
  // slider(container, {key, label, min, max, step, fmt}, state, onChange)
  App.slider = function (parent, o, state, onChange) {
    const wrap = document.createElement("div"); wrap.className = "ctl";
    wrap.innerHTML = `<label><span>${o.label}</span><b></b></label><input type="range" min="${o.min}" max="${o.max}" step="${o.step}">`;
    const input = wrap.querySelector("input"), out = wrap.querySelector("b");
    const sync = () => { input.value = state[o.key]; out.textContent = o.fmt(state[o.key]); };
    input.addEventListener("input", () => { if (state._timer) state._timer.stop(); state[o.key] = +input.value; out.textContent = o.fmt(state[o.key]); onChange(); });
    input.addEventListener("pointerup", () => input.blur());
    parent.appendChild(wrap); sync();
    return { sync, el: wrap };
  };
  App.buttons = function (parent, label, items, onClick) {
    const row = document.createElement("div"); row.className = "btns";
    if (label) row.innerHTML = `<span class="btn-label">${label}</span>`;
    const btns = items.map((it) => {
      const b = document.createElement("button"); b.className = "btn"; b.textContent = it.label;
      b.addEventListener("click", () => { onClick(it); b.blur(); });
      row.appendChild(b); return b;
    });
    parent.appendChild(row);
    return { row, setOn(i) { btns.forEach((b, j) => b.classList.toggle("on", i === j)); } };
  };
  App.tiles = function (parent, defs) {
    const out = {};
    defs.forEach((d) => {
      const t = document.createElement("div"); t.className = "tile";
      t.innerHTML = `<div class="k">${d.label}</div><div class="v"></div><div class="d">${d.sub || ""}</div>`;
      parent.appendChild(t); out[d.key] = { v: t.querySelector(".v"), d: t.querySelector(".d"), el: t };
    });
    return out;
  };

  // ---------- Widget registry + resize ----------
  App.register = function (id, w) {
    App.widgets[id] = w;
    const el = document.getElementById(id);
    if (el && w.render) new ResizeObserver(() => w.render()).observe(el.querySelector(".chart") || el);
  };

  // ---------- Boot: scrollytelling, nav, theme ----------
  App.boot = function () {
    // Step activation
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const step = e.target, scrolly = step.closest(".scrolly");
        scrolly.querySelectorAll(".step").forEach((s) => s.classList.toggle("is-active", s === step));
        const fig = scrolly.querySelector(".figure"), w = App.widgets[fig.id];
        if (w && w.step) w.step(+step.dataset.step);
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll(".step").forEach((s) => io.observe(s));

    // Progress bar + chapter dots
    const prog = document.getElementById("progress");
    const chapters = [...document.querySelectorAll("[data-chapter]")];
    const dots = document.getElementById("dots");
    chapters.forEach((c) => {
      const a = document.createElement("a"); a.href = "#" + c.id;
      a.innerHTML = `<span>${c.dataset.chapter}</span>`; dots.appendChild(a);
    });
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      prog.style.width = (100 * scrollY / max) + "%";
      let cur = 0; chapters.forEach((c, i) => { if (c.getBoundingClientRect().top < innerHeight * 0.5) cur = i; });
      [...dots.children].forEach((d, i) => d.classList.toggle("on", i === cur));
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();

    // Keyboard / clicker navigation between "stops"
    const stops = () => [...document.querySelectorAll(".stop")];
    const go = (dir) => {
      const list = stops(), mid = innerHeight * 0.5;
      // index of the stop whose center is closest to the viewport center
      let best = 0, bd = Infinity;
      list.forEach((s, i) => { const r = s.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - mid); if (d < bd) { bd = d; best = i; } });
      const target = list[Math.max(0, Math.min(list.length - 1, best + dir))];
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    addEventListener("keydown", (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "p" || e.key === "P") toggleBig();
      else if (e.key === "d" || e.key === "D") toggleTheme();
    });

    // Theme + projector mode, remembered per browser
    const root = document.documentElement;
    const store = { get(k) { try { return localStorage.getItem("p2-" + k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem("p2-" + k, v); } catch (_) {} } };
    if (store.get("theme")) root.dataset.theme = store.get("theme");
    if (store.get("big") === "1") root.classList.add("big");
    const rerender = () => setTimeout(() => Object.values(App.widgets).forEach((w) => w.render && w.render()), 30);
    function toggleTheme() {
      // Dark is the default look; light is opt-in
      const dark = root.dataset.theme !== "light";
      root.dataset.theme = dark ? "light" : "dark"; store.set("theme", root.dataset.theme); rerender();
    }
    function toggleBig() { root.classList.toggle("big"); store.set("big", root.classList.contains("big") ? "1" : "0"); rerender(); }
    document.getElementById("btn-theme").onclick = toggleTheme;
    document.getElementById("btn-big").onclick = toggleBig;

    // QR code pointing at this page (for following along on phones)
    const q = document.getElementById("qrcode");
    if (q && window.qrcode && location.protocol.startsWith("http")) {
      const qr = qrcode(0, "M"); qr.addData(location.href.split("#")[0]); qr.make();
      q.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
    } else if (q) q.closest(".qr").style.display = "none";
  };
})();
