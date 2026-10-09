// One interactive per chapter. Each widget owns its state, a render(), and a step(i)
// that the scroll position calls to move the visual to that step's preset.
(function () {
  const A = window.App;
  const C = {
    market: "var(--market)", long: "var(--long)", short: "var(--short)", alpha: "var(--alpha)",
    idio: "var(--idio)", bonds: "var(--bonds)", neg: "var(--neg)", ink: "var(--ink)", ink2: "var(--ink-2)",
    ink3: "var(--ink-3)", line: "var(--line)", surface: "var(--surface)", surface2: "var(--surface-2)",
  };
  const $ = (id) => document.getElementById(id);
  const parts = (id) => {
    const el = $(id);
    return { el, chart: el.querySelector(".chart"), ro: el.querySelector(".readouts"), ctl: el.querySelector(".controls") };
  };
  const show = (el, on) => { if (el) el.style.display = on ? "" : "none"; };

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

  // Standardized simulated monthly series: exact mean/sd, and noise orthogonal to the market,
  // so regressions recover exactly the alpha and beta we set.
  function standardize(arr, mean, sd) { const m = A.mean(arr), s = A.sd(arr); return arr.map((x) => mean + (x - m) / s * sd); }
  function orthogonalTo(z, m) {
    const mz = A.mean(z), mm = A.mean(m);
    let c = 0, v = 0; for (let i = 0; i < z.length; i++) { c += (z[i] - mz) * (m[i] - mm); v += (m[i] - mm) ** 2; }
    const r = z.map((x, i) => (x - mz) - (c / v) * (m[i] - mm));
    return standardize(r, 0, 1);
  }
  const T = 60, rnd = A.rng(42);
  const MKT = standardize(d3.range(T).map(() => rnd.normal()), 0.5, 16 / Math.sqrt(12)); // monthly excess %, 6%/yr, 16% vol
  const Z = [0, 1, 2, 3].map(() => orthogonalTo(d3.range(T).map(() => rnd.normal()), MKT));

  /* =========================================================
     0. HOOK: losing position that improves the portfolio
     ========================================================= */
  (function () {
    const p = parts("w-hook");
    const eA = 7, sA = 30, eB = 4, sB = 28, rho = 0.9, h = 0.69;
    const eH = eA - h * eB, sH = Math.sqrt(sA * sA + h * h * sB * sB - 2 * h * rho * sA * sB);
    const k = sA / sH; // scale-up to match A's risk
    const rows = [
      { name: "Stock A alone", ret: eA, vol: sA, color: C.long },
      { name: "A + short B", ret: eH, vol: sH, color: C.short },
      { name: "A + short B, scaled to 30% risk", short: "Scaled up", ret: eH * k, vol: sA, color: C.alpha },
    ];
    rows.forEach((r) => (r.sh = r.ret / r.vol));
    const st = { n: 1 };
    const frame = A.frame(p.chart, { t: 34, r: 10, b: 10, l: 10 });
    const btn = A.buttons(p.ctl, "Show", [{ label: "A alone", n: 1 }, { label: "+ short B", n: 2 }, { label: "Scaled up", n: 3 }], (it) => { st.n = it.n; btn.setOn(it.n - 1); render(); });
    const metrics = [
      { key: "ret", label: "Expected return over cash", short: "Return", fmt: (v) => v.toFixed(1) + "%", max: 9 },
      { key: "vol", label: "Volatility (risk)", short: "Risk", fmt: (v) => v.toFixed(1) + "%", max: 32 },
      { key: "sh", label: "Return per unit of risk", short: "Return ÷ risk", fmt: (v) => v.toFixed(2), max: 0.3 },
    ];
    function render() {
      const { g, w, h: H } = frame();
      const colW = w / 3, gap = 18;
      legend(g, rows.slice(0, st.n).map((r) => ({ label: r.short || r.name, color: r.color })), 0, -16);
      metrics.forEach((m, i) => {
        const gx = g.append("g").attr("transform", `translate(${i * colW + gap / 2},0)`);
        const cw = colW - gap;
        gx.append("text").attr("class", "lbl").attr("x", 0).attr("y", 10).text(cw < 170 ? m.short : m.label);
        const y = d3.scaleLinear().domain([0, m.max]).range([H, 40]);
        const x = d3.scaleBand().domain([0, 1, 2]).range([0, cw]).padding(0.25);
        gx.append("line").attr("class", "zero").attr("x1", 0).attr("x2", cw).attr("y1", H).attr("y2", H);
        rows.forEach((r, j) => {
          if (j >= st.n) return;
          const v = r[m.key];
          gx.append("path").attr("d", topRounded(x(j), y(v), x.bandwidth(), H - y(v), 4)).style("fill", r.color);
          gx.append("text").attr("class", "lbl halo").attr("x", x(j) + x.bandwidth() / 2).attr("y", y(v) - 6).attr("text-anchor", "middle").text(m.fmt(v));
        });
      });
    }
    A.register("w-hook", { render, step(i) { st.n = Math.min(3, i + 1); btn.setOn(st.n - 1); render(); } });
    btn.setOn(0); render();
  })();

  // Bar path with 4px rounded data-end, anchored square at the baseline
  function topRounded(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  // Horizontal or vertical bar from a zero baseline in either direction, rounded at the data end
  function vbar(x, w, y0, y1, r = 4) {
    const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
    if (h < 0.5) return "";
    r = Math.min(r, w / 2, h);
    if (y1 < y0) return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }
  function hbar(y, h, x0, x1, r = 4) {
    const w = Math.abs(x1 - x0);
    if (w < 0.5) return "";
    r = Math.min(r, h / 2, w);
    if (x1 > x0) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
    return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
  }

  /* =========================================================
     1. CORRELATION: two-asset curve
     ========================================================= */
  (function () {
    const p = parts("w-corr");
    const mA = 10, sA = 20, mB = 5, sB = 10;
    const st = { rho: 1, w: 0.5, mode: "curve", reveal: 1 };
    // Illustrative long-run correlations to US large-cap equities
    const CORR = [
      { g: 1, name: "Technology sector", v: 0.9, c: C.market },
      { g: 1, name: "Microsoft (single stock)", v: 0.8, c: C.market },
      { g: 1, name: "Utilities sector", v: 0.5, c: C.market },
      { g: 1, name: "Investment-grade bonds", v: 0.2, c: C.bonds },
      { g: 2, name: "Commodities", v: 0.3, c: C.alpha },
      { g: 2, name: "Equity market neutral", v: 0.1, c: C.alpha },
      { g: 2, name: "Managed futures", v: 0.0, c: C.alpha },
      { g: 3, name: "Short Microsoft", v: -0.8, c: C.short },
    ];
    const vol = (w, r) => Math.sqrt(w * w * sA * sA + (1 - w) ** 2 * sB * sB + 2 * w * (1 - w) * r * sA * sB);
    const ret = (w) => w * mA + (1 - w) * mB;
    const frame = A.frame(p.chart, { t: 44, r: 24, b: 44, l: 48 });
    const tl = A.tiles(p.ro, [
      { key: "rho", label: "Correlation" }, { key: "vol", label: "Mix volatility" },
      { key: "avg", label: "Weighted avg vol" }, { key: "save", label: "Risk removed" },
    ]);
    const sl = [
      A.slider(p.ctl, { key: "rho", label: "Correlation ρ", min: -1, max: 1, step: 0.05, fmt: (v) => A.num(v) }, st, () => render()),
      A.slider(p.ctl, { key: "w", label: "Weight in A", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" }, st, () => render()),
    ];
    function renderBars() {
      const { g, w, h } = frame();
      $("corr-title").textContent = "Correlation to US large-cap equities";
      $("corr-src").textContent = "Illustrative long-run values; actual correlations vary by period";
      const rows = CORR.filter((d) => d.g <= st.reveal);
      const x = d3.scaleLinear().domain([-1, 1]).range([0, w]);
      const y = d3.scaleBand().domain(CORR.map((d) => d.name)).range([0, h]).padding(0.3);
      g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(8).tickSize(-h).tickFormat(""));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(8).tickFormat((v) => A.num(v, 2)));
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      legend(g, [{ label: "Equities", color: C.market }, { label: "Bonds", color: C.bonds }, { label: "Alternatives", color: C.alpha }, { label: "Short position", color: C.short }], 0, -26);
      rows.forEach((d) => {
        const bar = g.append("path").attr("d", hbar(y(d.name), y.bandwidth(), x(0), x(d.v === 0 ? 0.01 : d.v), 4)).style("fill", d.c);
        A.hover(bar, () => `<b>${d.name}</b><br>Correlation ${A.num(d.v)}`);
        const neg = d.v < 0;
        g.append("text").attr("class", "lbl halo").attr("x", neg ? x(0) + 8 : x(0) - 8).attr("y", y(d.name) + y.bandwidth() / 2 + 4).attr("text-anchor", neg ? "start" : "end").text(d.name);
        g.append("text").attr("class", "lbl-2 halo").attr("x", x(d.v) + (neg ? -6 : 6)).attr("y", y(d.name) + y.bandwidth() / 2 + 4).attr("text-anchor", neg ? "end" : "start").text(A.num(d.v));
      });
    }
    function render() {
      show(p.ro, st.mode === "curve"); show(p.ctl, st.mode === "curve");
      if (st.mode === "bars") return renderBars();
      $("corr-title").textContent = "Every mix of two assets, risk vs. return";
      $("corr-src").textContent = "Illustrative: A 10% / 20% vol, B 5% / 10% vol";
      const { g, w, h } = frame();
      const x = d3.scaleLinear().domain([0, 22]).range([0, w]);
      const y = d3.scaleLinear().domain([4, 11]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Volatility (risk), %", yl: "Expected return, %", xgrid: true });
      legend(g, [{ label: "All mixes at current ρ", color: C.market }, { label: "No diversification (ρ = 1)", color: C.ink3, dash: true }], 0, -26);
      const ws = d3.range(0, 1.0001, 0.01);
      const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
      g.append("path").attr("d", line(ws.map((v) => [vol(v, 1), ret(v)]))).style("fill", "none").style("stroke", C.ink3).style("stroke-width", 2).style("stroke-dasharray", "5 4");
      g.append("path").attr("d", line(ws.map((v) => [vol(v, st.rho), ret(v)]))).style("fill", "none").style("stroke", C.market).style("stroke-width", 3);
      [[sA, mA, "Asset A"], [sB, mB, "Asset B"]].forEach(([vx, vy, n]) => {
        g.append("circle").attr("cx", x(vx)).attr("cy", y(vy)).attr("r", 6).style("fill", C.ink).style("stroke", C.surface).style("stroke-width", 2);
        g.append("text").attr("class", "lbl halo").attr("x", x(vx) + 10).attr("y", y(vy) + 4).text(n);
      });
      const cv = vol(st.w, st.rho), cr = ret(st.w);
      g.append("line").attr("x1", x(st.w * sA + (1 - st.w) * sB)).attr("x2", x(cv)).attr("y1", y(cr)).attr("y2", y(cr)).style("stroke", C.alpha).style("stroke-width", 2);
      g.append("circle").attr("cx", x(cv)).attr("cy", y(cr)).attr("r", 8).style("fill", C.market).style("stroke", C.surface).style("stroke-width", 2);
      const left = x(cv) > 90;
      g.append("text").attr("class", "lbl halo").attr("x", x(cv) + (left ? -12 : 12)).attr("y", y(cr) - 12).attr("text-anchor", left ? "end" : "start").text(`${Math.round(st.w * 100)}/${Math.round(100 - st.w * 100)} mix`);
      const avg = st.w * sA + (1 - st.w) * sB;
      tl.rho.v.textContent = A.num(st.rho); tl.vol.v.textContent = A.pct(cv); tl.avg.v.textContent = A.pct(avg);
      tl.save.v.textContent = A.pct(avg - cv); tl.save.v.style.color = avg - cv > 0.05 ? "var(--alpha)" : "";
      sl.forEach((s) => s.sync());
    }
    // Steps: ρ = 1, 0.3, 0, then correlations in practice (3 reveals), then ρ = −1
    A.register("w-corr", {
      render,
      step(i) {
        if (i >= 3 && i <= 5) { if (st._timer) st._timer.stop(); st.mode = "bars"; st.reveal = i - 2; render(); return; }
        st.mode = "curve";
        const rho = [1, 0.3, 0, null, null, null, -1][i];
        A.tween(st, { rho, w: i === 6 ? 0.35 : 0.5 }, render);
      },
    });
    render();
  })();

  /* =========================================================
     2. FREE LUNCH: volatility vs number of stocks
     ========================================================= */
  (function () {
    const p = parts("w-lunch");
    const sm = 16, se = 32, NMAX = 100;
    const st = { n: 1 };
    const vol = (n) => Math.sqrt(sm * sm + se * se / n);
    const frame = A.frame(p.chart, { t: 26, r: 24, b: 44, l: 48 });
    const tl = A.tiles(p.ro, [
      { key: "n", label: "Stocks held" }, { key: "vol", label: "Portfolio volatility" },
      { key: "sys", label: "Systematic share of risk", sub: "of total variance" },
    ]);
    const sl = A.slider(p.ctl, { key: "n", label: "Number of stocks", min: 1, max: NMAX, step: 1, fmt: (v) => Math.round(v) }, st, () => render());
    A.buttons(p.ctl, "", [{ label: "+1 stock" }, { label: "Reset" }], (it) => { st.n = it.label === "Reset" ? 1 : Math.min(NMAX, Math.round(st.n) + 1); render(); });
    function render() {
      const { g, w, h } = frame();
      const x = d3.scaleLinear().domain([1, NMAX]).range([0, w]);
      const y = d3.scaleLinear().domain([0, 40]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Number of stocks (equal weight)", yl: "Volatility, %" });
      const ns = d3.range(1, NMAX + 0.01, 0.5);
      g.append("rect").attr("x", 0).attr("y", y(sm)).attr("width", w).attr("height", h - y(sm)).style("fill", C.market).style("opacity", 0.16);
      g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(sm)).attr("y2", y(sm)).style("stroke", C.market).style("stroke-width", 2);
      g.append("path").attr("d", d3.area().x((n) => x(n)).y0(y(sm)).y1((n) => y(vol(n)))(ns)).style("fill", C.idio).style("opacity", 0.16);
      g.append("path").attr("d", d3.line().x((n) => x(n)).y((n) => y(vol(n)))(ns)).style("fill", "none").style("stroke", C.ink).style("stroke-width", 2);
      g.append("text").attr("class", "lbl halo").attr("x", w - 6).attr("y", y(sm) + 22).attr("text-anchor", "end").style("fill", C.market).text("Systematic risk: can't diversify away");
      g.append("text").attr("class", "lbl halo").attr("x", x(14)).attr("y", y(vol(14)) - 14).style("fill", C.idio).text("Idiosyncratic risk: diversifies away");
      const n = Math.round(st.n);
      g.append("line").attr("x1", x(n)).attr("x2", x(n)).attr("y1", y(vol(n))).attr("y2", h).style("stroke", C.ink3).style("stroke-dasharray", "3 3");
      g.append("circle").attr("cx", x(n)).attr("cy", y(vol(n))).attr("r", 8).style("fill", C.ink).style("stroke", C.surface).style("stroke-width", 2);
      g.append("text").attr("class", "lbl halo").attr("x", x(n) + 12).attr("y", y(vol(n)) - 10).text(A.pct(vol(n)));
      tl.n.v.textContent = n; tl.vol.v.textContent = A.pct(vol(n));
      tl.sys.v.textContent = Math.round(100 * sm * sm / vol(n) ** 2) + "%";
      sl.sync();
    }
    const presets = [1, 10, 30, 100];
    A.register("w-lunch", { render, step(i) { A.tween(st, { n: presets[Math.min(i, 3)] }, render, 900); } });
    render();
  })();

  /* =========================================================
     3. EFFICIENT FRONTIER
     ========================================================= */
  (function () {
    const p = parts("w-frontier");
    const sm = 16;
    const S = [
      ["Tech", 12, 1.25, 22], ["Health care", 9, 0.85, 16], ["Financials", 9.5, 1.15, 18], ["Energy", 8.5, 1.05, 26],
      ["Staples", 7, 0.6, 12], ["Utilities", 6.5, 0.45, 14], ["Industrials", 9, 1.1, 15], ["Real estate", 7.5, 0.9, 20],
    ].map(([name, mu, beta, se]) => ({ name, mu, beta, se, vol: Math.sqrt(beta * beta * sm * sm + se * se) }));
    const n = S.length;
    const cov = S.map((a, i) => S.map((b, j) => a.beta * b.beta * sm * sm + (i === j ? a.se * a.se : 0)));
    const stats = (w) => {
      let mu = 0, v = 0;
      for (let i = 0; i < n; i++) { mu += w[i] * S[i].mu; for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j]; }
      return { mu, vol: Math.sqrt(v), w };
    };
    // Random long-only portfolios
    const r = A.rng(7);
    const cloud = d3.range(3000).map(() => {
      const k = 1 + r() * 4;
      const raw = S.map(() => Math.pow(-Math.log(r()), k));
      const s = d3.sum(raw); return stats(raw.map((x) => x / s));
    });
    // Long-only frontier by projected gradient on the simplex, sweeping risk aversion
    function projSimplex(v) {
      const u = [...v].sort((a, b) => b - a); let css = 0, th = 0;
      for (let i = 0; i < u.length; i++) { css += u[i]; const t = (css - 1) / (i + 1); if (u[i] - t > 0) th = t; }
      return v.map((x) => Math.max(0, x - th));
    }
    const trace = d3.sum(cov.map((row, i) => row[i]));
    const frontier = d3.range(-3, 1.2, 0.05).map((e) => {
      const lam = Math.pow(10, e); let w = S.map(() => 1 / n);
      const eta = 1 / (lam * trace);
      for (let it = 0; it < 1500; it++) {
        const g = S.map((s, i) => s.mu - lam * d3.sum(cov[i].map((c, j) => c * w[j])));
        w = projSimplex(w.map((x, i) => x + eta * g[i]));
      }
      return stats(w);
    }).sort((a, b) => a.vol - b.vol);
    const minVar = frontier[0];
    const eff = frontier.filter((f) => f.mu >= minVar.mu - 1e-9);

    // Frontier lookups: best return at a given risk, lowest risk at a given return
    function interpY(v) {
      for (let i = 1; i < eff.length; i++) if (eff[i].vol >= v) { const a = eff[i - 1], b = eff[i]; return a.mu + (b.mu - a.mu) * (v - a.vol) / (b.vol - a.vol); }
      return eff[eff.length - 1].mu;
    }
    function interpX(m) {
      for (let i = 1; i < eff.length; i++) if (eff[i].mu >= m) { const a = eff[i - 1], b = eff[i]; return a.vol + (b.vol - a.vol) * (m - a.mu) / (b.mu - a.mu); }
      return eff[eff.length - 1].vol;
    }
    const st = { stage: 0, rf: 3 };
    const frame = A.frame(p.chart, { t: 26, r: 24, b: 44, l: 48 });
    const tl = A.tiles(p.ro, [{ key: "mu", label: "Tangency return" }, { key: "vol", label: "Tangency risk" }, { key: "sh", label: "Sharpe ratio" }, { key: "top", label: "Biggest weights" }]);
    const sl = A.slider(p.ctl, { key: "rf", label: "Risk-free (cash) rate", min: 0, max: 6, step: 0.25, fmt: (v) => v.toFixed(2) + "%" }, st, () => render());
    function tangency() { let best = eff[0], bs = -Infinity; eff.forEach((f) => { const s = (f.mu - st.rf) / f.vol; if (s > bs) { bs = s; best = f; } }); return best; }
    function render() {
      const { g, w, h } = frame();
      const x = d3.scaleLinear().domain([0, 32]).range([0, w]);
      const y = d3.scaleLinear().domain([0, 14]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Volatility (risk), %", yl: "Expected return, %", xgrid: true });
      if (st.stage >= 1) {
        g.append("g").selectAll("circle").data(cloud).join("circle")
          .attr("cx", (d) => x(d.vol)).attr("cy", (d) => y(d.mu)).attr("r", 1.8).style("fill", C.ink3).style("opacity", 0.35);
      }
      const tg = tangency();
      if (st.stage === 1) {
        // Real estate vs. the best portfolio at the same risk, and at the same return
        const re = S.find((d) => d.name === "Real estate");
        const upMu = interpY(re.vol), leftVol = interpX(re.mu);
        A.reDebug = { upMu, leftVol };
        const arrow = (x1, y1, x2, y2) => g.append("line").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
          .style("stroke", C.alpha).style("stroke-width", 2.5).attr("marker-end", "url(#arrowhead)");
        g.append("defs").append("marker").attr("id", "arrowhead").attr("viewBox", "0 0 10 10").attr("refX", 8).attr("refY", 5)
          .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto-start-reverse")
          .append("path").attr("d", "M0,0L10,5L0,10z").style("fill", C.alpha);
        arrow(x(re.vol), y(re.mu) - 9, x(re.vol), y(upMu) + 4);
        arrow(x(re.vol) - 9, y(re.mu), x(leftVol) + 4, y(re.mu));
        g.append("text").attr("class", "lbl halo").attr("x", x(re.vol) + 8).attr("y", y(upMu) - 8).text(`Same risk: ${A.pct(upMu)} return`);
        g.append("text").attr("class", "lbl halo").attr("x", x(leftVol)).attr("y", y(re.mu) + 22).attr("text-anchor", "middle").text(`Same return: ${A.pct(leftVol)} risk`);
      }
      if (st.stage >= 2) {
        g.append("path").attr("d", d3.line().x((d) => x(d.vol)).y((d) => y(d.mu)).curve(d3.curveMonotoneX)(eff)).style("fill", "none").style("stroke", C.market).style("stroke-width", 3);
        const last = eff[Math.floor(eff.length * 0.55)];
        g.append("text").attr("class", "lbl halo").attr("x", x(last.vol) - 8).attr("y", y(last.mu) - 10).attr("text-anchor", "end").style("fill", C.market).text("Efficient frontier");
      }
      if (st.stage >= 3) {
        const slope = (tg.mu - st.rf) / tg.vol, xe = 32;
        g.append("line").attr("x1", x(0)).attr("y1", y(st.rf)).attr("x2", x(xe)).attr("y2", y(st.rf + slope * xe)).style("stroke", C.alpha).style("stroke-width", 2.5);
        g.append("circle").attr("cx", x(0)).attr("cy", y(st.rf)).attr("r", 6).style("fill", C.alpha);
        g.append("text").attr("class", "lbl halo").attr("x", x(0) + 10).attr("y", y(st.rf) + 16).text("Cash");
        g.append("text").attr("class", "lbl halo").attr("x", x(25)).attr("y", y(st.rf + slope * 25) - 10).attr("text-anchor", "middle").text("Capital market line");
        if (st.stage >= 4) {
          [[0.5, "50% cash"], [1.5, "Borrow 50%"]].forEach(([k, lb]) => {
            const px = x(k * tg.vol), py = y(st.rf + k * (tg.mu - st.rf));
            g.append("circle").attr("cx", px).attr("cy", py).attr("r", 6).style("fill", C.surface).style("stroke", C.alpha).style("stroke-width", 2.5);
            g.append("text").attr("class", "lbl-2 halo").attr("x", px + 4).attr("y", py + 20).text(lb);
          });
        }
        g.append("circle").attr("cx", x(tg.vol)).attr("cy", y(tg.mu)).attr("r", 9).style("fill", C.market).style("stroke", C.surface).style("stroke-width", 2.5);
        g.append("text").attr("class", "lbl halo").attr("x", x(tg.vol) - 12).attr("y", y(tg.mu) - 12).attr("text-anchor", "end").text("Tangency (market) portfolio");
        tl.mu.v.textContent = A.pct(tg.mu); tl.vol.v.textContent = A.pct(tg.vol); tl.sh.v.textContent = A.num((tg.mu - st.rf) / tg.vol);
        const top = S.map((s, i) => [s.name, tg.w[i]]).sort((a, b) => b[1] - a[1]).slice(0, 2);
        tl.top.v.textContent = top.map((t) => Math.round(t[1] * 100) + "%").join(" · ");
        tl.top.d.textContent = top.map((t) => t[0]).join(", ");
      } else {
        ["mu", "vol", "sh", "top"].forEach((k) => { tl[k].v.textContent = "–"; tl[k].d.textContent = ""; });
      }
      const dots = g.append("g").selectAll("g").data(S).join("g").attr("transform", (d) => `translate(${x(d.vol)},${y(d.mu)})`);
      dots.append("circle").attr("r", 7).style("fill", C.ink).style("stroke", C.surface).style("stroke-width", 2);
      dots.append("text").attr("class", "lbl-2 halo").attr("x", (d) => (d.name === "Health care" ? -10 : 10)).attr("y", 4)
        .attr("text-anchor", (d) => (d.name === "Health care" ? "end" : "start")).text((d) => d.name);
      A.hover(dots, (d) => `<b>${d.name}</b><br>Expected return ${A.pct(d.mu)}<br>Volatility ${A.pct(d.vol)}<br>Beta ${d.beta.toFixed(2)}`);
      sl.sync();
      show(p.ctl, st.stage >= 3); show(p.ro, st.stage >= 3);
    }
    A.register("w-frontier", { render, step(i) { st.stage = i; if (i < 4) st.rf = 3; render(); } });
    render();
  })();

  /* =========================================================
     4. ALPHA vs BETA regression
     ========================================================= */
  (function () {
    const p = parts("w-alpha");
    const st = { beta: 1, alpha: 0, idio: 1 };
    const presets = [{ beta: 1, alpha: 0, idio: 1 }, { beta: 0.95, alpha: 0.5, idio: 4 }, { beta: 1.5, alpha: 0, idio: 3 }, { beta: 0.05, alpha: 5, idio: 7 }];
    const names = ["Index fund", "Closet indexer", "Leveraged beta", "Market neutral"];
    const frame = A.frame(p.chart, { t: 26, r: 24, b: 44, l: 48 });
    const tl = A.tiles(p.ro, [
      { key: "ret", label: "Excess return / yr" }, { key: "vol", label: "Volatility" }, { key: "sh", label: "Sharpe" },
      { key: "tr", label: "Treynor" }, { key: "a", label: "Jensen's alpha" }, { key: "ir", label: "Info ratio" },
    ]);
    const sls = [
      A.slider(p.ctl, { key: "beta", label: "Beta", min: 0, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2) }, st, () => { btn.setOn(-1); render(); }),
      A.slider(p.ctl, { key: "alpha", label: "Alpha / yr", min: -3, max: 8, step: 0.5, fmt: (v) => A.spct(v) }, st, () => { btn.setOn(-1); render(); }),
      A.slider(p.ctl, { key: "idio", label: "Stock-specific noise / yr", min: 0, max: 15, step: 0.5, fmt: (v) => v.toFixed(1) + "%" }, st, () => { btn.setOn(-1); render(); }),
    ];
    const btn = A.buttons(p.ctl, "Preset", names.map((n, i) => ({ label: n, i })), (it) => { btn.setOn(it.i); A.tween(st, presets[it.i], render); });
    function render() {
      const { g, w, h } = frame();
      const fund = MKT.map((m, t) => st.alpha / 12 + st.beta * m + st.idio / Math.sqrt(12) * Z[0][t]);
      const fit = A.ols(MKT, fund);
      const x = d3.scaleLinear().domain([-14, 14]).range([0, w]);
      const y = d3.scaleLinear().domain([-22, 22]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Market return that month, %", yl: "Fund return that month, %", xgrid: true });
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      g.append("line").attr("x1", x(-14)).attr("x2", x(14)).attr("y1", y(-14)).attr("y2", y(14)).style("stroke", C.ink3).style("stroke-dasharray", "5 4").style("stroke-width", 1.5);
      g.append("text").attr("class", "lbl-2 halo").attr("x", x(13)).attr("y", y(13) + 16).attr("text-anchor", "end").text("The market itself");
      g.append("g").selectAll("circle").data(MKT.map((m, i) => [m, fund[i]])).join("circle")
        .attr("cx", (d) => x(d[0])).attr("cy", (d) => y(d[1])).attr("r", 4.5).style("fill", C.market).style("opacity", 0.55).style("stroke", C.surface).style("stroke-width", 1);
      g.append("line").attr("x1", x(-14)).attr("x2", x(14)).attr("y1", y(fit.a - 14 * fit.b)).attr("y2", y(fit.a + 14 * fit.b)).style("stroke", C.ink).style("stroke-width", 2.5);
      g.append("circle").attr("cx", x(0)).attr("cy", y(fit.a)).attr("r", 7).style("fill", C.alpha).style("stroke", C.surface).style("stroke-width", 2);
      g.append("text").attr("class", "lbl halo").attr("x", x(0) + 12).attr("y", y(fit.a) + (fit.b > 0.5 ? 18 : -10)).text(`α = ${A.spct(fit.a * 12)} / yr`);
      g.append("text").attr("class", "lbl halo").attr("x", x(-12)).attr("y", y(fit.a - 12 * fit.b) + (fit.b > 0.3 ? -12 : 20)).style("fill", C.market).text(`β = ${fit.b.toFixed(2)}`);
      const ex = A.mean(fund) * 12, vol = A.sd(fund) * Math.sqrt(12), te = fit.residSd * Math.sqrt(12);
      tl.ret.v.textContent = A.pct(ex); tl.vol.v.textContent = A.pct(vol); tl.sh.v.textContent = A.num(ex / vol);
      tl.tr.v.textContent = Math.abs(fit.b) < 0.15 ? "n/a" : A.num(ex / fit.b, 1); tl.tr.d.textContent = Math.abs(fit.b) < 0.15 ? "beta ≈ 0" : "% per unit beta";
      tl.a.v.textContent = A.spct(fit.a * 12); tl.ir.v.textContent = te < 0.05 ? "n/a" : A.num(fit.a * 12 / te);
      sls.forEach((s) => s.sync());
    }
    A.register("w-alpha", { render, step(i) { btn.setOn(i); A.tween(st, presets[i], render); } });
    btn.setOn(0); render();
  })();

  /* =========================================================
     5. BRINSON ATTRIBUTION: area boxes per sector + waterfall,
        then combining managers with opposite style tilts
     ========================================================= */
  (function () {
    const p = parts("w-attr");
    const sec = ["Tech", "Health care", "Financials", "Energy", "Consumer"];
    const wb = [30, 15, 20, 10, 25], rb = [18, 6, 10, -4, 8];
    const Rb = d3.sum(wb.map((w, i) => w * rb[i])) / 100;
    const presets = [
      { wp: [40, 15, 20, 0, 25], rp: [...rb] },
      { wp: [...wb], rp: [21, 8, 11, -2, 9] },
      { wp: [40, 15, 20, 0, 25], rp: [21, 8, 11, -2, 9] },
    ];
    const st = { mode: "box", preset: 0, sector: 0 };
    const frame = A.frame(p.chart, { t: 0, r: 0, b: 0, l: 0 });
    const tl = A.tiles(p.ro, [
      { key: "alloc", label: "Allocation" }, { key: "sel", label: "Selection" },
      { key: "inter", label: "Interaction" }, { key: "tot", label: "Excess return" },
    ]);
    const presetBtn = A.buttons(p.ctl, "Manager", [{ label: "Allocator", i: 0 }, { label: "Stock picker", i: 1 }, { label: "Both", i: 2 }], (it) => { st.preset = it.i; presetBtn.setOn(it.i); render(); });
    const secBtn = A.buttons(p.ctl, "Sector", sec.map((s, i) => ({ label: s, i })), (it) => { st.sector = it.i; secBtn.setOn(it.i); render(); });

    function effects(pr) {
      const rows = sec.map((s, i) => {
        const dw = (pr.wp[i] - wb[i]) / 100;
        return { s, i, wb: wb[i], wp: pr.wp[i], rb: rb[i], rp: pr.rp[i],
          alloc: dw * (rb[i] - Rb), sel: (wb[i] / 100) * (pr.rp[i] - rb[i]), inter: dw * (pr.rp[i] - rb[i]) };
      });
      const tot = { alloc: d3.sum(rows, (r) => r.alloc), sel: d3.sum(rows, (r) => r.sel), inter: d3.sum(rows, (r) => r.inter) };
      return { rows, tot };
    }

    // Left panel: one sector's contribution drawn as rectangles.
    // Width = weight, height = sector return relative to the benchmark's total return,
    // so each area is that effect's contribution to excess return.
    function drawBox(g, w, h, r) {
      const hr = r.rb - Rb, pr = r.rp - Rb;
      const x = d3.scaleLinear().domain([0, 50]).range([0, w]);
      const lo = Math.min(0, hr, pr), hi = Math.max(0, hr, pr);
      const pad = Math.max(2, (hi - lo) * 0.25);
      const y = d3.scaleLinear().domain([lo - pad, hi + pad]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Weight in sector, %", yl: "Sector return minus benchmark total (" + A.pct(Rb) + "), %", xt: 5, yt: 5 });
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      const rect = (x0, x1, y0, y1, fill, op, label, val) => {
        const X = Math.min(x(x0), x(x1)), W = Math.abs(x(x1) - x(x0)), Y = Math.min(y(y0), y(y1)), H = Math.abs(y(y1) - y(y0));
        if (W < 0.5 || H < 0.5) return;
        const el = g.append("rect").attr("x", X).attr("y", Y).attr("width", W).attr("height", H).style("fill", fill).style("opacity", op).style("stroke", C.surface).style("stroke-width", 2);
        A.hover(el, () => `<b>${r.s}: ${label}</b><br>${A.spct(val, 2)} of excess return`);
        if (W > 46 && H > 30 && val !== null) {
          g.append("text").attr("class", "lbl").attr("x", X + W / 2).attr("y", Y + H / 2 - 2).attr("text-anchor", "middle").style("fill", op > 0.5 ? "#fff" : C.ink).text(label);
          g.append("text").attr("class", "lbl").attr("x", X + W / 2).attr("y", Y + H / 2 + 13).attr("text-anchor", "middle").style("fill", op > 0.5 ? "#fff" : C.ink).text(A.spct(val, 2));
        }
      };
      // Benchmark's own position in the sector (reference, not part of excess return)
      rect(0, r.wb, 0, hr, C.ink3, 0.18, "Benchmark", null);
      rect(r.wb, r.wp, 0, hr, C.market, 0.9, "Allocation", (r.wp - r.wb) / 100 * hr);
      rect(0, r.wb, hr, pr, C.alpha, 0.9, "Selection", r.wb / 100 * (r.rp - r.rb));
      rect(r.wb, r.wp, hr, pr, C.ink3, 0.75, "Interaction", (r.wp - r.wb) / 100 * (r.rp - r.rb));
      // Outlines: benchmark (dashed) and portfolio (solid)
      g.append("rect").attr("x", Math.min(x(0), x(r.wb))).attr("y", Math.min(y(0), y(hr))).attr("width", x(r.wb) - x(0)).attr("height", Math.abs(y(hr) - y(0)))
        .style("fill", "none").style("stroke", C.ink2).style("stroke-dasharray", "5 4").style("stroke-width", 1.5);
      g.append("rect").attr("x", x(0)).attr("y", Math.min(y(0), y(pr))).attr("width", x(r.wp) - x(0)).attr("height", Math.abs(y(pr) - y(0)))
        .style("fill", "none").style("stroke", C.ink).style("stroke-width", 2);
      // Weight markers
      [[r.wb, "Benchmark " + r.wb + "%"], [r.wp, "Portfolio " + r.wp + "%"]].forEach(([v, t], j) => {
        if (j === 1 && v === r.wb) return;
        g.append("text").attr("class", "lbl-2 halo").attr("x", x(v)).attr("y", y(lo - pad) - 6 - j * 14).attr("text-anchor", "middle").text(t);
      });
      g.append("text").attr("class", "lbl").attr("x", 0).attr("y", -26).text(`${r.s}: benchmark return ${A.pct(r.rb, 0)}, portfolio return ${A.pct(r.rp, 0)}`);
    }

    // Right panel: benchmark return → each effect → portfolio return
    function drawWaterfall(g, w, h, tot) {
      const steps = [
        { k: "Benchmark", base: 0, v: Rb, c: C.ink3, abs: true },
        { k: "Allocation", v: tot.alloc, c: C.market },
        { k: "Selection", v: tot.sel, c: C.alpha },
        { k: "Interaction", v: tot.inter, c: C.ink3 },
        { k: "Portfolio", base: 0, v: Rb + tot.alloc + tot.sel + tot.inter, c: C.ink, abs: true },
      ];
      let run = 0;
      steps.forEach((s) => { if (s.abs) { s.y0 = 0; s.y1 = s.v; run = s.v; } else { s.y0 = run; s.y1 = run + s.v; run = s.y1; } });
      const x = d3.scaleBand().domain(steps.map((s) => s.k)).range([0, w]).padding(0.25);
      const y = d3.scaleLinear().domain([0, Math.max(16, d3.max(steps, (s) => s.y1) + 2)]).range([h, 0]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat((v) => v + "%"));
      const short = { Benchmark: "Bench.", Allocation: "Alloc.", Selection: "Select.", Interaction: "Inter.", Portfolio: "Portf." };
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).tickSize(0).tickFormat((k) => (x.bandwidth() < 62 ? short[k] : k))).selectAll("text").attr("dy", "1.2em");
      g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -8).text("Portfolio return, built up from the benchmark");
      steps.forEach((s, i) => {
        const top = y(Math.max(s.y0, s.y1)), bot = y(Math.min(s.y0, s.y1));
        if (bot - top > 0.5) g.append("rect").attr("x", x(s.k)).attr("width", x.bandwidth()).attr("y", top).attr("height", bot - top).attr("rx", 3).style("fill", s.c);
        g.append("text").attr("class", "lbl halo").attr("x", x(s.k) + x.bandwidth() / 2).attr("y", top - 6).attr("text-anchor", "middle")
          .text(s.abs ? A.pct(s.v) : A.spct(s.v, 2));
        if (i < steps.length - 1) g.append("line").attr("x1", x(s.k) + x.bandwidth()).attr("x2", x(steps[i + 1].k)).attr("y1", y(s.y1)).attr("y2", y(s.y1)).style("stroke", C.ink3).style("stroke-dasharray", "3 3");
      });
    }

    // Managers mode: opposite style tilts cancel, selection alpha adds up
    function drawManagers(g, W, H) {
      const mgr = [
        { k: "Growth manager", tilt: 0.6, sel: 2.0 },
        { k: "Value manager", tilt: -0.6, sel: 1.5 },
        { k: "Combined (50/50)", tilt: 0, sel: 1.75 },
      ];
      const narrow = W < 620, gap = 40;
      const pw = narrow ? W : (W - gap) / 2, ph = narrow ? (H - gap) / 2 : H;
      [["Style tilt (growth + / value −)", "tilt", [-1, 1], C.idio, (v) => A.num(v, 1)], ["Selection alpha, % per year", "sel", [0, 2.5], C.alpha, (v) => A.spct(v, 2)]].forEach(([title, key, dom, col, fmt], j) => {
        const gx = g.append("g").attr("transform", narrow ? `translate(0,${j * (ph + gap)})` : `translate(${j * (pw + gap)},0)`);
        const m = { l: 116, r: 40, t: 34, b: 30 }, w = pw - m.l - m.r, h = ph - m.t - m.b;
        const gi = gx.append("g").attr("transform", `translate(${m.l},${m.t})`);
        gi.append("text").attr("class", "lbl").attr("x", -m.l).attr("y", -16).text(title);
        const x = d3.scaleLinear().domain(dom).range([0, w]);
        const y = d3.scaleBand().domain(mgr.map((d) => d.k)).range([0, h]).padding(0.35);
        gi.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
        gi.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4));
        gi.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
        mgr.forEach((d) => {
          gi.append("text").attr("class", d.k.startsWith("Combined") ? "lbl" : "lbl-2").attr("x", -10).attr("y", y(d.k) + y.bandwidth() / 2 + 4).attr("text-anchor", "end").text(d.k);
          gi.append("path").attr("d", hbar(y(d.k), y.bandwidth(), x(0), x(d[key]), 4)).style("fill", col).style("opacity", d.k.startsWith("Combined") ? 1 : 0.7);
          gi.append("text").attr("class", "lbl halo").attr("x", x(d[key]) + (d[key] < 0 ? -6 : 6)).attr("y", y(d.k) + y.bandwidth() / 2 + 4).attr("text-anchor", d[key] < 0 ? "end" : "start").text(fmt(d[key]));
        });
      });
    }

    function render() {
      const { g, W, H } = frame();
      const isBox = st.mode === "box";
      show(p.ctl, isBox); show(p.ro, isBox);
      $("attr-title").textContent = isBox ? "Allocation and selection, drawn as areas" : "Combining managers with opposite style tilts";
      $("attr-src").textContent = isBox ? "Illustrative one-year example · Brinson-Fachler" : "Illustrative";
      if (!isBox) return drawManagers(g, W, H);
      const { rows, tot } = effects(presets[st.preset]);
      const narrow = W < 620, gap = 56;
      const bw = narrow ? W : W * 0.58, bh = narrow ? H * 0.55 : H;
      const m = { l: 52, r: 12, t: 46, b: 44 };
      drawBox(g.append("g").attr("transform", `translate(${m.l},${m.t})`), bw - m.l - m.r, bh - m.t - m.b, rows[st.sector]);
      const wx = narrow ? m.l : bw + gap - 12, wy = narrow ? bh + 26 : m.t + 12;
      drawWaterfall(g.append("g").attr("transform", `translate(${wx},${wy})`), (narrow ? W : W - bw - gap + 12) - (narrow ? m.l + 12 : 12), (narrow ? H - bh - 26 : H - m.t - 12) - 40, tot);
      tl.alloc.v.textContent = A.spct(tot.alloc, 2); tl.sel.v.textContent = A.spct(tot.sel, 2);
      tl.inter.v.textContent = A.spct(tot.inter, 2); tl.tot.v.textContent = A.spct(tot.alloc + tot.sel + tot.inter, 2);
      [["alloc", "var(--market)"], ["sel", "var(--alpha)"]].forEach(([k, c]) => (tl[k].v.style.color = Math.abs(tot[k]) > 0.005 ? c : ""));
    }
    A.register("w-attr", {
      render,
      step(i) {
        if (i <= 2) { st.mode = "box"; st.preset = i; presetBtn.setOn(i); }
        else st.mode = "managers";
        render();
      },
    });
    presetBtn.setOn(0); secBtn.setOn(0); render();
  })();

  /* =========================================================
     6. THE 60/40 PROBLEM (real annual data)
     ========================================================= */
  (function () {
    const p = parts("w-problem");
    // Calendar-year total returns, %: S&P 500 and Bloomberg US Aggregate Bond Index
    const years = d3.range(2000, 2025);
    const spx = [-9.1, -11.9, -22.1, 28.7, 10.9, 4.9, 15.8, 5.5, -37.0, 26.5, 15.1, 2.1, 16.0, 32.4, 13.7, 1.4, 12.0, 21.8, -4.4, 31.5, 18.4, 28.7, -18.1, 26.3, 25.0];
    const agg = [11.6, 8.4, 10.3, 4.1, 4.3, 2.4, 4.3, 7.0, 5.2, 5.9, 6.5, 7.8, 4.2, -2.0, 6.0, 0.5, 2.6, 3.5, 0.0, 8.7, 7.5, -1.5, -13.0, 5.5, 1.3];
    const st = { stage: 0 };
    const frame = A.frame(p.chart, { t: 30, r: 16, b: 40, l: 48 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }]);
    const setTile = (t, k, v, d) => { t.el.querySelector(".k").textContent = k; t.v.textContent = v; t.d.textContent = d || ""; };
    function render() {
      const { g, w, h } = frame();
      if (st.stage === 0) {
        $("problem-title").textContent = "Share of a 60/40 portfolio";
        $("problem-src").textContent = "Assumes 16% stock vol, 6% bond vol, zero correlation";
        const vs = 0.36 * 256, vb = 0.16 * 36, riskS = vs / (vs + vb);
        const rows = [["Dollars", 0.6], ["Risk", riskS]];
        const y = d3.scaleBand().domain(rows.map((r) => r[0])).range([h * 0.15, h * 0.85]).padding(0.35);
        const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
        legend(g, [{ label: "Stocks", color: C.market }, { label: "Bonds", color: C.bonds }], 0, -12);
        rows.forEach(([name, s]) => {
          const yy = y(name), bh = y.bandwidth();
          g.append("path").attr("d", hbar(yy, bh, x(0), x(s) - 1, 4)).style("fill", C.market);
          g.append("path").attr("d", hbar(yy, bh, x(1), x(s) + 1, 4)).style("fill", C.bonds);
          g.append("text").attr("class", "lbl").attr("x", 0).attr("y", yy - 8).text(name);
          g.append("text").attr("class", "lbl").attr("x", 12).attr("y", yy + bh / 2 + 5).style("fill", "#fff").style("font-size", "16px").text(Math.round(s * 100) + "% stocks");
          if (1 - s > 0.15) g.append("text").attr("class", "lbl").attr("x", w - 12).attr("y", yy + bh / 2 + 5).attr("text-anchor", "end").style("fill", "#fff").style("font-size", "16px").text(Math.round((1 - s) * 100) + "% bonds");
          else g.append("text").attr("class", "lbl-2").attr("x", w).attr("y", yy + bh + 16).attr("text-anchor", "end").text(Math.round((1 - s) * 100) + "% bonds");
        });
        setTile(tl.a, "Stocks: share of dollars", "60%"); setTile(tl.b, "Stocks: share of risk", Math.round(riskS * 100) + "%", "of portfolio variance");
        setTile(tl.c, "60/40 volatility", A.pct(Math.sqrt(vs + vb)));
        return;
      }
      $("problem-title").textContent = "Calendar-year total returns, 2000–2024";
      $("problem-src").textContent = "S&P 500 and Bloomberg US Aggregate total returns";
      const hy = st.stage === 1 ? 2008 : 2022;
      const x0 = d3.scaleBand().domain(years).range([0, w]).paddingInner(0.2);
      const x1 = d3.scaleBand().domain([0, 1]).range([0, x0.bandwidth()]).padding(0.05);
      const y = d3.scaleLinear().domain([-40, 35]).range([h, 0]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x0).tickValues(years.filter((yr) => yr % 4 === 0 || yr === hy)).tickFormat(d3.format("d")));
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      legend(g, [{ label: "S&P 500", color: C.market }, { label: "US bonds (Agg)", color: C.bonds }], 0, -12);
      years.forEach((yr, i) => {
        [[spx[i], C.market, "S&P 500"], [agg[i], C.bonds, "US bonds"]].forEach(([v, col, nm], j) => {
          const b = g.append("path").attr("d", vbar(x0(yr) + x1(j), x1.bandwidth(), y(0), y(v), 2)).style("fill", col).style("opacity", yr === hy ? 1 : 0.28);
          A.hover(b, () => `<b>${yr}</b><br>${nm}: ${A.spct(v)}<br>60/40: ${A.spct(0.6 * spx[i] + 0.4 * agg[i])}`);
        });
      });
      const i = years.indexOf(hy);
      const lx = x0(hy) + x0.bandwidth() / 2;
      g.append("text").attr("class", "lbl halo").attr("x", lx).attr("y", y(Math.max(spx[i], agg[i], 0)) - 10).attr("text-anchor", "middle").text(hy === 2008 ? "2008: bonds cushioned" : "2022: both fell");
      setTile(tl.a, `${hy} S&P 500`, A.spct(spx[i])); setTile(tl.b, `${hy} US bonds`, A.spct(agg[i]));
      setTile(tl.c, `${hy} 60/40`, A.spct(0.6 * spx[i] + 0.4 * agg[i]), "annual rebalance assumed");
    }
    A.register("w-problem", { render, step(i) { st.stage = i; render(); } });
    render();
  })();

  /* =========================================================
     7. SHORTING FLIPS CORRELATION, then a hedged pair
     ========================================================= */
  (function () {
    const p = parts("w-short");
    const stock = MKT.map((m, t) => 1.2 * m + 6 * Z[1][t]);
    const A_ = MKT.map((m, t) => 1.3 * m + 3 / 12 + 5 * Z[2][t]);
    const B_ = MKT.map((m, t) => 1.0 * m - 2 / 12 + 5 * Z[3][t]);
    const st = { mode: "flip", t: 0, h: 0, hl: false };
    const frame = A.frame(p.chart, { t: 26, r: 24, b: 44, l: 48 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const setTile = (t, k, v, d) => { t.el.querySelector(".k").textContent = k; t.v.textContent = v; t.d.textContent = d || ""; };
    const flipCtl = document.createElement("div"); const pairCtl = document.createElement("div");
    pairCtl.style.width = "100%"; p.ctl.append(flipCtl, pairCtl);
    const btn = A.buttons(flipCtl, "Position", [{ label: "Long", t: 0 }, { label: "Short", t: 1 }], (it) => { btn.setOn(it.t); A.tween(st, { t: it.t }, render); });
    const sl = A.slider(pairCtl, { key: "h", label: "Short position in the second stock", min: 0, max: 200, step: 5, fmt: (v) => "$" + Math.round(v) }, st, () => render());
    function renderPayoff() {
      const { g, w, h } = frame();
      $("short-title").textContent = "Profit or loss vs. change in the stock price";
      $("short-src").textContent = "Before borrow fees";
      const x = d3.scaleLinear().domain([-100, 300]).range([0, w]);
      const y = d3.scaleLinear().domain([-300, 300]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Change in stock price, %", yl: "P&L, % of position", xf: (v) => A.spct(v, 0), yf: (v) => A.spct(v, 0), xgrid: true });
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      legend(g, [{ label: "Long", color: C.long }, { label: "Short", color: C.short }], 160, -10);
      const xs = [-100, 300];
      g.append("path").attr("d", d3.line().x((v) => x(v)).y((v) => y(v))(xs)).style("stroke", C.long).style("stroke-width", 3).style("fill", "none");
      g.append("path").attr("d", d3.line().x((v) => x(v)).y((v) => y(-v))(xs)).style("stroke", C.short).style("stroke-width", 3).style("fill", "none");
      const dot = (vx, vy, c) => g.append("circle").attr("cx", x(vx)).attr("cy", y(vy)).attr("r", 7).style("fill", c).style("stroke", C.surface).style("stroke-width", 2);
      dot(-100, -100, C.long); dot(-100, 100, C.short);
      g.append("text").attr("class", "lbl halo").attr("x", x(-100) + 12).attr("y", y(-100) + 4).text("Long: maximum loss −100%");
      g.append("text").attr("class", "lbl halo").attr("x", x(-100) + 12).attr("y", y(100) + 4).text("Short: maximum gain +100%");
      g.append("text").attr("class", "lbl halo").attr("x", x(280)).attr("y", y(280) + 22).attr("text-anchor", "end").style("fill", C.long).text("Upside unlimited");
      g.append("text").attr("class", "lbl halo").attr("x", x(280)).attr("y", y(-280) - 12).attr("text-anchor", "end").style("fill", C.short).text("Losses unlimited");
      setTile(tl.a, "Long: max gain", "Unlimited"); setTile(tl.b, "Long: max loss", "−100%");
      setTile(tl.c, "Short: max gain", "+100%"); setTile(tl.d, "Short: max loss", "Unlimited", "plus borrow fees");
      tl.d.el.classList.add("hl");
      show(flipCtl, false); show(pairCtl, false);
    }
    function render() {
      if (st.mode === "payoff") return renderPayoff();
      const { g, w, h } = frame();
      const x = d3.scaleLinear().domain([-14, 14]).range([0, w]);
      const y = d3.scaleLinear().domain([-28, 28]).range([h, 0]);
      A.axes(g, x, y, w, h, { xl: "Market return that month, %", yl: st.mode === "flip" ? "Position return, %" : "Pair return, % of long capital", xgrid: true });
      g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
      g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
      let ys, col;
      if (st.mode === "flip") {
        ys = stock.map((s) => (1 - 2 * st.t) * s); col = st.t < 0.5 ? C.long : C.short;
      } else {
        ys = MKT.map((m, t) => A_[t] - (st.h / 100) * B_[t]); col = C.alpha;
      }
      const fit = A.ols(MKT, ys);
      g.append("g").selectAll("circle").data(MKT.map((m, i) => [m, ys[i]])).join("circle")
        .attr("cx", (d) => x(d[0])).attr("cy", (d) => y(d[1])).attr("r", 4.5).style("fill", col).style("opacity", 0.65).style("stroke", C.surface).style("stroke-width", 1);
      g.append("line").attr("x1", x(-14)).attr("x2", x(14)).attr("y1", y(fit.a - 14 * fit.b)).attr("y2", y(fit.a + 14 * fit.b)).style("stroke", C.ink).style("stroke-width", 2.5);
      g.append("text").attr("class", "lbl halo").attr("x", x(11)).attr("y", y(fit.a + 11 * fit.b) + (fit.b >= 0 ? 22 : -12)).attr("text-anchor", "end").text(`slope (beta) = ${A.num(fit.b)}`);
      if (st.mode === "flip") {
        const short = st.t >= 0.5;
        setTile(tl.a, "Position", short ? "Short" : "Long"); setTile(tl.b, "Beta", A.num(fit.b));
        setTile(tl.c, "Correlation to market", A.num(fit.corr));
        setTile(tl.d, "Expected return / yr", A.spct(A.mean(ys) * 12), short ? "stocks drift up, so shorts lose on average" : "beta × 6% market premium");
        tl.d.el.classList.toggle("hl", st.hl);
      } else {
        const net = 100 - st.h, bnet = 130 - st.h;
        setTile(tl.a, "Gross / net", `${A.usd(100 + st.h)} / ${A.usd(net)}`, "long + short / long − short");
        setTile(tl.b, "Beta-adjusted net", A.usd(bnet), "1.3 × $100 − 1.0 × short");
        setTile(tl.c, "Correlation to market", A.num(fit.corr));
        setTile(tl.d, "Alpha / yr", A.spct(3 + 2 * st.h / 100), "on the $100 long");
        tl.d.el.classList.toggle("hl", Math.abs(bnet) < 8);
      }
      show(flipCtl, st.mode === "flip"); show(pairCtl, st.mode === "pair");
      $("short-src").textContent = "Simulated";
      $("short-title").textContent = st.mode === "flip" ? "Monthly position return vs. market return" : "Long $100 of A, short $h of B: monthly pair return";
      sl.sync();
    }
    A.register("w-short", {
      render,
      step(i) {
        st.hl = i === 2;
        if (i <= 2) { st.mode = "flip"; btn.setOn(i >= 1 ? 1 : 0); A.tween(st, { t: i >= 1 ? 1 : 0 }, render); }
        else if (i === 3) { if (st._timer) st._timer.stop(); st.mode = "payoff"; render(); }
        else { if (st.mode !== "pair") { st.mode = "pair"; st.h = 0; } A.tween(st, { h: 130 }, render, 1600); }
      },
    });
    btn.setOn(0); render();
  })();

  /* =========================================================
     8. STRATEGIES: build a book, then the pairs trade
     ========================================================= */
  (function () {
    const p = parts("w-strat");
    const bL = 1.1, bS = 1.0, aL = 4, aS = 2;
    const presets = [{ L: 100, S: 0 }, { L: 130, S: 30 }, { L: 120, S: 60 }, { L: 100, S: 110 }, { L: 40, S: 90 }];
    const st = { mode: "book", L: 100, S: 0, M: -20, x: 10 };
    const frame = A.frame(p.chart, { t: 44, r: 24, b: 44, l: 56 });
    const spec = $("strat-spectrum");
    // Zones get equal-ish widths so every label fits; the marker maps piecewise within each zone
    const zones = [["Short-biased", -80, -10, 1], ["Market neutral", -10, 10, 1.1], ["Long/short", 10, 80, 1], ["Long-only · 130/30", 80, 140, 1.2]];
    const flexSum = d3.sum(zones, (z) => z[3]);
    spec.innerHTML = `<div class="zones">${zones.map((z) => `<div class="zone" style="flex:${z[3]}">${z[0]}</div>`).join("")}</div><div class="marker"></div>`;
    const specPos = (v) => {
      let acc = 0;
      for (const z of zones) {
        if (v <= z[2] || z === zones[zones.length - 1]) return 100 * (acc + z[3] * Math.max(0, Math.min(1, (v - z[1]) / (z[2] - z[1])))) / flexSum;
        acc += z[3];
      }
    };
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const setTile = (t, k, v, d) => { t.el.querySelector(".k").textContent = k; t.v.textContent = v; t.d.textContent = d || ""; };
    const bookCtl = document.createElement("div"), pairCtl = document.createElement("div");
    [bookCtl, pairCtl].forEach((d) => { d.className = "controls"; d.style.width = "100%"; });
    p.ctl.append(bookCtl, pairCtl);
    const sls = [
      A.slider(bookCtl, { key: "L", label: "Long", min: 0, max: 200, step: 5, fmt: (v) => Math.round(v) + "%" }, st, () => { pre.setOn(-1); render(); }),
      A.slider(bookCtl, { key: "S", label: "Short", min: 0, max: 150, step: 5, fmt: (v) => Math.round(v) + "%" }, st, () => { pre.setOn(-1); render(); }),
    ];
    const pre = A.buttons(bookCtl, "Preset", ["Long-only", "130/30", "Long/short", "Mkt neutral", "Short-biased"].map((l, i) => ({ label: l, i })), (it) => { pre.setOn(it.i); A.tween(st, presets[it.i], render); });
    const scen = [-30, -10, 10, 20];
    const sc = A.buttons(bookCtl, "Market", scen.map((m, i) => ({ label: A.spct(m, 0), m, i })), (it) => { sc.setOn(it.i); A.tween(st, { M: it.m }, render, 500); });
    const xsl = A.slider(pairCtl, { key: "x", label: "Travel sector move", min: -20, max: 20, step: 1, fmt: (v) => A.spct(v, 0) }, st, () => render());

    // Pairs: BKNG beta 0.75 alpha +3%, EXPE beta 1.5 alpha −2% (illustrative)
    const bB = 0.75, bE = 1.5;
    const pnlDollar = (x) => 10 * (bB * x / 100 + 0.03) - 10 * (bE * x / 100 - 0.02);
    const hedge = 10 * bB / bE;
    const pnlBeta = (x) => 10 * (bB * x / 100 + 0.03) - hedge * (bE * x / 100 - 0.02);

    function render() {
      const { g, w, h } = frame();
      show(bookCtl, st.mode === "book"); show(pairCtl, st.mode === "pair"); show(spec, st.mode === "book");
      if (st.mode === "book") {
        $("strat-title").textContent = "Long and short exposure";
        $("strat-src").textContent = "Longs: beta 1.1, +4% alpha · Shorts: beta 1.0, underperform by 2%";
        const gross = st.L + st.S, net = st.L - st.S, bnet = bL * st.L - bS * st.S;
        const comp = [
          { k: "Market", v: bnet / 100 * st.M, c: C.market },
          { k: "Long alpha", v: st.L / 100 * aL, c: C.long },
          { k: "Short alpha", v: st.S / 100 * aS, c: C.short },
        ];
        const total = d3.sum(comp, (d) => d.v);
        comp.push({ k: "Total", v: total, c: C.ink });
        const x = d3.scaleBand().domain(comp.map((d) => d.k)).range([0, w]).padding(0.35);
        const y = d3.scaleLinear().domain([-45, 30]).range([h, 0]);
        g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
        g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
        g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).tickSize(0)).selectAll("text").attr("dy", "1.2em");
        g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
        g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -10).text(`One-year P&L if the market moves ${A.spct(st.M, 0)}, % of capital`);
        comp.forEach((d) => {
          g.append("path").attr("d", vbar(x(d.k), x.bandwidth(), y(0), y(d.v), 4)).style("fill", d.c);
          g.append("text").attr("class", "lbl halo").attr("x", x(d.k) + x.bandwidth() / 2).attr("y", d.v >= 0 ? y(d.v) - 8 : y(d.v) + 18).attr("text-anchor", "middle").text(A.spct(d.v));
        });
        setTile(tl.a, "Long / short", `${Math.round(st.L)}% / ${Math.round(st.S)}%`);
        setTile(tl.b, "Gross", Math.round(gross) + "%", "long + short");
        setTile(tl.c, "Net", A.pct(net, 0), "long − short");
        setTile(tl.d, "Beta-adjusted net", A.pct(bnet, 0), "what the market actually moves");
        const pos = Math.max(-80, Math.min(140, bnet));
        const mk = spec.querySelector(".marker");
        mk.style.left = specPos(pos) + "%"; mk.textContent = A.pct(bnet, 0);
        spec.querySelectorAll(".zone").forEach((z, i) => z.classList.toggle("on", bnet >= zones[i][1] && (bnet < zones[i][2] || (i === 3 && bnet >= 80))));
        sls.forEach((s) => s.sync());
      } else {
        $("strat-title").textContent = "Pairs trade: long Booking, short Expedia";
        $("strat-src").textContent = "Illustrative: BKNG beta 0.75, +3% alpha · EXPE beta 1.5, −2% alpha";
        const x = d3.scaleLinear().domain([-20, 20]).range([0, w]);
        const y = d3.scaleLinear().domain([-1.2, 2.2]).range([h, 0]);
        A.axes(g, x, y, w, h, { xl: "Travel sector move over the year, %", yl: "P&L, $ millions", xf: (v) => A.pct(v, 0), yf: (v) => A.usd(v, 1, "M"), xgrid: true });
        g.append("line").attr("class", "zero").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
        g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h);
        legend(g, [{ label: "Dollar-neutral ($10M / $10M)", color: C.market }, { label: `Beta-neutral ($10M / $${hedge.toFixed(1)}M)`, color: C.alpha }], 0, -26);
        const xs = [-20, 20];
        [[pnlDollar, C.market], [pnlBeta, C.alpha]].forEach(([f, c]) => {
          g.append("path").attr("d", d3.line().x((v) => x(v)).y((v) => y(f(v)))(xs)).style("stroke", c).style("stroke-width", 3).style("fill", "none");
          g.append("circle").attr("cx", x(st.x)).attr("cy", y(f(st.x))).attr("r", 7).style("fill", c).style("stroke", C.surface).style("stroke-width", 2);
          const right = st.x < 8;
          g.append("text").attr("class", "lbl halo").attr("x", x(st.x) + (right ? 10 : -10)).attr("text-anchor", right ? "start" : "end")
            .attr("y", y(f(st.x)) + (f === pnlDollar ? (st.x > 2 ? 18 : -10) : (st.x > 2 ? -10 : 18))).text(A.usd(f(st.x), 2, "M"));
        });
        setTile(tl.a, "Sector move", A.spct(st.x, 0));
        setTile(tl.b, "Dollar-neutral P&L", A.usd(pnlDollar(st.x), 2, "M"), "depends on the sector");
        setTile(tl.c, "Beta-neutral P&L", A.usd(pnlBeta(st.x), 2, "M"), "same in every scenario");
        setTile(tl.d, "Expedia short", "$" + hedge.toFixed(2) + "M", "$10M × 0.75 ÷ 1.5");
        xsl.sync();
      }
    }
    A.register("w-strat", {
      render,
      step(i) {
        if (i <= 4) { st.mode = "book"; pre.setOn(i); A.tween(st, presets[i], render); }
        else { st.mode = "pair"; st.x = -20; A.tween(st, { x: 20 }, render, 2200); }
      },
    });
    pre.setOn(0); sc.setOn(0); st.M = -30; render();
  })();

  /* =========================================================
     9. ALLOCATOR: fee waterfall, then a sleeve in 60/40
     ========================================================= */
  (function () {
    const p = parts("w-alloc");
    const rf = 3;
    const st = { mode: "fees", a: 6, m: 2, pf: 20, k: 0, rho: 0 };
    const frame = A.frame(p.chart, { t: 30, r: 24, b: 44, l: 52 });
    const tl = A.tiles(p.ro, [{ key: "a", label: "" }, { key: "b", label: "" }, { key: "c", label: "" }, { key: "d", label: "" }]);
    const setTile = (t, k, v, d) => { t.el.querySelector(".k").textContent = k; t.v.textContent = v; t.d.textContent = d || ""; };
    const feeCtl = document.createElement("div"), slvCtl = document.createElement("div");
    [feeCtl, slvCtl].forEach((d) => { d.className = "controls"; d.style.width = "100%"; });
    p.ctl.append(feeCtl, slvCtl);
    const fs = [
      A.slider(feeCtl, { key: "a", label: "Gross alpha", min: 0, max: 12, step: 0.5, fmt: (v) => v.toFixed(1) + "%" }, st, () => render()),
      A.slider(feeCtl, { key: "m", label: "Management fee", min: 0, max: 3, step: 0.25, fmt: (v) => v.toFixed(2) + "%" }, st, () => { fb.setOn(-1); render(); }),
      A.slider(feeCtl, { key: "pf", label: "Performance fee", min: 0, max: 30, step: 1, fmt: (v) => Math.round(v) + "%" }, st, () => { fb.setOn(-1); render(); }),
    ];
    const feeP = [{ m: 2, pf: 20 }, { m: 1.5, pf: 17 }, { m: 1, pf: 10 }];
    const fb = A.buttons(feeCtl, "Terms", [{ label: "2 and 20", i: 0 }, { label: "1.5 and 17", i: 1 }, { label: "1 and 10", i: 2 }], (it) => { fb.setOn(it.i); A.tween(st, feeP[it.i], render); });
    const ss = [
      A.slider(slvCtl, { key: "k", label: "Hedge fund sleeve", min: 0, max: 40, step: 1, fmt: (v) => Math.round(v) + "%" }, st, () => render()),
      A.slider(slvCtl, { key: "rho", label: "Stock–bond correlation", min: -0.4, max: 0.6, step: 0.05, fmt: (v) => A.num(v) }, st, () => { rb.setOn(-1); render(); }),
    ];
    const rb = A.buttons(slvCtl, "Regime", [{ label: "2000s–2010s (−0.3)", r: -0.3, i: 0 }, { label: "Neutral (0)", r: 0, i: 1 }, { label: "2022-style (+0.5)", r: 0.5, i: 2 }], (it) => { rb.setOn(it.i); A.tween(st, { rho: it.r }, render); });

    const fees = () => {
      const gross = rf + st.a, mg = st.m, perf = Math.max(0, gross - mg) * st.pf / 100, net = gross - mg - perf;
      return { gross, mg, perf, net, netA: net - rf };
    };
    const assets = { s: [7, 16], b: [4, 6], h: [6, 6] };
    function port(k, rho) {
      const w = [0.6 * (1 - k), 0.4 * (1 - k), k], sd = [16, 6, 6], mu = [7, 4, 6];
      const R = [[1, rho, 0.1], [rho, 1, 0], [0.1, 0, 1]];
      let v = 0; const contrib = [0, 0, 0];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const c = w[i] * w[j] * R[i][j] * sd[i] * sd[j]; v += c; contrib[i] += c; }
      return { mu: d3.sum(w.map((x, i) => x * mu[i])), vol: Math.sqrt(v), eqShare: contrib[0] / v };
    }
    function render() {
      const { g, w, h } = frame();
      show(feeCtl, st.mode === "fees"); show(slvCtl, st.mode === "sleeve");
      if (st.mode === "fees") {
        $("alloc-title").textContent = "Where a market-neutral fund's gross return goes";
        $("alloc-src").textContent = "Cash rate 3% · performance fee on return after the management fee, no hurdle";
        const f = fees();
        const bars = [
          { k: "Gross return", lo: 0, hi: f.gross, cash: rf },
          { k: "Mgmt fee", lo: f.gross - f.mg, hi: f.gross, fee: true },
          { k: "Perf. fee", lo: f.gross - f.mg - f.perf, hi: f.gross - f.mg, fee: true },
          { k: "Net to you", lo: 0, hi: f.net, cash: rf },
        ];
        const x = d3.scaleBand().domain(bars.map((b) => b.k)).range([0, w]).padding(0.3);
        const y = d3.scaleLinear().domain([0, 16]).range([h, 0]);
        g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
        g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((v) => v + "%"));
        g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).tickSize(0)).selectAll("text").attr("dy", "1.2em");
        legend(g, [{ label: "Cash return", color: C.ink3 }, { label: "Alpha", color: C.alpha }, { label: "Fees", color: C.neg }], 0, -12);
        bars.forEach((b, i) => {
          const bx = x(b.k), bw = x.bandwidth();
          if (b.fee) {
            if (b.hi - b.lo > 0.01) g.append("rect").attr("x", bx).attr("width", bw).attr("y", y(b.hi)).attr("height", y(b.lo) - y(b.hi)).attr("rx", 3).style("fill", C.neg);
            g.append("text").attr("class", "lbl halo").attr("x", bx + bw / 2).attr("y", y(b.hi) - 8).attr("text-anchor", "middle").text("−" + (b.hi - b.lo).toFixed(2) + "%");
          } else {
            const c = Math.min(b.cash, b.hi);
            g.append("rect").attr("x", bx).attr("width", bw).attr("y", y(c)).attr("height", y(0) - y(c)).style("fill", C.ink3);
            if (b.hi > c) g.append("path").attr("d", vbar(bx, bw, y(c) - 2, y(b.hi), 4)).style("fill", C.alpha);
            g.append("text").attr("class", "lbl halo").attr("x", bx + bw / 2).attr("y", y(b.hi) - 8).attr("text-anchor", "middle").text(b.hi.toFixed(2) + "%");
          }
          if (i < bars.length - 1) {
            const lvl = i === 0 ? b.hi : b.lo;
            g.append("line").attr("x1", bx + bw).attr("x2", x(bars[i + 1].k)).attr("y1", y(lvl)).attr("y2", y(lvl)).style("stroke", C.ink3).style("stroke-dasharray", "3 3");
          }
        });
        setTile(tl.a, "Gross alpha", A.pct(st.a)); setTile(tl.b, "Fees paid", A.pct(f.mg + f.perf));
        setTile(tl.c, "Net alpha to you", A.pct(f.netA));
        setTile(tl.d, "Share of alpha you keep", st.a > 0 ? Math.round(100 * Math.max(0, f.netA) / st.a) + "%" : "–");
        tl.d.el.classList.add("hl");
        fs.forEach((s) => s.sync());
      } else {
        tl.d.el.classList.remove("hl");
        $("alloc-title").textContent = "60/40 plus a market-neutral sleeve";
        $("alloc-src").textContent = "Assumed: stocks 7% / 16% vol, bonds 4% / 6%, fund 6% / 6% with 0.1 correlation to stocks";
        const x = d3.scaleLinear().domain([4, 17]).range([0, w]);
        const y = d3.scaleLinear().domain([3.5, 7.5]).range([h, 0]);
        A.axes(g, x, y, w, h, { xl: "Volatility (risk), %", yl: "Expected return, %", xgrid: true });
        [["Stocks", assets.s, C.market], ["Bonds", assets.b, C.bonds], ["Hedge fund", assets.h, C.alpha]].forEach(([n, [mu, sd], c]) => {
          g.append("circle").attr("cx", x(sd)).attr("cy", y(mu)).attr("r", 7).style("fill", c).style("stroke", C.surface).style("stroke-width", 2);
          const lf = n === "Hedge fund";
          g.append("text").attr("class", "lbl halo").attr("x", x(sd) + (lf ? -12 : 10)).attr("y", y(mu) + (lf ? -10 : 4)).attr("text-anchor", lf ? "start" : "start").text(n);
        });
        const path = d3.range(0, 0.4001, 0.01).map((k) => port(k, st.rho));
        g.append("path").attr("d", d3.line().x((d) => x(d.vol)).y((d) => y(d.mu))(path)).style("fill", "none").style("stroke", C.ink3).style("stroke-width", 2).style("stroke-dasharray", "4 3");
        const base = port(0, st.rho), cur = port(st.k / 100, st.rho);
        g.append("circle").attr("cx", x(base.vol)).attr("cy", y(base.mu)).attr("r", 7).style("fill", C.surface).style("stroke", C.ink).style("stroke-width", 2);
        g.append("text").attr("class", "lbl-2 halo").attr("x", x(base.vol) + 10).attr("y", y(base.mu) + 18).text("Plain 60/40");
        g.append("circle").attr("cx", x(cur.vol)).attr("cy", y(cur.mu)).attr("r", 9).style("fill", C.ink).style("stroke", C.surface).style("stroke-width", 2);
        g.append("text").attr("class", "lbl halo").attr("x", x(cur.vol)).attr("y", y(cur.mu) + 26).attr("text-anchor", "middle").text(`With ${Math.round(st.k)}% sleeve`);
        setTile(tl.a, "Expected return", A.pct(cur.mu, 2), `60/40 alone: ${A.pct(base.mu, 2)}`);
        setTile(tl.b, "Volatility", A.pct(cur.vol), `60/40 alone: ${A.pct(base.vol)}`);
        setTile(tl.c, "Sharpe ratio", A.num((cur.mu - rf) / cur.vol), `60/40 alone: ${A.num((base.mu - rf) / base.vol)}`);
        setTile(tl.d, "Equity share of risk", Math.round(cur.eqShare * 100) + "%", `60/40 alone: ${Math.round(base.eqShare * 100)}%`);
        ss.forEach((s) => s.sync());
      }
    }
    A.register("w-alloc", {
      render,
      step(i) {
        if (i <= 1) { st.mode = "fees"; fb.setOn(i); A.tween(st, { a: 6, ...feeP[i] }, render); }
        else {
          if (st.mode !== "sleeve") { st.mode = "sleeve"; st.k = 0; }
          rb.setOn(i === 2 ? 1 : 2);
          A.tween(st, i === 2 ? { k: 20, rho: 0 } : { k: 20, rho: 0.5 }, render, 1200);
        }
      },
    });
    fb.setOn(0); render();
  })();

  A.boot();
})();
