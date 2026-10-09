# Portfolio Management and Equity Hedge Strategies

An interactive, scroll-through site on portfolio management fundamentals and equity hedge fund strategies.

**Live site:** https://presleycooper.github.io/Portfolio-MGMT-and-HF-Talk/ (once GitHub Pages is on)
**Speaker notes:** `notes.html` (also linked from the Notes button on the site)

## Presenting

| Key | Action |
|---|---|
| `↓` `→` `Space` `Page Down` | Next step (clickers send these) |
| `↑` `←` `Page Up` | Previous step |
| `P` | Projector mode: larger type, hides the math boxes |
| `D` | Toggle dark mode |

Each scroll step sets its chart to a rehearsed state, so you can present without touching a slider. Every chart is still fully interactive.

## Chapters

1. Risk, return and correlation
2. Diversification: systematic and idiosyncratic risk
3. The efficient frontier, capital market line and market portfolio
4. Risk-adjusted returns: Sharpe, Treynor, Jensen's alpha, information ratio
5. Allocation and selection effects (Brinson attribution)
6. Risk concentration in a 60/40 portfolio (real 2000–2024 S&P 500 and US Aggregate returns)
7. Short positions invert correlation, and the hedged pair
8. A position with negative expected return can improve a portfolio
9. Equity hedge strategies by net exposure, plus a pairs trade
10. Hedge funds in an institutional portfolio: fees, and a market-neutral sleeve in 60/40
11. Summary and discussion question

## Data

Everything is simulated or illustrative except chapter 6, which uses calendar-year total returns for the S&P 500 and the Bloomberg US Aggregate Bond Index. Simulated series use a fixed random seed, so the charts look the same every time.

## Running locally

No build step. Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server
```

D3 and the QR code library are vendored in `js/vendor/`, so the site works offline (fonts fall back to system fonts).

## Files

- `index.html`: all chapter text
- `js/core.js`: navigation, scroll steps, theme, shared chart helpers
- `js/widgets.js`: one interactive per chapter
- `css/style.css`: layout and the color system
- `notes.html`: speaker notes with timings
