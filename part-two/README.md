# Hedge Fund Strategies Beyond Equity (Part Two)

An interactive, scroll-through site on non-equity hedge fund strategies: event-driven, global macro, carry, trend following, relative value and multi-strategy platforms.

**Live site:** https://presleycooper.github.io/Portfolio-MGMT-and-HF-Talk/part-two/ (once GitHub Pages is on)
**Speaker notes:** `notes.html` (also linked from the Notes button on the site)

## Presenting

| Key | Action |
|---|---|
| `↓` `→` `Space` `Page Down` | Next step (clickers send these) |
| `↑` `←` `Page Up` | Previous step |
| `P` | Projector mode: larger type, hides the math boxes |
| `D` | Toggle light and dark (dark is the default) |

Each scroll step sets its chart to a rehearsed state. Every chart is still fully interactive.

## Chapters

The core session (1–5) is built around one idea: concave payoffs ("selling insurance") and convex payoffs ("buying insurance"), with merger arbitrage as the concave example and global macro as the convex one, followed by a group project. Chapters 6–13 can be presented as a separate session.

1. Steady returns: convertible arbitrage before and during 2008
2. Payoff shape: down-market vs. up-market beta, concave vs. convex strategies
3. Merger arbitrage: Microsoft/Activision, Musk/Twitter, Kroger/Albertsons, and a typical deal
4. Global macro: the pound in the ERM, 1992, with a box on how buying a currency or raising rates supports it
5. Group project: price a live merger arbitrage deal (pending deals, what to find, formulas and a spread calculator)
6. Distressed debt and activism: the capital structure waterfall
7. One view, many trades: macro expressions in 2022
8. The carry trade: dollar/yen, 2021–2024, and the August 2024 unwind
9. Trend following: a 12-month rule on eight real markets, and the worst months for stocks
10. Relative value and leverage: a convergence trade simulator, LTCM, and relative value indexes in crises
11. Multi-strategy platforms: pods with drawdown limits (simulated)
12. The allocator's view: 60/40 plus a hedge fund sleeve, crisis correlations, 2008 and 2022
13. Summary and discussion question

## Data

Real data unless a chart says "Illustrative" or "Simulated". Everything is bundled in `js/data.js`, so the site works offline.

| Data | Source | Used in |
|---|---|---|
| Hedge fund strategy indexes, monthly, 1997-01 to 2021-05 | EDHEC-Risk Alternative Indexes, via the `edhec` dataset in the PerformanceAnalytics R package | 1, 2, 6, 9, 10, 12 |
| US stock market, monthly total return | Ken French Data Library (CRSP value-weighted, via the Python `arch` package) through 2018-11, then SPY total return (chartrow.com) | 1, 2, 9, 12 |
| Risk-free rate | Ken French through 2018-11, then approximate T-bill rates | 12 (Sharpe ratios) |
| 10-year Treasury return | Approximated from monthly 10-year yields (datasets/bond-yields-us-10y) with a duration of 7.5 | 7, 9, 12 |
| S&P 500 monthly level | Robert Shiller data (datasets/s-and-p-500), monthly averages | 9 |
| Exchange rates, daily | Federal Reserve H.10 (datasets/exchange-rates) | 7, 8, 9 |
| WTI crude oil, gold | datasets/oil-prices, datasets/gold-prices | 7, 9 |
| Pound/Deutsche mark, daily, 1992 | Bank of England spot rates (poundsterlinglive.com) | 4 |
| Activision, Twitter, Albertsons month-end prices | digrin.com price history; deal terms and dates from company and regulator announcements | 3 |
| 2022 hedge fund index returns | HFR press releases (HFRI Macro, HFRI 500 Systematic Directional) and Cambridge Associates (HFR Equity Hedge, Event Driven, Relative Value) | 7, 9, 12 |
| LTCM figures | Lowenstein, *When Genius Failed* (2000); Jorion (2000) | 10 |

Notes and limits:

- The trend-following rule uses spot prices and monthly data, with no transaction costs, futures roll or interest on collateral. It shows the mechanism, not a fund's track record.
- The 10-year Treasury series is an approximation from yields, not an index total return.
- The Albertsons fallback price ($18) is an assumption; the other two deals use the target's pre-deal price.
- The leverage simulator's spread path and the multi-strategy pods are illustrative and simulated.
- The project's deal list reflects terms announced as of October 23, 2026 (company press releases and SEC filings). Prices are not bundled; groups look them up live. Update the list before reusing the project.

### Rebuilding `js/data.js`

`data-src/make_data.py` rebuilds it. It downloads the GitHub-hosted datasets and the EDHEC indexes, reads the hand-collected series in `data-src/raw/` (1992 pound/mark rates, SPY monthly returns after 2018, deal prices and events), and writes `js/data.js`:

```
cd part-two/data-src
pip install arch rdata
python3 make_data.py
```

## Running locally

No build step. Open `index.html` in a browser, or serve the repository root:

```
python3 -m http.server
```

then open `http://localhost:8000/part-two/`.

## Files

- `index.html`: all chapter text
- `js/core.js`: navigation, scroll steps, theme, shared chart helpers (shared design with part one)
- `js/widgets.js`: one interactive per chapter
- `js/data.js`: the real data used by the charts
- `css/style.css`: layout and the color system (#00ddff, #005eff, #00ffa2, #001114, #ffffff)
- `notes.html`: speaker notes with timings
- `data-src/`: the data build script and hand-collected inputs (not loaded by the site)
