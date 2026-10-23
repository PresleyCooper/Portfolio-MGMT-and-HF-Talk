// One interactive per chapter. Each widget owns its state, a render(), and a step(i)
// that the scroll position calls to move the visual to that step's preset.
(function () {
  const A = window.App, DATA = window.DATA;
  const C = {
    market: "var(--market)", marketT: "var(--market-t)", concave: "var(--concave)", convex: "var(--convex)",
    neg: "var(--neg)", hl: "var(--hl)", ink: "var(--ink)", ink2: "var(--ink-2)", ink3: "var(--ink-3)",
    line: "var(--line)", surface: "var(--surface)", surface2: "var(--surface-2)", grid: "var(--grid)",
  };
  const $ = (id) => document.getElementById(id);
  const parts = (id) => {
    const el = $(id);
    return { el, chart: el.querySelector(".chart"), ro: el.querySelector(".readouts"), ctl: el.querySelector(".controls") };
  };
  const ym = d3.timeParse("%Y-%m"), ymd = d3.timeParse("%Y-%m-%d");
  const fmtMon = d3.timeFormat("%b %Y"), fmtDay = d3.timeFormat("%b %-d, %Y");
  const setTile = (t, k, v, d = "") => { t.el.querySelector(".k").textContent = k; t.v.textContent = v; t.d.textContent = d; };

  // Simple legend row drawn inside an SVG
  function legend(g, items, x = 0, y = -4) {
    let cx = x;
    items.forEach((it) => {
      const gi = g.append("g").attr("transform", `translate(${cx},${y})`);
      if (it.dash) gi.append("line").attr("x1", 0).attr("x2", 14).attr("y1", -4).attr("y2", -4).style("stroke", it.color).style("stroke-width", 2).style("stroke-dasharray", "4 3");
      else gi.append("rect").attr("width", 10).attr("height", 10).attr("y", -9).attr("rx", 2).style("fill", it.color);
      const t = gi.append("text").attr("class", "lbl-2").attr("x", it.dash ? 18 : 14).attr("y", 0).text(it.label);
      cx += (it.dash ? 18 : 14) + t.node().getComputedTextLength() + 16;
    });
  }

  // Readable ticks for log-scaled growth charts
  const logTicks = (y) => { const [a, b] = y.domain(); return [0.5, 1, 1.5, 2, 3, 5, 7, 10, 20, 30, 50].filter((v) => v >= a && v <= b); };
  // Nudge end-of-line labels apart so they never overlap (items: {y}, mutated in place)
  function spread(items, gap = 14) {
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    return items;
  }

  // ---------- Return statistics on monthly % series ----------
  const S = {
    growth: (r) => { let v = 1; return r.map((x) => (v *= 1 + x / 100)); },
    cagr: (r) => (Math.pow(r.reduce((v, x) => v * (1 + x / 100), 1), 12 / r.length) - 1) * 100,
    vol: (r) => A.sd(r) * Math.sqrt(12),
    total: (r) => (r.reduce((v, x) => v * (1 + x / 100), 1) - 1) * 100,
    maxdd: (r) => { let v = 1, pk = 1, dd = 0; r.forEach((x) => { v *= 1 + x / 100; pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); }); return dd * 100; },
    corr: (a, b) => A.ols(a, b).corr,
    // Separate betas for down and up market months
    betas: (m, y) => {
      const dn = m.map((x, i) => [x, y[i]]).filter((p) => p[0] < 0), up = m.map((x, i) => [x, y[i]]).filter((p) => p[0] >= 0);
      return { down: A.ols(dn.map((p) => p[0]), dn.map((p) => p[1])).b, up: A.ols(up.map((p) => p[0]), up.map((p) => p[1])).b };
    },
    // Least-squares quadratic y = a + b x + c x²
    quad: (xs, ys) => {
      const n = xs.length; let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      xs.forEach((x, i) => { const y = ys[i]; s1 += x; s2 += x * x; s3 += x ** 3; s4 += x ** 4; t0 += y; t1 += x * y; t2 += x * x * y; });
      const M = [[n, s1, s2], [s1, s2, s3], [s2, s3, s4]], v = [t0, t1, t2];
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(M), col = (k) => M.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)));
      return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D };
    },
  };

  const HF = DATA.hf, HD = HF.dates.map(ym);
  const NAMES = {
    ma: "Merger arbitrage", ca: "Convertible arbitrage", fia: "Fixed income arbitrage", ed: "Event driven", ds: "Distressed securities",
    rv: "Relative value", gm: "Global macro", cta: "CTA / trend following", emn: "Equity market neutral", lse: "Long/short equity", fof: "Funds of funds",
  };
  const asym = {};
  Object.keys(NAMES).forEach((k) => { const b = S.betas(HF.mkt, HF[k]); asym[k] = { ...b, d: b.down - b.up }; });
  const shapeColor = (k) => (asym[k].d > 0 ? C.concave : C.convex);

  /* =========================================================
     HERO background: faint concave and convex payoff curves
     ========================================================= */
  (function () {
    const el = $("hero-bg"); if (!el) return;
    const svg = d3.select(el).append("svg").attr("viewBox", "0 0 1000 600").attr("preserveAspectRatio", "xMidYMid slice");
    const x = d3.scaleLinear().domain([-1, 1]).range([80, 920]);
    const curve = (f) => d3.line().curve(d3.curveBasis)(d3.range(-1, 1.001, 0.02).map((t) => [x(t), f(t)]));
    svg.append("path").attr("d", curve((t) => 300 - 150 * t + 170 * t * t)).style("fill", "none").style("stroke", C.convex).style("stroke-width", 2).style("opacity", 0.35);
    svg.append("path").attr("d", curve((t) => 330 - 90 * t - 160 * t * t + (t < 0 ? 0 : 0))).style("fill", "none").style("stroke", C.concave).style("stroke-width", 2).style("opacity", 0.35);
    const rnd = A.rng(7);
    d3.range(140).forEach(() => {
      const t = rnd() * 2 - 1, kind = rnd() < 0.5;
      const yv = kind ? 300 - 150 * t + 170 * t * t : 330 - 90 * t - 160 * t * t;
      svg.append("circle").attr("cx", x(t)).attr("cy", yv + rnd.normal() * 26).attr("r", 2.4).style("fill", kind ? C.convex : C.concave).style("opacity", 0.22);
    });
  })();

  /* =========================================================
     1. COLD OPEN: convertible arbitrage, steady until 2008
     ========================================================= */
  (function () {
    const p = parts("w-open");
    const st = { stage: 0, reveal: 1 };
    const iEnd07 = HF.dates.indexOf("2007-12"), iEnd09 = HF.dates.indexOf("2009-12"), N = HF.dates.length;
    const frame = A.frame(p.chart, { t: 26, r: 120, b: 30, l: 46 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const crises = [["1998-08", "1998-10"], ["2008-09", "2009-02"], ["2020-02", "2020-03"]];

    function render() {
      const { g, w, h } = frame();
      const end = st.stage <= 1 ? iEnd07 : st.stage === 2 ? iEnd09 : N - 1;
      const shown = Math.max(1, Math.round(end * st.reveal));
      const series = [{ k: "ca", color: C.concave, name: st.stage >= 2 ? "Convertible arbitrage" : "Strategy" }];
      if (st.stage >= 1) series.push({ k: "mkt", color: C.market, name: "US stocks", w: 2 });
      if (st.stage >= 3) series.push({ k: "fia", color: C.concave, name: "Fixed income arb.", dash: "5 3" }, { k: "ma", color: C.concave, name: "Merger arb.", dash: "1 3" });
      series.forEach((s) => (s.g = S.growth(HF[s.k].slice(0, end + 1))));
      const x = d3.scaleTime().domain([HD[0], HD[end]]).range([0, w]);
      const ymax = d3.max(series, (s) => d3.max(s.g)) * 1.05;
      const y = (st.stage >= 3 ? d3.scaleLog().domain([0.9, ymax]) : d3.scaleLinear().domain([0.8, ymax])).range([h, 0]);
      if (st.stage >= 2) crises.forEach(([a, b]) => {
        const ia = HF.dates.indexOf(a), ib = HF.dates.indexOf(b); if (ia > end) return;
        g.append("rect").attr("x", x(HD[ia])).attr("width", Math.max(3, x(HD[Math.min(ib, end)]) - x(HD[ia]))).attr("y", 0).attr("height", h).style("fill", C.neg).style("opacity", 0.22);
      });
      A.axes(g, x, y, w, h, { yt: 5, yf: (v) => "$" + d3.format(".1f")(v), xt: 6 });
      if (st.stage >= 3) g.selectAll(".axis").filter((d, i) => i === 1).call(d3.axisLeft(y).tickValues(logTicks(y)).tickFormat((v) => "$" + v));
      const labels = [];
      series.forEach((s) => {
        const pts = s.g.slice(0, shown + 1);
        g.append("path").datum(pts).attr("d", d3.line().x((d, i) => x(HD[i])).y((d) => y(d))).style("fill", "none").style("stroke", s.color).style("stroke-width", s.w || 2.5).style("stroke-dasharray", s.dash || null);
        const last = pts.length - 1;
        labels.push({ x: x(HD[last]) + 6, y: y(pts[last]) + 4, s });
      });
      spread(labels).forEach((l) => g.append("text").attr("class", "lbl halo").attr("x", l.x).attr("y", l.y).style("fill", l.s.color).text(l.s.name));
      // Hover: monthly return of each series
      const ov = g.append("rect").attr("width", w).attr("height", h).style("fill", "transparent");
      ov.on("pointermove", (ev) => {
        const i = Math.max(0, Math.min(shown, d3.bisectCenter(HD, x.invert(d3.pointer(ev)[0]))));
        A.tip.show(`<b>${fmtMon(HD[i])}</b><br>` + series.map((s) => `${s.name}: ${A.spct(HF[s.k][i])}`).join("<br>"), ev);
      }).on("pointerleave", A.tip.hide);

      const r = HF.ca.slice(0, end + 1);
      setTile(tl.a, "Months with a gain", Math.round(100 * r.filter((v) => v > 0).length / r.length) + "%", st.stage >= 2 ? "Convertible arbitrage" : "Strategy");
      setTile(tl.b, "Return per year", A.pct(S.cagr(r)), "");
      setTile(tl.c, "Volatility", A.pct(S.vol(r)), st.stage >= 1 ? "US stocks: " + A.pct(S.vol(HF.mkt.slice(0, end + 1))) : "");
      setTile(tl.d, st.stage >= 2 ? "Peak-to-trough loss" : "Worst month", st.stage >= 2 ? A.pct(S.maxdd(r)) : A.pct(d3.min(r)), st.stage >= 2 ? "Worst month " + A.pct(d3.min(r)) : "");
      tl.d.el.classList.toggle("hl", st.stage === 2);
      $("open-title").textContent = st.stage >= 3 ? "Growth of $1, monthly, 1997–2021 (log scale)" : `Growth of $1, monthly, 1997–${st.stage <= 1 ? 2007 : 2009}`;
    }
    A.register("w-open", {
      render,
      step(i) { const prev = st.stage; st.stage = i; if (i === 0 && prev !== 0) { st.reveal = 0; A.tween(st, { reveal: 1 }, render, 1200); } else { st.reveal = 1; render(); } },
    });
  })();

  /* =========================================================
     2. PAYOFF SHAPE: scatter vs market, or the asymmetry bars
     ========================================================= */
  (function () {
    const p = parts("w-shape");
    const st = { k: "ma", bars: false };
    const frame = A.frame(p.chart, { t: 22, r: 16, b: 50, l: 52 });
    const tl = A.tiles(p.ro, [{ key: "c", label: "Correlation" }, { key: "d", label: "Down-market beta" }, { key: "u", label: "Up-market beta" }, { key: "w", label: "Worst month" }]);
    const keys = ["ma", "ca", "fia", "ds", "gm", "cta", "emn"];
    const btn = A.buttons(p.ctl, "Strategy", [...keys.map((k) => ({ label: NAMES[k].replace(" / trend following", "").replace(" securities", ""), k })), { label: "All: asymmetry", k: "bars" }], (it) => {
      if (it.k === "bars") st.bars = true; else { st.bars = false; st.k = it.k; }
      sync(); render();
    });
    const sync = () => btn.setOn(st.bars ? keys.length : keys.indexOf(st.k));

    function render() {
      const { g, w, h } = frame();
      if (st.bars) return renderBars(g, w, h);
      const xs = HF.mkt, ys = HF[st.k], col = shapeColor(st.k);
      const x = d3.scaleLinear().domain([-18, 13]).range([0, w]), y = d3.scaleLinear().domain([-13.5, 10]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "US stock market, monthly return", yl: NAMES[st.k] + ", monthly return", xf: (v) => v + "%", yf: (v) => v + "%", xgrid: true });
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      g.append("rect").attr("x", 0).attr("width", x(0)).attr("height", h).style("fill", C.neg).style("opacity", 0.05);
      g.append("text").attr("class", "lbl-2").attr("x", 6).attr("y", 14).text("Market down");
      g.append("text").attr("class", "lbl-2").attr("x", w - 6).attr("y", 14).attr("text-anchor", "end").text("Market up");
      const pts = xs.map((m, i) => ({ m, v: ys[i], d: HD[i] }));
      A.hover(g.selectAll(".dot").data(pts).join("circle").attr("cx", (d) => x(d.m)).attr("cy", (d) => y(d.v)).attr("r", 3.2)
        .style("fill", col).style("opacity", 0.55), (d) => `<b>${fmtMon(d.d)}</b><br>Market: ${A.spct(d.m)}<br>${NAMES[st.k]}: ${A.spct(d.v)}`);
      const q = S.quad(xs, ys);
      g.append("path").attr("d", d3.line()(d3.range(-17, 12.01, 0.25).map((m) => [x(m), y(q.a + q.b * m + q.c * m * m)]))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 2.5);
      // Down and up beta segments
      const b = asym[st.k];
      const seg = (x0, x1, beta, side) => {
        const pp = pts.filter((d) => (side ? d.m >= 0 : d.m < 0)), o = A.ols(pp.map((d) => d.m), pp.map((d) => d.v));
        g.append("line").attr("x1", x(x0)).attr("x2", x(x1)).attr("y1", y(o.a + o.b * x0)).attr("y2", y(o.a + o.b * x1)).style("stroke", col).style("stroke-width", 2).style("stroke-dasharray", "6 4");
      };
      seg(-17, 0, b.down, 0); seg(0, 12, b.up, 1);
      legend(g, [{ label: "Fitted curve", color: C.hl }, { label: "Down / up-market beta", color: col, dash: true }], 0, h + 38);
      g.append("text").attr("class", "lbl halo").attr("x", w - 4).attr("y", h - 8).attr("text-anchor", "end").style("fill", col).text(b.d > 0 ? "Concave: selling insurance" : "Convex: buying insurance");
      setTile(tl.c, "Correlation", A.num(S.corr(xs, ys)));
      setTile(tl.d, "Down-market beta", A.num(b.down));
      setTile(tl.u, "Up-market beta", A.num(b.up));
      setTile(tl.w, "Worst month", A.pct(d3.min(ys)), fmtMon(HD[ys.indexOf(d3.min(ys))]));
    }
    function renderBars(g, w, h) {
      const ks = Object.keys(NAMES).sort((a, b) => asym[b].d - asym[a].d);
      const x = d3.scaleLinear().domain([-0.3, 0.3]).range([0, w]).nice(), y = d3.scaleBand().domain(ks).range([0, h]).padding(0.25);
      g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickSize(-h).tickFormat(""));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("+.1f")));
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      A.hover(g.selectAll(".b").data(ks).join("rect").attr("x", (k) => x(Math.min(0, asym[k].d))).attr("width", (k) => Math.abs(x(asym[k].d) - x(0)))
        .attr("y", (k) => y(k)).attr("height", y.bandwidth()).attr("rx", 3).style("fill", (k) => shapeColor(k)),
        (k) => `<b>${NAMES[k]}</b><br>Down-market beta ${A.num(asym[k].down)}<br>Up-market beta ${A.num(asym[k].up)}`);
      g.selectAll(".t").data(ks).join("text").attr("class", "lbl halo").attr("x", (k) => (asym[k].d > 0 ? x(0) - 6 : x(0) + 6)).attr("text-anchor", (k) => (asym[k].d > 0 ? "end" : "start"))
        .attr("y", (k) => y(k) + y.bandwidth() / 2 + 4).text((k) => NAMES[k]);
      g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 34).attr("text-anchor", "end").text("Down-market beta minus up-market beta");
      g.append("text").attr("class", "lbl").attr("x", w).attr("y", -6).attr("text-anchor", "end").style("fill", C.concave).text("Concave →");
      g.append("text").attr("class", "lbl").attr("x", 0).attr("y", -6).style("fill", C.convex).text("← Convex");
      const conc = Object.keys(NAMES).filter((k) => asym[k].d > 0).length;
      setTile(tl.c, "Concave strategies", conc + " of " + Object.keys(NAMES).length);
      setTile(tl.d, "Most concave", NAMES[ks[0]].split(" ")[0] + " " + (NAMES[ks[0]].split(" ")[1] || ""));
      setTile(tl.u, "Most convex", "CTA");
      setTile(tl.w, "Period", "1997–2021", "monthly");
    }
    const presets = ["ma", "ca", "cta", "gm", "bars"];
    A.register("w-shape", { render, step(i) { const k = presets[i]; st.bars = k === "bars"; if (!st.bars) st.k = k; sync(); render(); } });
  })();

  /* =========================================================
     3. MERGER ARBITRAGE: real deal spreads
     ========================================================= */
  (function () {
    const p = parts("w-deal");
    const deals = DATA.deals;
    const typical = { name: "Typical cash deal (illustrative)", offer: 50, pre: 35, price: 48 };
    const defaults = { atvi: 65.39, twtr: 39.31, aci: 18 };
    const st = { k: "atvi", i: 1, fb: 65.39 };
    const frame = A.frame(p.chart, { t: 24, r: 92, b: 30, l: 46 });
    const tl = A.tiles(p.ro, [{ key: "p", label: "Target price" }, { key: "s", label: "Gross spread" }, { key: "q", label: "Implied probability" }, { key: "b", label: "If the deal breaks" }]);
    const btn = A.buttons(p.ctl, "Deal", [{ label: "Activision", k: "atvi" }, { label: "Twitter", k: "twtr" }, { label: "Albertsons", k: "aci" }, { label: "Typical deal", k: "typ" }], (it) => { setDeal(it.k); render(); });
    const ctlRow = document.createElement("div"); ctlRow.className = "controls"; ctlRow.style.width = "100%"; p.ctl.appendChild(ctlRow);
    const sMonth = A.slider(ctlRow, { key: "i", label: "Month", min: 0, max: 30, step: 1, fmt: (v) => (st.k === "typ" ? "–" : deals[st.k].px[v] ? fmtMon(ym(deals[st.k].px[v][0])) : "") }, st, render);
    const sFb = A.slider(ctlRow, { key: "fb", label: "Fallback price if the deal breaks", min: 10, max: 70, step: 0.25, fmt: (v) => "$" + v.toFixed(2) }, st, render);
    function setDeal(k, i) {
      st.k = k; btn.setOn(["atvi", "twtr", "aci", "typ"].indexOf(k));
      const inp = sMonth.el.querySelector("input");
      if (k === "typ") { st.fb = typical.pre; st.i = 0; inp.max = 0; }
      else { st.fb = defaults[k]; inp.max = deals[k].px.length - 1; st.i = i === undefined ? deals[k].px.length - 1 : i; }
      sMonth.el.style.display = k === "typ" ? "none" : "";
      sMonth.sync(); sFb.sync();
    }
    function tiles(price, offer, fb) {
      const spread = (offer / price - 1) * 100, q = (price - fb) / (offer - fb), brk = (fb / price - 1) * 100;
      setTile(tl.p, "Target price", "$" + price.toFixed(2), "Offer $" + offer.toFixed(2));
      setTile(tl.s, "Gain if it closes", A.spct(spread), "gross spread");
      setTile(tl.q, "Implied probability", q < 0 ? "below 0%" : q > 1 ? "above 100%" : Math.round(q * 100) + "%", q < 0 ? "price is below the fallback" : "of closing");
      setTile(tl.b, "If the deal breaks", A.spct(brk), "to $" + fb.toFixed(2) + (st.k === "aci" ? " (assumed)" : ""));
      tl.q.el.classList.add("hl");
    }
    function render() {
      const { g, w, h } = frame();
      if (st.k === "typ") return renderTypical(g, w, h);
      const d = deals[st.k], px = d.px.map(([m, v]) => ({ d: ym(m), v, m })), cur = px[Math.min(st.i, px.length - 1)];
      $("deal-title").textContent = d.name + ": price vs. offer";
      $("deal-src").textContent = "Month-end closes; deal terms from company announcements";
      const x = d3.scaleTime().domain([px[0].d, px[px.length - 1].d]).range([0, w]);
      const lo = Math.min(st.fb, d3.min(px, (q) => q.v)) * 0.9, hi = d.offer * 1.06;
      const y = d3.scaleLinear().domain([lo, hi]).range([h, 0]).nice();
      A.axes(g, x, y, w, h, { yf: (v) => "$" + v, xt: 6 });
      // Spread area between price and offer
      g.append("path").datum(px).attr("d", d3.area().x((q) => x(q.d)).y0(y(d.offer)).y1((q) => y(q.v))).style("fill", C.concave).style("opacity", 0.12);
      const hline = (v, col, label) => {
        g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(v)).attr("y2", y(v)).style("stroke", col).style("stroke-width", 1.8).style("stroke-dasharray", "6 4");
        g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", y(v) + 4).style("fill", col).text(label);
      };
      hline(d.offer, C.concave, "Offer $" + d.offer.toFixed(2));
      hline(st.fb, C.neg, "Fallback $" + st.fb.toFixed(2));
      g.append("path").datum(px).attr("d", d3.line().x((q) => x(q.d)).y((q) => y(q.v))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 2.5);
      // Events
      d.events.forEach(([m, label], j) => {
        const q = px.find((z) => z.m === m); if (!q) return;
        const ev = g.append("g").attr("transform", `translate(${x(q.d)},${y(q.v)})`);
        A.hover(ev.append("circle").attr("r", 6).style("fill", C.surface).style("stroke", C.ink2).style("stroke-width", 1.5), () => `<b>${fmtMon(q.d)}</b><br>${label}<br>Price $${q.v.toFixed(2)}`);
        ev.append("text").attr("class", "lbl-2").attr("y", 3.5).attr("text-anchor", "middle").style("font-size", "9px").style("pointer-events", "none").text(j + 1);
      });
      g.append("circle").attr("cx", x(cur.d)).attr("cy", y(cur.v)).attr("r", 7).style("fill", C.concave).style("stroke", C.surface).style("stroke-width", 2);
      const evNow = d.events.find((e) => e[0] === cur.m);
      g.append("text").attr("class", "lbl halo").attr("x", Math.min(w - 4, Math.max(4, x(cur.d)))).attr("y", y(cur.v) + 24).attr("text-anchor", x(cur.d) > w * 0.6 ? "end" : "start")
        .text(fmtMon(cur.d) + (evNow ? ": " + evNow[1] : ""));
      g.append("text").attr("class", "lbl-2").attr("x", 0).attr("y", -8).text(d.terms + " · " + d.outcome);
      tiles(cur.v, d.offer, st.fb);
    }
    function renderTypical(g, w, h) {
      $("deal-title").textContent = "Typical cash deal: the two outcomes";
      $("deal-src").textContent = "Illustrative";
      const price = typical.price, up = (typical.offer / price - 1) * 100, dn = (st.fb / price - 1) * 100;
      const q = (price - st.fb) / (typical.offer - st.fb);
      const rows = [{ k: "Deal closes", v: up, col: C.concave, pr: q }, { k: "Deal breaks", v: dn, col: C.neg, pr: 1 - q }];
      const x = d3.scaleLinear().domain([Math.min(-60, dn * 1.1), 20]).range([0, w]), y = d3.scaleBand().domain(rows.map((r) => r.k)).range([30, h * 0.7]).padding(0.35);
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h * 0.7})`).call(d3.axisBottom(x).ticks(6).tickFormat((v) => v + "%"));
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 20).attr("y2", h * 0.7);
      rows.forEach((r) => {
        g.append("rect").attr("x", x(Math.min(0, r.v))).attr("width", Math.abs(x(r.v) - x(0))).attr("y", y(r.k)).attr("height", y.bandwidth()).attr("rx", 4).style("fill", r.col);
        g.append("text").attr("class", "lbl halo").attr("x", r.v > 0 ? x(r.v) + 8 : x(r.v) - 8).attr("text-anchor", r.v > 0 ? "start" : "end").attr("y", y(r.k) + y.bandwidth() / 2 + 4)
          .text(`${r.k}: ${A.spct(r.v)} (${Math.round(Math.max(0, Math.min(1, r.pr)) * 100)}% implied)`);
      });
      g.append("text").attr("class", "lbl-2").attr("x", 0).attr("y", 8).text(`Target $${price}, offer $${typical.offer}, fallback $${st.fb.toFixed(2)}. Expected value at the implied odds is zero by construction.`);
      g.append("text").attr("class", "lbl-2").attr("x", 0).attr("y", h * 0.7 + 44).text("Arbitrage returns come from deals closing more often than the spread implies.");
      tiles(price, typical.offer, st.fb);
    }
    const idxOf = (k, m) => deals[k].px.findIndex((q) => q[0] === m);
    const presets = [["atvi", "2022-01"], ["atvi", "2022-01"], ["atvi", "2023-04"], ["twtr", "2022-06"], ["aci", "2024-12"], ["typ"]];
    A.register("w-deal", { render, step(i) { const [k, m] = presets[i]; setDeal(k, m ? idxOf(k, m) : 0); render(); } });
    setDeal("atvi", 1);
  })();

  /* =========================================================
     4. DISTRESSED: the capital structure waterfall
     ========================================================= */
  (function () {
    const p = parts("w-cap");
    const classes = [
      { k: "sec", name: "Senior secured loans", claim: 400 },
      { k: "uns", name: "Senior unsecured bonds", claim: 300 },
      { k: "sub", name: "Subordinated notes", claim: 150 },
    ];
    const st = { ev: 1100, buy: 30, record: false };
    const frame = A.frame(p.chart, { t: 26, r: 20, b: 36, l: 160 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Secured recovery" }, { key: "b", label: "Unsecured recovery" }, { key: "c", label: "Subordinated recovery" }, { key: "d", label: "Unsecured trade" }]);
    const sEv = A.slider(p.ctl, { key: "ev", label: "Enterprise value", min: 0, max: 1300, step: 10, fmt: (v) => "$" + v + "M" }, st, () => { st.record = false; render(); });
    const sBuy = A.slider(p.ctl, { key: "buy", label: "Purchase price of unsecured bonds", min: 5, max: 100, step: 1, fmt: (v) => v + "¢" }, st, render);
    const btn = A.buttons(p.ctl, "View", [{ label: "Waterfall" }, { label: "EDHEC distressed record" }], (it) => { st.record = it.label !== "Waterfall"; btn.setOn(st.record ? 1 : 0); render(); });
    function pay() {
      let left = st.ev; const out = {};
      classes.forEach((c) => { const paid = Math.max(0, Math.min(c.claim, left)); out[c.k] = paid; left -= paid; });
      out.eq = Math.max(0, left); return out;
    }
    function render() {
      btn.setOn(st.record ? 1 : 0);
      const { g, w, h } = frame();
      const pd = pay(), rec = (k) => pd[k] / classes.find((c) => c.k === k).claim;
      if (st.record) renderRecord(g, w, h);
      else {
        const rows = [...classes.map((c) => ({ ...c, paid: pd[c.k] })), { k: "eq", name: "Equity", claim: Math.max(250, pd.eq), paid: pd.eq }];
        $("cap-title").textContent = "Who gets paid: claims by seniority";
        const x = d3.scaleLinear().domain([0, 620]).range([0, w]), y = d3.scaleBand().domain(rows.map((r) => r.k)).range([0, h * 0.62]).padding(0.28);
        g.append("g").attr("class", "axis").attr("transform", `translate(0,${h * 0.62})`).call(d3.axisBottom(x).ticks(5).tickFormat((v) => "$" + v + "M"));
        rows.forEach((r, j) => {
          const fulcrum = r.k !== "eq" && r.paid > 0 && r.paid < r.claim;
          if (r.k !== "eq") g.append("rect").attr("x", 0).attr("y", y(r.k)).attr("width", x(r.claim)).attr("height", y.bandwidth()).attr("rx", 4).style("fill", "none").style("stroke", C.neg).style("stroke-dasharray", "4 3").style("stroke-width", 1.5);
          g.append("rect").attr("x", 0).attr("y", y(r.k)).attr("width", x(r.paid)).attr("height", y.bandwidth()).attr("rx", 4).style("fill", r.k === "eq" ? C.convex : C.concave).style("opacity", 0.9);
          g.append("text").attr("class", "lbl").attr("x", -10).attr("y", y(r.k) + y.bandwidth() / 2 + 4).attr("text-anchor", "end").text(r.name);
          const txt = r.k === "eq" ? `Worth $${Math.round(r.paid)}M` : `$${Math.round(r.paid)}M of $${r.claim}M · ${Math.round(100 * r.paid / r.claim)}¢`;
          g.append("text").attr("class", "lbl-2 halo").attr("x", Math.max(x(r.paid), r.k === "eq" ? 0 : x(r.claim)) + 8).attr("y", y(r.k) + y.bandwidth() / 2 + 4).text(txt + (fulcrum ? "  ← fulcrum security" : ""));
        });
        // Value ladder: enterprise value against cumulative claims
        const y0 = h * 0.62 + 58, xx = d3.scaleLinear().domain([0, 1300]).range([0, w]);
        g.append("text").attr("class", "lbl-2").attr("x", -10).attr("y", y0 + 14).attr("text-anchor", "end").text("Order of payment");
        let cum = 0;
        [...classes, { k: "eq", name: "Equity", claim: 1300 - 850 }].forEach((c) => {
          g.append("rect").attr("x", xx(cum)).attr("y", y0).attr("width", xx(c.claim) - 1).attr("height", 20).style("fill", C.surface2).style("stroke", C.line);
          g.append("text").attr("class", "lbl-2").attr("x", xx(cum + c.claim / 2)).attr("y", y0 + 14).attr("text-anchor", "middle").text(c.k === "eq" ? "Equity" : c.k === "sec" ? "Secured" : c.k === "uns" ? "Unsecured" : "Sub.");
          cum += c.claim;
        });
        g.append("rect").attr("x", 0).attr("y", y0).attr("width", xx(st.ev)).attr("height", 20).style("fill", C.concave).style("opacity", 0.25);
        g.append("line").attr("x1", xx(st.ev)).attr("x2", xx(st.ev)).attr("y1", y0 - 6).attr("y2", y0 + 26).style("stroke", C.hl).style("stroke-width", 2.5);
        g.append("text").attr("class", "lbl halo").attr("x", xx(st.ev)).attr("y", y0 - 10).attr("text-anchor", st.ev > 1000 ? "end" : "middle").text(`Enterprise value $${st.ev}M`);
      }
      const recU = rec("uns") * 100, ret = (recU / st.buy - 1) * 100;
      setTile(tl.a, "Secured recovery", Math.round(rec("sec") * 100) + "¢");
      setTile(tl.b, "Unsecured recovery", Math.round(recU) + "¢");
      setTile(tl.c, "Subordinated recovery", Math.round(rec("sub") * 100) + "¢");
      setTile(tl.d, "Bonds bought at " + st.buy + "¢", A.spct(ret, 0), "return if recovery is " + Math.round(recU) + "¢");
      tl.d.el.classList.toggle("hl", true);
    }
    function renderRecord(g, w, h) {
      $("cap-title").textContent = "EDHEC Distressed Securities index vs. US stocks, calendar years";
      const yrs = ["2006", "2007", "2008", "2009", "2010"];
      const ann = (k, yr) => S.total(HF[k].filter((_, i) => HF.dates[i].startsWith(yr)));
      const ser = [{ k: "ds", name: "EDHEC Distressed", col: C.concave }, { k: "mkt", name: "US stocks", col: C.market }];
      const x0 = d3.scaleBand().domain(yrs).range([0, w]).padding(0.25), x1 = d3.scaleBand().domain(ser.map((s) => s.k)).range([0, x0.bandwidth()]).padding(0.08);
      const y = d3.scaleLinear().domain([-40, 35]).range([h - 10, 20]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${y(-40)})`).call(d3.axisBottom(x0));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      yrs.forEach((yr) => ser.forEach((s) => {
        const v = ann(s.k, yr);
        A.hover(g.append("rect").attr("x", x0(yr) + x1(s.k)).attr("width", x1.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 3).style("fill", s.col), () => `<b>${yr}</b><br>${s.name}: ${A.spct(v)}`);
        g.append("text").attr("class", "lbl-2 halo").attr("x", x0(yr) + x1(s.k) + x1.bandwidth() / 2).attr("y", v >= 0 ? y(v) - 5 : y(v) + 13).attr("text-anchor", "middle").text(A.spct(v, 0));
      }));
      legend(g, ser.map((s) => ({ label: s.name, color: s.col })), 0, 6);
    }
    const presets = [[1100, 30, false], [800, 30, false], [550, 30, false], [550, 30, false], [550, 30, true], [550, 30, true]];
    A.register("w-cap", { render, step(i) { const [ev, buy, rec] = presets[i]; st.record = rec; st.buy = buy; sBuy.sync(); A.tween(st, { ev }, () => { sEv.sync(); render(); }); } });
  })();

  /* =========================================================
     5. GLOBAL MACRO: the pound in the ERM, 1992
     ========================================================= */
  (function () {
    const p = parts("w-erm");
    const pts = DATA.erm.map(([d, v]) => ({ d: ymd(d), v, s: d }));
    const CENTRAL = 2.95, FLOOR = 2.778, CEIL = 3.132;
    const iEntry = pts.findIndex((q) => q.s === "1992-09-15"), iBW = pts.findIndex((q) => q.s === "1992-09-16");
    const st = { stage: 0, exit: pts.findIndex((q) => q.s === "1992-10-05"), size: 10, show: pts.length - 1 };
    const frame = A.frame(p.chart, { t: 26, r: 96, b: 30, l: 46 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Short entered" }, { key: "b", label: "If the peg held" }, { key: "c", label: "Profit at exit" }, { key: "d", label: "Gain vs. loss" }]);
    const sSize = A.slider(p.ctl, { key: "size", label: "Short position", min: 1, max: 15, step: 0.5, fmt: (v) => "$" + v + "B" }, st, render);
    const sExit = A.slider(p.ctl, { key: "exit", label: "Exit date", min: iBW, max: pts.length - 1, step: 1, fmt: (v) => fmtDay(pts[v].d) }, st, () => { st.stage = 4; st.show = pts.length - 1; render(); });
    function render() {
      const { g, w, h } = frame();
      const shown = st.stage === 0 ? pts.findIndex((q) => q.s === "1992-07-31") : st.stage <= 2 ? iEntry : st.stage === 3 ? iBW + 1 : pts.length - 1;
      const x = d3.scaleTime().domain([pts[0].d, pts[pts.length - 1].d]).range([0, w]), y = d3.scaleLinear().domain([2.3, 3.2]).range([h, 0]);
      g.append("rect").attr("x", 0).attr("width", w).attr("y", y(CEIL)).attr("height", y(FLOOR) - y(CEIL)).style("fill", C.market).style("opacity", 0.1);
      A.axes(g, x, y, w, h, { yt: 6, yf: (v) => v.toFixed(2), xt: 9 });
      [[CEIL, "ERM ceiling 3.132"], [CENTRAL, "Central rate 2.95"], [FLOOR, "ERM floor 2.778"]].forEach(([v, lab], j) => {
        g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(v)).attr("y2", y(v)).style("stroke", j === 2 ? C.neg : C.marketT).style("stroke-width", j === 1 ? 1 : 1.6).style("stroke-dasharray", j === 1 ? "2 3" : "6 4");
        g.append("text").attr("class", "lbl-2 halo").attr("x", w + 6).attr("y", y(v) + 4).text(lab);
      });
      const vis = pts.slice(0, shown + 1);
      g.append("path").datum(vis).attr("d", d3.line().x((q) => x(q.d)).y((q) => y(q.v))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 2.2);
      A.hover(g.selectAll(".h").data(vis).join("rect").attr("x", (q) => x(q.d) - 2).attr("width", 4).attr("y", 0).attr("height", h).style("fill", "transparent"), (q) => `<b>${fmtDay(q.d)}</b><br>${q.v.toFixed(4)} DM per £`);
      const e = pts[iEntry];
      if (st.stage >= 2) {
        // Asymmetry arrows from the entry point
        const ax = x(e.d) - 16;
        const arrow = (to, col, lab) => {
          g.append("line").attr("x1", ax).attr("x2", ax).attr("y1", y(e.v)).attr("y2", y(to)).style("stroke", col).style("stroke-width", 3).attr("marker-end", "");
          g.append("path").attr("d", d3.symbol(d3.symbolTriangle, 70)()).attr("transform", `translate(${ax},${y(to)}) rotate(${to > e.v ? 0 : 180})`).style("fill", col);
          g.append("text").attr("class", "lbl halo").attr("x", ax - 10).attr("y", y(to) + (to > e.v ? 4 : 0)).attr("text-anchor", "end").style("fill", col).text(lab);
        };
        arrow(CENTRAL, C.neg, "Peg holds: −" + ((CENTRAL / e.v - 1) * 100).toFixed(0) + "% at most to central rate");
        arrow(2.45, C.convex, "Peg breaks: +" + ((1 - 2.45 / e.v) * 100).toFixed(0) + "% or more");
      }
      if (st.stage >= 3) {
        g.append("line").attr("x1", x(pts[iBW].d)).attr("x2", x(pts[iBW].d)).attr("y1", 0).attr("y2", h).style("stroke", C.neg).style("stroke-width", 1.5);
        g.append("text").attr("class", "lbl halo").attr("x", x(pts[iBW].d) + 6).attr("y", 14).style("fill", C.neg).text("Sep 16: Black Wednesday");
      }
      if (st.stage >= 4) {
        const xq = pts[st.exit];
        g.append("circle").attr("cx", x(xq.d)).attr("cy", y(xq.v)).attr("r", 6).style("fill", C.convex).style("stroke", C.surface).style("stroke-width", 2);
        g.append("text").attr("class", "lbl halo").attr("x", x(xq.d)).attr("y", y(xq.v) + 22).attr("text-anchor", "middle").text("Exit " + fmtDay(xq.d) + ": " + xq.v.toFixed(3));
      }
      g.append("circle").attr("cx", x(e.d)).attr("cy", y(e.v)).attr("r", st.stage >= 2 ? 5 : 0).style("fill", C.hl);
      const exitV = pts[st.exit].v, gain = (e.v - exitV) / e.v, loss = (CENTRAL - e.v) / e.v;
      setTile(tl.a, "Short entered", e.v.toFixed(4), "Sep 15 close, $" + st.size + "B");
      setTile(tl.b, "If the peg held", "−$" + (st.size * loss).toFixed(2) + "B", "pound back to the 2.95 central rate");
      setTile(tl.c, "Profit at exit", st.stage >= 3 ? "+$" + (st.size * gain).toFixed(2) + "B" : "–", st.stage >= 3 ? A.spct(gain * 100) + " on " + fmtDay(pts[st.exit].d) : "");
      setTile(tl.d, "Gain vs. loss", st.stage >= 3 ? (gain / loss).toFixed(1) + " to 1" : "–", "");
      tl.c.el.classList.toggle("hl", st.stage >= 4);
    }
    // Scroll step -> chart stage (step 1, the FX explainer, keeps the step 0 view)
    const stages = [0, 0, 1, 2, 3, 4];
    A.register("w-erm", { render, step(i) { st.stage = stages[i]; if (st.stage === 4) { st.exit = pts.findIndex((q) => q.s === "1992-10-05"); sExit.sync(); } render(); } });
  })();

  /* =========================================================
     6. MACRO 2022: one view, many expressions
     ========================================================= */
  (function () {
    const p = parts("w-2022");
    const P = DATA.m2022paths, mons = ["2021-12", ...d3.range(1, 13).map((i) => "2022-" + String(i).padStart(2, "0"))].map(ym);
    // "Long" means owning the named exposure; each series is an index = 100 at the end of 2021
    const assets = [
      { k: "spx", name: "S&P 500", path: P.spx },
      { k: "ust10", name: "10-yr Treasury", path: P.ust10 },
      { k: "usd_jpy", name: "US dollar vs. yen", path: P.usd_jpy },
      { k: "usd_eur", name: "US dollar vs. euro", path: P.eur.map((v) => 10000 / v) },
      { k: "oil", name: "WTI crude oil", path: P.oil },
      { k: "gold", name: "Gold", path: P.gold },
    ];
    assets.forEach((a) => (a.ret = a.path[a.path.length - 1] - 100));
    const st = { pos: { spx: 0, ust10: 0, usd_jpy: 0, usd_eur: 0, oil: 0, gold: 0 }, paths: false };
    const frame = A.frame(p.chart, { t: 26, r: 120, b: 30, l: 140 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Book return, 2022" }, { key: "b", label: "Positions" }, { key: "c", label: "S&P 500, 2022" }, { key: "d", label: "HFRI Macro, 2022" }]);
    const chips = document.createElement("div"); chips.className = "chips"; p.ctl.appendChild(chips);
    const chipEls = {};
    assets.forEach((a) => {
      const c = document.createElement("span"); c.className = "chip"; c.innerHTML = `${a.name}<button data-v="1">Long</button><button data-v="-1">Short</button>`;
      c.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const v = +b.dataset.v; st.pos[a.k] = st.pos[a.k] === v ? 0 : v; st.paths = false; b.blur(); render(); }));
      chips.appendChild(c); chipEls[a.k] = c;
    });
    const btn = A.buttons(p.ctl, "View", [{ label: "Returns" }, { label: "Paths during 2022" }], (it) => { st.paths = it.label !== "Returns"; render(); });
    function render() {
      btn.setOn(st.paths ? 1 : 0);
      assets.forEach((a) => chipEls[a.k].querySelectorAll("button").forEach((b) => { b.className = +b.dataset.v === st.pos[a.k] ? (st.pos[a.k] > 0 ? "on-long" : "on-short") : ""; }));
      const { g, w, h } = frame();
      const active = assets.filter((a) => st.pos[a.k] !== 0);
      if (st.paths) {
        $("y22-title").textContent = "Index level during 2022 (end of 2021 = 100)";
        const show = active.length ? active : assets.filter((a) => a.k === "oil" || a.k === "gold");
        const x = d3.scaleTime().domain(d3.extent(mons)).range([0, w]);
        const y = d3.scaleLinear().domain([d3.min(show, (a) => d3.min(a.path)) - 5, d3.max(show, (a) => d3.max(a.path)) + 5]).range([h, 0]).nice();
        A.axes(g, x, y, w, h, { xt: 6, xf: d3.timeFormat("%b") });
        g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(100)).attr("y2", y(100));
        const pal = { spx: C.marketT, ust10: C.ink2, usd_jpy: C.concave, usd_eur: C.hl, oil: C.convex, gold: C.concave };
        const labels = show.map((a) => {
          g.append("path").datum(a.path).attr("d", d3.line().x((v, i) => x(mons[i])).y((v) => y(v))).style("fill", "none").style("stroke", pal[a.k]).style("stroke-width", 2.5).style("stroke-dasharray", a.k === "gold" ? "6 3" : null);
          return { y: y(a.path[12]) + 4, a };
        });
        spread(labels).forEach((l) => g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", l.y).style("fill", pal[l.a.k]).text(`${l.a.name} ${A.spct(l.a.ret, 0)}`));
      } else {
        $("y22-title").textContent = "2022 return by expression";
        const rows = assets.map((a) => ({ ...a, v: st.pos[a.k] === 0 ? a.ret : st.pos[a.k] * a.ret, on: st.pos[a.k] !== 0 }));
        const x = d3.scaleLinear().domain([-25, 25]).range([0, w]), y = d3.scaleBand().domain(rows.map((r) => r.k)).range([0, h - 10]).padding(0.3);
        g.append("g").attr("class", "grid").attr("transform", `translate(0,${h - 10})`).call(d3.axisBottom(x).ticks(6).tickSize(-(h - 10)).tickFormat(""));
        g.append("g").attr("class", "axis").attr("transform", `translate(0,${h - 10})`).call(d3.axisBottom(x).ticks(6).tickFormat((v) => v + "%"));
        g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h - 10);
        rows.forEach((r) => {
          const col = !r.on ? C.ink3 : r.v >= 0 ? C.convex : C.neg;
          g.append("rect").attr("x", x(Math.min(0, r.v))).attr("width", Math.abs(x(r.v) - x(0))).attr("y", y(r.k)).attr("height", y.bandwidth()).attr("rx", 3).style("fill", col).style("opacity", r.on ? 1 : 0.35);
          g.append("text").attr("class", "lbl").attr("x", -10).attr("y", y(r.k) + y.bandwidth() / 2 + 4).attr("text-anchor", "end").style("opacity", r.on ? 1 : 0.6)
            .text(r.on ? (st.pos[r.k] > 0 ? "Long " : "Short ") + r.name.replace(/^Gold$/, "gold") : r.name);
          g.append("text").attr("class", "lbl-2 halo").attr("x", r.v >= 0 ? x(r.v) + 6 : x(r.v) - 6).attr("text-anchor", r.v >= 0 ? "start" : "end").attr("y", y(r.k) + y.bandwidth() / 2 + 4)
            .text(A.spct(r.v) + (r.on ? "" : " if long"));
        });
      }
      const book = active.length ? d3.mean(active, (a) => st.pos[a.k] * a.ret) : 0;
      setTile(tl.a, "Book return, 2022", active.length ? A.spct(book) : "–", active.length ? "equal weight, no leverage" : "toggle positions below");
      setTile(tl.b, "Positions", String(active.length));
      setTile(tl.c, "S&P 500, 2022", A.spct(assets[0].ret), "SPY total return");
      setTile(tl.d, "HFRI Macro, 2022", "+9.3%", "HFR");
      tl.a.el.classList.toggle("hl", active.length > 0);
    }
    const presets = [
      [{}, false], [{ ust10: -1 }, false], [{ ust10: -1, usd_jpy: 1 }, false], [{ oil: 1, gold: 1 }, true],
      [{ ust10: -1, usd_jpy: 1, usd_eur: 1, spx: -1, oil: 1, gold: 1 }, false],
    ];
    A.register("w-2022", { render, step(i) { const [pos, paths] = presets[i]; Object.keys(st.pos).forEach((k) => (st.pos[k] = pos[k] || 0)); st.paths = paths; render(); } });
  })();

  /* =========================================================
     7. CARRY: long dollar, short yen, 2021–2024
     ========================================================= */
  (function () {
    const p = parts("w-carry");
    const fx = DATA.usdjpy.map(([d, v]) => ({ d: ymd(d), v, s: d }));
    // Policy rates (%, upper bound of the Fed's target range; BOJ policy rate), effective from each date
    const fed = [["2020-03-16", 0.25], ["2022-03-17", 0.5], ["2022-05-05", 1.0], ["2022-06-16", 1.75], ["2022-07-28", 2.5], ["2022-09-22", 3.25], ["2022-11-03", 4.0], ["2022-12-15", 4.5], ["2023-02-02", 4.75], ["2023-03-23", 5.0], ["2023-05-04", 5.25], ["2023-07-27", 5.5], ["2024-09-19", 5.0], ["2024-11-08", 4.75], ["2024-12-19", 4.5]];
    const boj = [["2016-02-16", -0.1], ["2024-03-19", 0.1], ["2024-08-01", 0.25]];
    const rateOn = (tbl, s) => { let r = tbl[0][1]; tbl.forEach(([d, v]) => { if (d <= s) r = v; }); return r; };
    fx.forEach((q) => (q.gap = rateOn(fed, q.s) - rateOn(boj, q.s)));
    const idx = (s) => fx.findIndex((q) => q.s >= s);
    const iPeak = idx("2024-07-10"), iLow = idx("2024-08-05");
    const st = { entry: 0, lev: 1 };
    const frame = A.frame(p.chart, { t: 22, r: 70, b: 30, l: 50 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Rate gap at entry" }, { key: "b", label: "Gain to July 10, 2024" }, { key: "c", label: "July 10 to Aug 5, 2024" }, { key: "d", label: "Through 2024" }]);
    const sEntry = A.slider(p.ctl, { key: "entry", label: "Entry date", min: 0, max: iPeak - 5, step: 1, fmt: (v) => fmtDay(fx[v].d) }, st, render);
    const sLev = A.slider(p.ctl, { key: "lev", label: "Leverage", min: 1, max: 10, step: 0.5, fmt: (v) => v + "x" }, st, render);
    function equity() {
      const out = new Array(fx.length).fill(null); let v = 1; out[st.entry] = 1;
      for (let i = st.entry + 1; i < fx.length; i++) {
        const days = Math.max(1, (fx[i].d - fx[i - 1].d) / 864e5);
        const r = fx[i].v / fx[i - 1].v - 1 + (fx[i - 1].gap / 100) * days / 365;
        v = Math.max(0, v * (1 + st.lev * r)); out[i] = v;
      }
      return out;
    }
    function render() {
      const { g, w, h } = frame();
      const h1 = h * 0.52, gap = 26, h2 = h - h1 - gap;
      const x = d3.scaleTime().domain(d3.extent(fx, (q) => q.d)).range([0, w]);
      const y1 = d3.scaleLinear().domain([100, 165]).range([h1, 0]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y1).ticks(4).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y1).ticks(4));
      g.append("text").attr("class", "axis-label").attr("y", -8).text("Yen per US dollar");
      g.append("path").datum(fx).attr("d", d3.line().x((q) => x(q.d)).y((q) => y1(q.v))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 1.6);
      // Rate gap as a band under the price
      const yg = d3.scaleLinear().domain([0, 6]).range([h1, h1 - 60]);
      g.append("path").datum(fx).attr("d", d3.area().x((q) => x(q.d)).y0(h1).y1((q) => yg(Math.max(0, q.gap))).curve(d3.curveStepAfter)).style("fill", C.concave).style("opacity", 0.22);
      g.append("text").attr("class", "lbl-2").attr("x", x(fx[idx("2023-03-01")].d)).attr("y", h1 - 8).style("fill", C.concave).text("Fed minus BOJ rate gap (5.6% at peak)");
      [[iPeak, "161.7 on Jul 10, 2024"], [iLow, "143.9 on Aug 5"]].forEach(([i, lab], j) => {
        g.append("circle").attr("cx", x(fx[i].d)).attr("cy", y1(fx[i].v)).attr("r", 4).style("fill", j ? C.neg : C.convex);
        g.append("text").attr("class", "lbl halo").attr("x", x(fx[i].d) - 8).attr("y", y1(fx[i].v) + (j ? 16 : -8)).attr("text-anchor", "end").style("fill", j ? C.neg : C.convex).text(lab);
      });
      // Equity panel
      const eq = equity(), gg = g.append("g").attr("transform", `translate(0,${h1 + gap})`);
      const vals = eq.filter((v) => v !== null), y2 = d3.scaleLinear().domain([0, Math.max(1.4, d3.max(vals) * 1.08)]).range([h2, 0]);
      gg.append("g").attr("class", "grid").call(d3.axisLeft(y2).ticks(4).tickSize(-w).tickFormat(""));
      gg.append("g").attr("class", "axis").call(d3.axisLeft(y2).ticks(4).tickFormat((v) => "$" + v.toFixed(1)));
      gg.append("g").attr("class", "axis").attr("transform", `translate(0,${h2})`).call(d3.axisBottom(x).ticks(6));
      gg.append("text").attr("class", "axis-label").attr("y", -8).text(`Value of $1 in the trade at ${st.lev}x leverage`);
      gg.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y2(1)).attr("y2", y2(1)).style("stroke-dasharray", "3 3");
      const pts = eq.map((v, i) => ({ v, d: fx[i].d })).filter((q) => q.v !== null);
      gg.append("path").datum(pts).attr("d", d3.area().x((q) => x(q.d)).y0(y2(1)).y1((q) => y2(q.v))).style("fill", C.concave).style("opacity", 0.12);
      gg.append("path").datum(pts).attr("d", d3.line().x((q) => x(q.d)).y((q) => y2(q.v))).style("fill", "none").style("stroke", C.concave).style("stroke-width", 2.4);
      gg.append("rect").attr("x", x(fx[iPeak].d)).attr("width", x(fx[iLow].d) - x(fx[iPeak].d)).attr("y", 0).attr("height", h2).style("fill", C.neg).style("opacity", 0.18);
      g.append("line").attr("x1", x(fx[st.entry].d)).attr("x2", x(fx[st.entry].d)).attr("y1", 0).attr("y2", h).style("stroke", C.ink3).style("stroke-dasharray", "2 3");
      g.append("text").attr("class", "lbl-2 halo").attr("x", x(fx[st.entry].d) + 4).attr("y", h1 + gap - 4).text("Entry");
      const last = fx.length - 1;
      setTile(tl.a, "Rate gap at entry", A.pct(fx[st.entry].gap, 2), fmtDay(fx[st.entry].d));
      setTile(tl.b, "Gain to Jul 10, 2024", A.spct((eq[iPeak] - 1) * 100, 0));
      setTile(tl.c, "Jul 10 to Aug 5, 2024", A.spct((eq[iLow] / eq[iPeak] - 1) * 100, 0), "in 18 trading days");
      setTile(tl.d, "Through 2024", eq[last] <= 0 ? "wiped out" : A.spct((eq[last] - 1) * 100, 0));
      tl.c.el.classList.toggle("hl", true);
    }
    const presets = [["2021-01-04", 1], ["2022-03-01", 3], ["2024-01-02", 5], ["2024-01-02", 5]];
    A.register("w-carry", { render, step(i) { const [d, l] = presets[i]; st.entry = idx(d); st.lev = l; sEntry.sync(); sLev.sync(); render(); } });
  })();

  /* =========================================================
     8. TREND FOLLOWING: time-series momentum on real prices
     ========================================================= */
  (function () {
    const p = parts("w-trend");
    const T = DATA.trend, M = T.months.map(ym), NM = M.length;
    const st = { view: "single", asset: "oil", L: 12, hi: null };
    const frame = A.frame(p.chart, { t: 26, r: 110, b: 30, l: 50 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const sL = A.slider(p.ctl, { key: "L", label: "Lookback", min: 1, max: 24, step: 1, fmt: (v) => v + (v === 1 ? " month" : " months") }, st, render);
    const views = [{ label: "S&P 500, 2006–10", v: "single", a: "spx" }, { label: "Oil, 2014–16", v: "single", a: "oil14" }, { label: "Oil, 2006–10", v: "single", a: "oil" }, { label: "All eight markets", v: "port" }, { label: "Worst stock months", v: "worst" }];
    const btn = A.buttons(p.ctl, "View", views, (it) => { st.view = it.v; if (it.a) st.asset = it.a; st.hi = null; render(); });
    const sync = () => btn.setOn(views.findIndex((v) => v.v === st.view && (v.v !== "single" || v.a === st.asset)));
    const R = T.assets.map((a) => a.r);
    // Signal for asset a at month i uses only returns before month i
    function signal(a, i, L) {
      if (i - L < 1) return null; let c = 1;
      for (let j = i - L; j < i; j++) { if (R[a][j] === null) return null; c *= 1 + R[a][j] / 100; }
      return c >= 1 ? 1 : -1;
    }
    function trailVol(a, i) {
      const xs = []; for (let j = i - 12; j < i; j++) { if (j < 1 || R[a][j] === null) return null; xs.push(R[a][j]); }
      return A.sd(xs) * Math.sqrt(12);
    }
    function portfolio(L) {
      const out = new Array(NM).fill(null);
      for (let i = 14; i < NM; i++) {
        let s = 0, n = 0;
        R.forEach((r, a) => { const sg = signal(a, i, L), v = trailVol(a, i); if (sg === null || v === null || r[i] === null) return; s += sg * (20 / v) * r[i]; n++; });
        if (n) out[i] = s / n;
      }
      return out;
    }
    const yearRet = (r, yr) => S.total(r.filter((v, i) => v !== null && T.months[i].startsWith(yr)));
    function render() {
      sync();
      const { g, w, h } = frame();
      sL.el.style.display = st.view === "worst" ? "none" : "";
      if (st.view === "single") return renderSingle(g, w, h);
      if (st.view === "worst") return renderWorst(g, w, h);
      const pr = portfolio(st.L), i0 = pr.findIndex((v) => v !== null);
      const strat = pr.slice(i0), spx = R[0].slice(i0).map((v) => (v === null ? 0 : v)), D = M.slice(i0);
      const gS = S.growth(strat), gM = S.growth(spx);
      $("trend-title").textContent = `Eight-market trend rule vs. S&P 500, ${T.months[i0].slice(0, 4)}–2026 (log scale)`;
      const x = d3.scaleTime().domain(d3.extent(D)).range([0, w]), y = d3.scaleLog().domain([0.8, d3.max([...gS, ...gM]) * 1.1]).range([h, 0]);
      [["2008-01", "2008-12"], ["2022-01", "2022-12"]].forEach(([a, b]) => {
        const xa = x(ym(a)), xb = x(ym(b));
        g.append("rect").attr("x", xa).attr("width", xb - xa).attr("height", h).style("fill", C.convex).style("opacity", st.hi === a.slice(0, 4) ? 0.22 : 0.08);
        g.append("text").attr("class", "lbl-2").attr("x", (xa + xb) / 2).attr("y", 12).attr("text-anchor", "middle").text(a.slice(0, 4));
      });
      A.axes(g, x, y, w, h, { yt: 5, yf: (v) => "$" + d3.format("~g")(v) });
      g.selectAll(".axis").filter((d, i) => i === 1).call(d3.axisLeft(y).tickValues(logTicks(y)).tickFormat((v) => "$" + v));
      const labels = [[gM, C.market, "S&P 500 (price)"], [gS, C.convex, "Trend rule"]].map(([s, col, lab]) => {
        g.append("path").datum(s).attr("d", d3.line().x((v, i) => x(D[i])).y((v) => y(v))).style("fill", "none").style("stroke", col).style("stroke-width", 2.3);
        return { y: y(s[s.length - 1]) + 4, col, lab };
      });
      spread(labels).forEach((l) => g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", l.y).style("fill", l.col).text(l.lab));
      const ov = g.append("rect").attr("width", w).attr("height", h).style("fill", "transparent");
      ov.on("pointermove", (ev) => { const i = d3.bisectCenter(D, x.invert(d3.pointer(ev)[0])); A.tip.show(`<b>${fmtMon(D[i])}</b><br>Trend rule: ${A.spct(strat[i])}<br>S&P 500: ${A.spct(spx[i])}`, ev); }).on("pointerleave", A.tip.hide);
      setTile(tl.a, "Return per year", A.pct(S.cagr(strat)), "before costs and cash interest");
      setTile(tl.b, "Correlation to S&P 500", A.num(S.corr(strat, spx)), "volatility " + A.pct(S.vol(strat)));
      setTile(tl.c, "2008", A.spct(yearRet(pr, "2008")), "S&P 500 " + A.spct(yearRet(R[0], "2008")));
      setTile(tl.d, "2022", A.spct(yearRet(pr, "2022")), "S&P 500 " + A.spct(yearRet(R[0], "2022")));
      tl.c.el.classList.toggle("hl", st.hi === "2008"); tl.d.el.classList.toggle("hl", st.hi === "2022");
    }
    function renderSingle(g, w, h) {
      const a = T.assets.findIndex((z) => z.id === st.asset.replace("14", "")), r = R[a];
      const zoom = st.asset === "oil14" ? ["2014-01", "2016-12"] : ["2006-01", "2010-12"];
      const i0 = T.months.indexOf(zoom[0]), i1 = T.months.indexOf(zoom[1]);
      // Price index from returns (base 100 at the window start)
      const px = [100]; for (let i = i0 + 1; i <= i1; i++) px.push(px[px.length - 1] * (1 + (r[i] || 0) / 100));
      const D = M.slice(i0, i1 + 1), sig = D.map((_, j) => signal(a, i0 + j, st.L));
      $("trend-title").textContent = `${T.assets[a].name}: ${st.L}-month trend signal`;
      const x = d3.scaleTime().domain(d3.extent(D)).range([0, w]), y = d3.scaleLinear().domain(d3.extent(px)).range([h, 0]).nice();
      D.forEach((d, j) => {
        if (j === D.length - 1 || sig[j] === null) return;
        g.append("rect").attr("x", x(d)).attr("width", x(D[j + 1]) - x(d) + 0.5).attr("y", 0).attr("height", h).style("fill", sig[j] > 0 ? C.convex : C.neg).style("opacity", 0.16);
      });
      A.axes(g, x, y, w, h, { yt: 5, yf: (v) => v.toFixed(0) });
      g.append("path").datum(px).attr("d", d3.line().x((v, j) => x(D[j])).y((v) => y(v))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 2.3);
      g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", y(px[px.length - 1]) + 4).text(T.assets[a].name);
      legend(g, [{ label: "Long", color: C.convex }, { label: "Short", color: C.neg }], 0, -8);
      let v = 1; for (let j = 1; j < D.length; j++) if (sig[j] !== null) v *= 1 + sig[j] * (r[i0 + j] || 0) / 100;
      const flips = sig.filter((s, j) => j && s !== null && sig[j - 1] !== null && s !== sig[j - 1]).length;
      setTile(tl.a, "Market return", A.spct((px[px.length - 1] / 100 - 1) * 100, 0), zoom[0].slice(0, 4) + "–" + zoom[1].slice(0, 4));
      setTile(tl.b, "Rule return", A.spct((v - 1) * 100, 0), "unlevered, same period");
      setTile(tl.c, "Position changes", String(flips));
      setTile(tl.d, "Lookback", st.L + " mo.");
      tl.c.el.classList.remove("hl"); tl.d.el.classList.remove("hl");
    }
    function renderWorst(g, w, h) {
      $("trend-title").textContent = "The ten worst months for US stocks, 1997–2021";
      const order = d3.range(HF.mkt.length).sort((a, b) => HF.mkt[a] - HF.mkt[b]).slice(0, 10);
      const ser = [{ k: "mkt", name: "US stocks", col: C.market }, { k: "cta", name: "CTA index", col: C.convex }, { k: "ma", name: "Merger arbitrage", col: C.concave }];
      const x0 = d3.scaleBand().domain(order).range([0, w]).padding(0.2), x1 = d3.scaleBand().domain(ser.map((s) => s.k)).range([0, x0.bandwidth()]).padding(0.06);
      const y = d3.scaleLinear().domain([-18, 8]).range([h, 10]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x0).tickFormat((i) => d3.timeFormat("%b %y")(HD[i])));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      order.forEach((i) => ser.forEach((s) => {
        const v = HF[s.k][i];
        A.hover(g.append("rect").attr("x", x0(i) + x1(s.k)).attr("width", x1.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 2).style("fill", s.col),
          () => `<b>${fmtMon(HD[i])}</b><br>` + ser.map((z) => `${z.name}: ${A.spct(HF[z.k][i])}`).join("<br>"));
      }));
      legend(g, ser.map((s) => ({ label: s.name, color: s.col })), 0, -8);
      const pos = (k) => order.filter((i) => HF[k][i] > 0).length;
      setTile(tl.a, "Stocks, average", A.spct(d3.mean(order, (i) => HF.mkt[i])));
      setTile(tl.b, "CTA, average", A.spct(d3.mean(order, (i) => HF.cta[i])), "positive in " + pos("cta") + " of 10");
      setTile(tl.c, "Merger arb, average", A.spct(d3.mean(order, (i) => HF.ma[i])), "positive in " + pos("ma") + " of 10");
      setTile(tl.d, "Source", "EDHEC", "net of fees");
      tl.b.el.classList.add("hl"); tl.c.el.classList.remove("hl"); tl.d.el.classList.remove("hl");
    }
    const presets = [["single", "spx", null], ["port", null, null], ["port", null, "2008"], ["worst", null, null], ["port", null, "2022"]];
    A.register("w-trend", { render, step(i) { const [v, a, hi] = presets[i]; st.view = v; if (a) st.asset = a; st.hi = hi; st.L = 12; sL.sync(); render(); } });
  })();

  /* =========================================================
     9. RELATIVE VALUE: leverage, LTCM, and relative value indexes
     ========================================================= */
  (function () {
    const p = parts("w-lev");
    // Illustrative monthly spread path (%), January 1997 to December 1999
    const mons = d3.range(36).map((i) => new Date(1997, i, 1));
    const shock = { peak: 0.8 };
    function spreadPath() {
      return mons.map((d, i) => {
        if (i <= 18) return 0.3 - (0.1 * i) / 18;                       // slow convergence to mid-1998
        const pk = shock.peak, j = i - 19;                               // Aug 1998 onward
        if (j === 0) return 0.2 + (pk - 0.2) * 0.55;
        if (j === 1) return pk;
        if (j === 2) return pk * 0.93;
        return Math.max(0.05, pk * 0.93 - ((pk * 0.93 - 0.05) * (j - 2)) / 14);
      });
    }
    const st = { mode: "sim", lev: 25, reveal: 35 };
    const DUR = 6, CALL = 0.3; // spread duration; lenders force the position closed if capital falls below 30% of the start
    const frame = A.frame(p.chart, { t: 24, r: 70, b: 30, l: 52 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const ctlRow = document.createElement("div"); ctlRow.className = "controls"; ctlRow.style.width = "100%"; p.ctl.appendChild(ctlRow);
    const sLev = A.slider(ctlRow, { key: "lev", label: "Leverage (assets ÷ capital)", min: 1, max: 40, step: 1, fmt: (v) => v + "x" }, st, () => { st.mode = "sim"; render(); });
    const sPk = A.slider(ctlRow, { key: "peak", label: "Peak spread in the crisis", min: 0.2, max: 1.2, step: 0.05, fmt: (v) => v.toFixed(2) + "%" }, shock, () => { st.mode = "sim"; render(); });
    const btn = A.buttons(p.ctl, "View", [{ label: "Leverage simulator", m: "sim" }, { label: "LTCM record", m: "ltcm" }, { label: "Relative value indexes", m: "rv" }], (it) => { st.mode = it.m; render(); });
    function simulate() {
      const s = spreadPath(), eq = [1]; let dead = -1;
      for (let i = 1; i < s.length; i++) {
        if (dead >= 0) { eq.push(eq[i - 1]); continue; }
        const v = eq[i - 1] + st.lev * DUR * (s[i - 1] - s[i]) / 100;
        eq.push(Math.max(0, v)); if (v < CALL) dead = i;
      }
      return { s, eq, dead };
    }
    function render() {
      btn.setOn(["sim", "ltcm", "rv"].indexOf(st.mode));
      ctlRow.style.display = st.mode === "sim" ? "" : "none";
      const { g, w, h } = frame();
      [tl.a, tl.b, tl.c, tl.d].forEach((t) => t.el.classList.remove("hl"));
      if (st.mode === "ltcm") return renderLTCM(g, w, h);
      if (st.mode === "rv") return renderRV(g, w, h);
      $("lev-title").textContent = "A leveraged convergence trade"; $("lev-src").textContent = "Illustrative spread path";
      const { s, eq, dead } = simulate(), n = Math.min(st.reveal, 35);
      const h1 = h * 0.38, gap = 30, h2 = h - h1 - gap;
      const x = d3.scaleTime().domain(d3.extent(mons)).range([0, w]);
      const y1 = d3.scaleLinear().domain([0, Math.max(0.8, shock.peak * 1.1)]).range([h1, 0]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y1).ticks(3).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y1).ticks(3).tickFormat((v) => v.toFixed(1) + "%"));
      g.append("text").attr("class", "axis-label").attr("y", -8).text("Spread between the two bonds");
      g.append("path").datum(s.slice(0, n + 1)).attr("d", d3.line().x((v, i) => x(mons[i])).y((v) => y1(v))).style("fill", "none").style("stroke", C.hl).style("stroke-width", 2.2);
      g.append("rect").attr("x", x(mons[19])).attr("width", x(mons[22]) - x(mons[19])).attr("y", 0).attr("height", h).style("fill", C.neg).style("opacity", 0.12);
      g.append("text").attr("class", "lbl-2").attr("x", x(mons[19]) + 4).attr("y", 12).style("fill", C.neg).text("Aug–Oct 1998");
      const gg = g.append("g").attr("transform", `translate(0,${h1 + gap})`);
      const y2 = d3.scaleLinear().domain([0, Math.max(2, d3.max(eq) * 1.05)]).range([h2, 0]);
      gg.append("g").attr("class", "grid").call(d3.axisLeft(y2).ticks(4).tickSize(-w).tickFormat(""));
      gg.append("g").attr("class", "axis").call(d3.axisLeft(y2).ticks(4).tickFormat((v) => "$" + v.toFixed(1)));
      gg.append("g").attr("class", "axis").attr("transform", `translate(0,${h2})`).call(d3.axisBottom(x).ticks(6));
      gg.append("text").attr("class", "axis-label").attr("y", -8).text(`Value of $1 of capital at ${st.lev}x leverage`);
      gg.append("line").attr("x1", 0).attr("x2", w).attr("y1", y2(CALL)).attr("y2", y2(CALL)).style("stroke", C.neg).style("stroke-dasharray", "5 4");
      gg.append("text").attr("class", "lbl-2 halo").attr("x", w + 4).attr("y", y2(CALL) + 4).style("fill", C.neg).text("Margin call");
      gg.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y2(1)).attr("y2", y2(1)).style("stroke-dasharray", "3 3");
      const col = dead >= 0 ? C.neg : C.concave;
      gg.append("path").datum(eq.slice(0, n + 1)).attr("d", d3.line().x((v, i) => x(mons[i])).y((v) => y2(v))).style("fill", "none").style("stroke", col).style("stroke-width", 2.6);
      if (dead >= 0 && dead <= n) gg.append("text").attr("class", "lbl halo").attr("x", x(mons[dead]) + 8).attr("y", y2(eq[dead]) - 8).style("fill", C.neg).text("Forced to close at the widest spread");
      const pre = eq[18] - 1, trough = d3.min(eq.slice(18)) / eq[18] - 1, fin = eq[35] - 1;
      setTile(tl.a, "Return to mid-1998", A.spct(pre * 100, 0), "18 months");
      setTile(tl.b, "Crisis loss", A.spct(trough * 100, 0), "from the mid-1998 peak");
      setTile(tl.c, "Final return", A.spct(fin * 100, 0), dead >= 0 ? "position closed by lenders" : "held to convergence");
      setTile(tl.d, "Outcome", dead >= 0 ? "Forced out" : "Survived");
      (dead >= 0 ? tl.d : tl.c).el.classList.add("hl");
    }
    function renderLTCM(g, w, h) {
      $("lev-title").textContent = "Long-Term Capital Management, net returns to investors"; $("lev-src").textContent = "Lowenstein (2000); Jorion (2000)";
      const rows = [["1994", 21, "Mar–Dec"], ["1995", 43], ["1996", 41], ["1997", 17], ["1998", -98, "lost $4.6B of $4.7B starting capital"]];
      const x = d3.scaleBand().domain(rows.map((r) => r[0])).range([0, w]).padding(0.3), y = d3.scaleLinear().domain([-100, 50]).range([h, 0]);
      A.axes(g, d3.scaleLinear().domain([0, 1]).range([0, 0]), y, w, h, { yt: 6, yf: (v) => v + "%" });
      g.selectAll(".axis").filter((d, i) => i === 0).remove();
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).tickSize(0));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      rows.forEach(([yr, v, note]) => {
        g.append("rect").attr("x", x(yr)).attr("width", x.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 4).style("fill", v > 0 ? C.concave : C.neg);
        g.append("text").attr("class", "lbl halo").attr("x", x(yr) + x.bandwidth() / 2).attr("y", v > 0 ? y(v) - 8 : y(v) + 18).attr("text-anchor", "middle").text(v > 0 ? "+" + v + "%" : "−$4.6B");
        if (note) g.append("text").attr("class", "lbl-2 halo").attr("x", x(yr) + x.bandwidth() / 2).attr("y", v > 0 ? y(v) - 24 : y(v) + 34).attr("text-anchor", "middle").text(note);
      });
      setTile(tl.a, "Capital, start of 1998", "$4.7B");
      setTile(tl.b, "Assets", "≈$129B", "over 25 to 1");
      setTile(tl.c, "Derivatives notional", "≈$1.25T");
      setTile(tl.d, "Bank recapitalization", "$3.6B", "14 banks, Sep 23, 1998");
      tl.d.el.classList.add("hl");
    }
    function renderRV(g, w, h) {
      $("lev-title").textContent = "Relative value indexes in three crises"; $("lev-src").textContent = "EDHEC-Risk Alternative Indexes, net of fees";
      const per = [["Aug–Oct 1998", "1998-08", "1998-10"], ["2008", "2008-01", "2008-12"], ["Feb–Mar 2020", "2020-02", "2020-03"]];
      const ser = [{ k: "fia", name: "Fixed income arbitrage", col: C.concave }, { k: "ca", name: "Convertible arbitrage", col: C.hl }, { k: "rv", name: "Relative value", col: C.ink3 }, { k: "mkt", name: "US stocks", col: C.market }];
      const tot = (k, a, b) => S.total(HF[k].slice(HF.dates.indexOf(a), HF.dates.indexOf(b) + 1));
      const x0 = d3.scaleBand().domain(per.map((q) => q[0])).range([0, w]).padding(0.22), x1 = d3.scaleBand().domain(ser.map((s) => s.k)).range([0, x0.bandwidth()]).padding(0.08);
      const y = d3.scaleLinear().domain([-40, 5]).range([h, 16]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${y(0)})`).call(d3.axisTop(x0).tickSize(0)).selectAll("text").attr("dy", "-0.4em");
      per.forEach(([lab, a, b]) => ser.forEach((s) => {
        const v = tot(s.k, a, b);
        A.hover(g.append("rect").attr("x", x0(lab) + x1(s.k)).attr("width", x1.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 2).style("fill", s.col), () => `<b>${lab}</b><br>${s.name}: ${A.spct(v)}`);
        g.append("text").attr("class", "lbl-2 halo").attr("x", x0(lab) + x1(s.k) + x1.bandwidth() / 2).attr("y", y(v) + 13).attr("text-anchor", "middle").text(A.spct(v, 0));
      }));
      legend(g, ser.map((s) => ({ label: s.name, color: s.col })), 0, h + 22);
      setTile(tl.a, "Fixed inc. arb, 2008", A.spct(tot("fia", "2008-01", "2008-12")));
      setTile(tl.b, "Convertible arb, 2008", A.spct(tot("ca", "2008-01", "2008-12")));
      setTile(tl.c, "Fixed inc. arb, Oct 1998", A.spct(HF.fia[HF.dates.indexOf("1998-10")]));
      setTile(tl.d, "Treasury basis, 2020", "Unwound", "Fed bought Treasuries");
    }
    const presets = [["sim", 25, 18], ["sim", 25, 35], ["ltcm"], ["ltcm"], ["rv"]];
    A.register("w-lev", {
      render,
      step(i) {
        const [m, lev, rev] = presets[i]; st.mode = m;
        if (m === "sim") { st.lev = lev; shock.peak = 0.8; sLev.sync(); sPk.sync(); if (rev > st.reveal || i === 0) { st.reveal = i === 0 ? 18 : st.reveal; A.tween(st, { reveal: rev }, render, 1000); return; } st.reveal = rev; }
        render();
      },
    });
  })();

  /* =========================================================
     10. MULTI-STRATEGY: pods with drawdown limits (simulated)
     ========================================================= */
  (function () {
    const p = parts("w-pod");
    const st = { stop: 100, rho: 0.05, seed: 3 };
    const NP = 40, T = 60;
    const frame = A.frame(p.chart, { t: 24, r: 100, b: 30, l: 50 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Platform Sharpe" }, { key: "b", label: "Average pod Sharpe" }, { key: "c", label: "Pods cut" }, { key: "d", label: "Platform worst drawdown" }]);
    const sStop = A.slider(p.ctl, { key: "stop", label: "Pod drawdown limit", min: 2, max: 100, step: 1, fmt: (v) => (v >= 100 ? "none" : "−" + v + "%") }, st, render);
    const sRho = A.slider(p.ctl, { key: "rho", label: "Correlation between pods", min: 0, max: 0.6, step: 0.05, fmt: (v) => v.toFixed(2) }, st, render);
    A.buttons(p.ctl, "", [{ label: "New random draw" }], () => { st.seed++; render(); });
    function simulate() {
      const rnd = A.rng(100 + st.seed), POD_VOL = 6, vol = POD_VOL / Math.sqrt(12);
      const common = d3.range(T).map(() => rnd.normal());
      const newPod = () => ({ edge: 0.35 + 0.5 * rnd.normal(), v: 1, pk: 1, path: [], live: true });
      const shocks = d3.range(400).map(() => d3.range(T).map(() => rnd.normal()));
      let pods = d3.range(NP).map(newPod), all = [...pods], cut = 0, plat = [], sid = NP;
      pods.forEach((q, j) => (q.sh = j));
      for (let t = 0; t < T; t++) {
        let s = 0;
        pods.forEach((q) => {
          const z = Math.sqrt(st.rho) * common[t] + Math.sqrt(1 - st.rho) * shocks[q.sh][t];
          const r = (q.edge * POD_VOL) / 12 + vol * z;
          q.v *= 1 + r / 100; q.pk = Math.max(q.pk, q.v); q.path.push({ t, v: q.v }); s += r; q.rs = (q.rs || []).concat(r);
        });
        plat.push(s / pods.length);
        pods = pods.map((q) => {
          if (st.stop < 100 && q.v / q.pk - 1 <= -st.stop / 100) {
            q.live = false; cut++; const n = newPod(); n.sh = sid++ % 400; n.path.push({ t, v: 1 }); n.v = 1; all.push(n); return n;
          }
          return q;
        });
      }
      const sharpe = (r) => (A.mean(r) * 12) / (A.sd(r) * Math.sqrt(12));
      const podSh = all.filter((q) => q.rs && q.rs.length >= 12).map((q) => sharpe(q.rs));
      return { all, plat, cut, platSh: sharpe(plat), podSh: A.mean(podSh) };
    }
    function render() {
      const { g, w, h } = frame();
      const sim = simulate(), gP = S.growth(sim.plat);
      const x = d3.scaleLinear().domain([0, T]).range([0, w]), y = d3.scaleLog().domain([0.8, 1.8]).range([h, 0]).clamp(true);
      A.axes(g, x, y, w, h, { xf: (v) => "Year " + v / 12, xt: 5, yf: (v) => "$" + v.toFixed(1), yt: 5 });
      g.selectAll(".axis").filter((d, i) => i === 0).call(d3.axisBottom(x).tickValues([0, 12, 24, 36, 48, 60]).tickFormat((v) => "Year " + v / 12));
      g.selectAll(".axis").filter((d, i) => i === 1).call(d3.axisLeft(y).tickValues([0.8, 0.9, 1, 1.2, 1.4, 1.6, 1.8]).tickFormat((v) => "$" + v.toFixed(1)));
      sim.all.forEach((q) => {
        g.append("path").datum(q.path).attr("d", d3.line().x((d) => x(d.t + 1)).y((d) => y(d.v))).style("fill", "none").style("stroke", C.ink3).style("stroke-width", 1).style("opacity", q.live ? 0.45 : 0.25);
        if (!q.live) { const e = q.path[q.path.length - 1]; g.append("text").attr("x", x(e.t + 1)).attr("y", y(e.v) + 4).attr("text-anchor", "middle").style("fill", C.neg).style("font-size", "10px").text("×"); }
      });
      g.append("path").datum(gP).attr("d", d3.line().x((v, i) => x(i + 1)).y((v) => y(v))).style("fill", "none").style("stroke", C.concave).style("stroke-width", 3.2);
      g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", y(gP[T - 1]) + 4).style("fill", C.concave).text("Platform");
      legend(g, [{ label: "Individual pods", color: C.ink3 }, { label: "Cut at limit", color: C.neg }, { label: "Platform (average)", color: C.concave }], 0, -8);
      setTile(tl.a, "Platform Sharpe", A.num(sim.platSh), "before fees");
      setTile(tl.b, "Average pod Sharpe", A.num(sim.podSh));
      setTile(tl.c, "Pods cut", String(sim.cut), st.stop >= 100 ? "no limit" : "at −" + st.stop + "%");
      setTile(tl.d, "Platform worst drawdown", A.pct(S.maxdd(sim.plat)));
      tl.a.el.classList.add("hl");
    }
    const presets = [[100, 0.05], [5, 0.05], [5, 0.05], [5, 0.35]];
    A.register("w-pod", { render, step(i) { const [s, r] = presets[i]; st.stop = s; st.rho = r; sStop.sync(); sRho.sync(); render(); } });
  })();

  /* =========================================================
     11. ALLOCATOR: 60/40 plus a hedge fund sleeve (real data)
     ========================================================= */
  (function () {
    const p = parts("w-alloc");
    const keys = ["ma", "rv", "gm", "cta"];
    const st = { sleeve: 0, ma: 25, rv: 25, gm: 25, cta: 25, view: "growth", crisis: false };
    const frame = A.frame(p.chart, { t: 26, r: 110, b: 30, l: 50 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "Return per year" }, { key: "b", label: "Volatility" }, { key: "c", label: "Sharpe ratio" }, { key: "d", label: "Worst drawdown" }]);
    const ctlRow = document.createElement("div"); ctlRow.className = "controls"; ctlRow.style.width = "100%"; p.ctl.appendChild(ctlRow);
    const sl = {};
    sl.sleeve = A.slider(ctlRow, { key: "sleeve", label: "Hedge fund sleeve", min: 0, max: 50, step: 5, fmt: (v) => v + "%" }, st, render);
    keys.forEach((k) => (sl[k] = A.slider(ctlRow, { key: k, label: NAMES[k].replace(" / trend following", " (trend)"), min: 0, max: 100, step: 5, fmt: (v) => v }, st, render)));
    const views = [{ label: "Growth", v: "growth" }, { label: "Correlations", v: "heat" }, { label: "2008", v: "y2008" }, { label: "2022", v: "y2022" }];
    const btn = A.buttons(p.ctl, "View", views, (it) => { st.view = it.v; render(); });
    const btnC = A.buttons(p.ctl, "Months", [{ label: "Normal" }, { label: "Stocks down 5%+" }], (it) => { st.crisis = it.label !== "Normal"; render(); });
    const n = HF.dates.length;
    function series() {
      const tot = keys.reduce((s, k) => s + st[k], 0) || 1, s = st.sleeve / 100;
      const sleeveR = d3.range(n).map((i) => keys.reduce((a, k) => a + (st[k] / tot) * HF[k][i], 0));
      const base = d3.range(n).map((i) => 0.6 * HF.mkt[i] + 0.4 * HF.bond[i]);
      const port = d3.range(n).map((i) => (1 - s) * base[i] + s * sleeveR[i]);
      return { base, port, sleeveR };
    }
    const sharpe = (r) => ((A.mean(r) - A.mean(HF.rf)) * 12) / (A.sd(r) * Math.sqrt(12));
    function render() {
      btn.setOn(views.findIndex((v) => v.v === st.view)); btnC.setOn(st.crisis ? 1 : 0);
      btnC.row.style.display = st.view === "heat" ? "" : "none";
      $("alloc-src").textContent = st.view === "y2022" ? "HFR press releases; Cambridge Associates; Bloomberg US Agg" : "EDHEC-Risk indexes; Ken French; 10-yr Treasury from yields";
      const { g, w, h } = frame();
      const { base, port, sleeveR } = series();
      if (st.view === "growth") {
        $("alloc-title").textContent = "Growth of $1: 60/40 with and without a hedge fund sleeve, 1997–2021";
        const gB = S.growth(base), gS = S.growth(port);
        const x = d3.scaleTime().domain(d3.extent(HD)).range([0, w]), y = d3.scaleLinear().domain([0.8, d3.max([...gB, ...gS]) * 1.05]).range([h, 0]);
        [["2000-09", "2002-09"], ["2007-11", "2009-02"], ["2020-02", "2020-03"]].forEach(([a, b]) => g.append("rect").attr("x", x(ym(a))).attr("width", Math.max(3, x(ym(b)) - x(ym(a)))).attr("height", h).style("fill", C.neg).style("opacity", 0.1));
        A.axes(g, x, y, w, h, { yt: 5, yf: (v) => "$" + v.toFixed(1) });
        const lines = [[gB, C.market, "60/40"]];
        if (st.sleeve > 0) lines.push([gS, C.convex, `With ${st.sleeve}% sleeve`]);
        lines.forEach(([s, col, lab], j) => {
          g.append("path").datum(s).attr("d", d3.line().x((v, i) => x(HD[i])).y((v) => y(v))).style("fill", "none").style("stroke", col).style("stroke-width", 2.4);
          g.append("text").attr("class", "lbl halo").attr("x", w + 6).attr("y", y(s[n - 1]) + 4 + (j ? 12 : -2)).style("fill", col).text(lab);
        });
      } else if (st.view === "heat") renderHeat(g, w, h);
      else if (st.view === "y2008") render2008(g, w, h, base, port, sleeveR);
      else render2022(g, w, h);
      const d = (a, b, f, unit = "") => (st.sleeve ? "60/40: " + f(b) + unit : "");
      setTile(tl.a, "Return per year", A.pct(S.cagr(port)), d(0, S.cagr(base), A.pct));
      setTile(tl.b, "Volatility", A.pct(S.vol(port)), d(0, S.vol(base), A.pct));
      setTile(tl.c, "Sharpe ratio", A.num(sharpe(port)), d(0, sharpe(base), A.num));
      setTile(tl.d, "Worst drawdown", A.pct(S.maxdd(port)), d(0, S.maxdd(base), A.pct));
      tl.c.el.classList.toggle("hl", st.sleeve > 0);
    }
    function renderHeat(g, w, h) {
      const ks = ["mkt", "bond", "ma", "rv", "gm", "cta"], lab = { mkt: "US stocks", bond: "10-yr Treasury", ma: "Merger arb.", rv: "Relative value", gm: "Global macro", cta: "Trend (CTA)" };
      const idx = d3.range(n).filter((i) => (st.crisis ? HF.mkt[i] <= -5 : HF.mkt[i] > -5));
      $("alloc-title").textContent = `Correlations in ${st.crisis ? "months when stocks fell 5% or more" : "all other months"} (${idx.length} months)`;
      const sz = Math.min(w - 10, h - 40) / ks.length, x0 = (w - sz * ks.length) / 2 + 30;
      const col = d3.scaleLinear().domain([-1, 0, 1]).range(["#00ffa2", "#07272e", "#00ddff"]);
      const light = document.documentElement.dataset.theme === "light";
      if (light) col.range(["#00a36a", "#f5fafb", "#0091ad"]);
      ks.forEach((a, i) => ks.forEach((b, j) => {
        const c = S.corr(idx.map((t) => HF[a][t]), idx.map((t) => HF[b][t]));
        A.hover(g.append("rect").attr("x", x0 + j * sz).attr("y", 20 + i * sz).attr("width", sz - 3).attr("height", sz - 3).attr("rx", 4).style("fill", i === j ? C.surface2 : col(c)), () => `${lab[a]} vs. ${lab[b]}: ${A.num(c)}`);
        g.append("text").attr("x", x0 + j * sz + sz / 2).attr("y", 20 + i * sz + sz / 2 + 4).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", 600)
          .style("fill", Math.abs(c) > 0.55 ? (light ? "#fff" : "#001114") : C.ink).text(i === j ? "" : A.num(c, 2));
      }));
      ks.forEach((a, i) => {
        g.append("text").attr("class", "lbl-2").attr("x", x0 - 8).attr("y", 20 + i * sz + sz / 2 + 4).attr("text-anchor", "end").text(lab[a]);
        g.append("text").attr("class", "lbl-2").attr("x", x0 + i * sz + sz / 2).attr("y", 12).attr("text-anchor", "middle").text(lab[a].split(" ")[0]);
      });
    }
    function render2008(g, w, h, base, port, sleeveR) {
      $("alloc-title").textContent = "Calendar 2008 returns";
      const yr = (r) => S.total(r.filter((_, i) => HF.dates[i].startsWith("2008")));
      const rows = [["US stocks", yr(HF.mkt), C.market], ["10-yr Treasury", yr(HF.bond), C.marketT], ["Merger arb.", yr(HF.ma), C.concave], ["Relative value", yr(HF.rv), C.concave], ["Global macro", yr(HF.gm), C.convex], ["Trend (CTA)", yr(HF.cta), C.convex], ["Your sleeve", yr(sleeveR), C.hl], ["60/40", yr(base), C.market], ["60/40 + sleeve", yr(port), C.hl]];
      const x = d3.scaleBand().domain(rows.map((r) => r[0])).range([0, w]).padding(0.25), y = d3.scaleLinear().domain([-40, 25]).range([h - 30, 10]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      rows.forEach(([k, v, c], j) => {
        g.append("rect").attr("x", x(k)).attr("width", x.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 3).style("fill", c).style("opacity", j >= 6 ? 1 : 0.85);
        g.append("text").attr("class", "lbl halo").attr("x", x(k) + x.bandwidth() / 2).attr("y", v >= 0 ? y(v) - 6 : y(v) + 14).attr("text-anchor", "middle").text(A.spct(v, 1));
        wrapLabel(g, k, x(k) + x.bandwidth() / 2, h - 8);
      });
      // Separate the strategy bars from the portfolio bars
      const xs = x(rows[6][0]) - (x.step() * x.padding()) / 2;
      g.append("line").attr("x1", xs).attr("x2", xs).attr("y1", 0).attr("y2", h).style("stroke", C.line);
    }
    function render2022(g, w, h) {
      $("alloc-title").textContent = "Calendar 2022 returns, reported index data";
      const rows = [["S&P 500", -18.1, C.market], ["US bonds (Agg)", -13.0, C.marketT], ["HFR Equity Hedge", -10.2, C.ink3], ["HFR Event Driven", -4.6, C.concave], ["HFR Relative Value", -0.8, C.concave], ["HFRI Macro", 9.3, C.convex], ["HFRI 500 Systematic", 16.5, C.convex]];
      const x = d3.scaleBand().domain(rows.map((r) => r[0])).range([0, w]).padding(0.25), y = d3.scaleLinear().domain([-22, 20]).range([h - 30, 10]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      rows.forEach(([k, v, c]) => {
        g.append("rect").attr("x", x(k)).attr("width", x.bandwidth()).attr("y", y(Math.max(0, v))).attr("height", Math.abs(y(v) - y(0))).attr("rx", 3).style("fill", c);
        g.append("text").attr("class", "lbl halo").attr("x", x(k) + x.bandwidth() / 2).attr("y", v >= 0 ? y(v) - 6 : y(v) + 14).attr("text-anchor", "middle").text(A.spct(v, 1));
        wrapLabel(g, k, x(k) + x.bandwidth() / 2, h - 8);
      });
    }
    // Category label on up to two lines under a bar
    function wrapLabel(g, k, cx, y) {
      const words = k.split(" "), cut = Math.ceil(words.length / 2);
      const lines = words.length > 1 ? [words.slice(0, cut).join(" "), words.slice(cut).join(" ")] : [k];
      const t = g.append("text").attr("class", "lbl-2").attr("text-anchor", "middle").style("font-size", "10px");
      lines.forEach((l, i) => t.append("tspan").attr("x", cx).attr("y", y + i * 12 - (lines.length - 1) * 6).text(l));
    }
    const presets = [[0, "growth", false], [20, "growth", false], [20, "heat", true], [20, "y2008", false], [20, "y2022", false]];
    A.register("w-alloc", {
      render,
      step(i) {
        const [s, v, c] = presets[i]; st.view = v; st.crisis = c;
        if (i <= 1) keys.forEach((k) => (st[k] = 25));
        Object.values(sl).forEach((x) => x.sync());
        A.tween(st, { sleeve: s }, () => { st.sleeve = Math.round(st.sleeve); sl.sleeve.sync(); render(); });
      },
    });
  })();

  /* =========================================================
     5. GROUP PROJECT: merger arbitrage spread calculator
     ========================================================= */
  (function () {
    const el = $("w-calc");
    if (!el) return;
    const fields = [
      { key: "offer", label: "Offer per share ($)" },
      { key: "price", label: "Target price now ($)" },
      { key: "fall", label: "Fallback price ($)" },
      { key: "months", label: "Months to close" },
    ];
    const examples = [
      { label: "Activision, Jan 2022", v: { offer: 95, price: 79.01, fall: 65.39, months: 17 } },
      { label: "Blank", v: { offer: 0, price: 0, fall: 0, months: 0 } },
    ];
    const st = Object.assign({}, examples[0].v);
    const btns = A.buttons(el.querySelector(".calc-head"), "", examples, (ex) => load(ex));
    const inputs = fields.map((f) => {
      const lab = document.createElement("label"); lab.className = "cin";
      lab.innerHTML = `<span>${f.label}</span><input type="number" step="any" min="0" inputmode="decimal">`;
      const input = lab.querySelector("input");
      input.addEventListener("input", () => { st[f.key] = input.value === "" ? 0 : +input.value; render(); });
      el.querySelector(".calc-in").appendChild(lab); return { f, input };
    });
    const tl = A.tiles(el.querySelector(".calc-out"), [{ key: "gs", label: "Spread" }, { key: "ann", label: "Annualized return" }, { key: "down", label: "Downside" }, { key: "prob", label: "Implied probability" }]);
    const pc = (v) => (isFinite(v) ? (v * 100).toFixed(1) + "%" : "–");
    function load(ex) {
      Object.assign(st, ex.v);
      inputs.forEach(({ f, input }) => (input.value = st[f.key] || ""));
      btns.setOn(examples.indexOf(ex)); render();
    }
    function render() {
      const O = st.offer, P = st.price, F = st.fall, ok = O > 0 && P > 0;
      const gs = ok ? O / P - 1 : NaN;
      const ann = ok && st.months > 0 ? Math.pow(1 + gs, 12 / st.months) - 1 : NaN;
      const down = P > 0 && F > 0 ? F / P - 1 : NaN;
      const prob = ok && F > 0 && O > F ? (P - F) / (O - F) : NaN;
      setTile(tl.gs, "Spread", pc(gs), "if it closes");
      setTile(tl.ann, "Annualized return", pc(ann), st.months > 0 ? "over " + st.months + " months" : "");
      setTile(tl.down, "Downside", pc(down), "if it breaks");
      setTile(tl.prob, "Implied probability", pc(prob), "of closing");
      tl.down.el.classList.toggle("neg", isFinite(down));
    }
    load(examples[0]);
  })();

  A.boot();
})();
