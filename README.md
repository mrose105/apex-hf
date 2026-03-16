# APEX-HF: AI-Powered Multi-Strategy Hedge Fund Engine

> Quantitative backtesting and Monte Carlo simulation platform modeled on Renaissance Technologies, Citadel Securities, Bridgewater Associates, and Jane Street.

## Overview

APEX-HF is a Greeks-based multi-strategy hedge fund backtester that simulates four decorrelated alpha sources using actual options structures, applies Medallion-class leverage and conviction scaling, and projects forward with 50K-path Monte Carlo simulations — all in a single interactive dashboard.

**Target performance:** 75%+ CAGR | Sharpe 3.5–5.0 | Max DD 13–18%

## Project Structure

```
apex-hf/
├── README.md                          ← You are here
├── apex-hf-engine.html                ← Main backtest + MC dashboard (production)
├── apex-hf-trade-lab.jsx              ← Trade log statistical analysis (React artifact)
└── docs/
    └── apex-hf-research-whitepaper.md ← Strategy research paper (from initial deep research)
```

## Files

### `apex-hf-engine.html`
**The main dashboard.** Self-contained HTML file — open in any browser, no dependencies.

Contains:
- **10.5-year backtest** (Jan 4, 2016 → Mar 13, 2026, 2,660 trading days)
- **4 strategy pillars** with Greeks-based P&L generation:
  1. **Options/Volatility** — Short iron condors on SPY, P&L = θ + Γ + V + VRP
  2. **Statistical Arbitrage** — Pairs via options, Ornstein-Uhlenbeck mean-reversion
  3. **Macro Systematic** — TSMOM via 30Δ calls/puts + OTM tail hedges
  4. **Execution/MM Alpha** — SPY weekly market-making + gamma scalping + order flow
- **Leverage engine:** 14x base, vol-targeted, conviction-scaled up to 3x, exposure-capped at 28x
- **Risk management:** Drawdown buy zone (6–30%), catastrophe kill at 30%, regime-dependent financing
- **Log-scale equity charts** with Medallion comparison overlay
- **Monte Carlo:** 50K paths × 10yr forward projection with confidence bands
- **Journey chart:** Full 20-year arc ($100K → backtest → MC forward) with milestone markers
- **Trade log:** Every rebalance with actual option trades, Greeks decomposition, SPY price, IV, conviction

### `apex-hf-trade-lab.jsx`
**Statistical analysis dashboard** for the trade log. React artifact.

Contains:
- CSV export (10,640 rows × 35 columns including all Greeks fields)
- Win rate / Sharpe / Sortino / profit factor / skewness / kurtosis / autocorrelation
- **Greeks P&L decomposition:** Theta vs gamma cost vs vega vs VRP attribution
- **Tail hedge analysis:** Payoff days, avg payoff, daily carry cost, net value
- **Execution alpha breakdown:** Spread capture vs gamma scalp vs order flow
- **Conviction analysis:** Does sizing up on best signals actually produce better returns?
- **IV regime analysis:** Performance bucketed by implied volatility level
- **Edge decay detection:** First-half vs second-half Sharpe comparison
- **Seasonality:** Monthly and weekday P&L patterns
- Filterable by strategy, regime, conviction level

## Strategy Architecture

### How Returns Are Generated (v5 — Greeks-Based)

Each strategy simulates actual options positions. Daily P&L is decomposed into Greek components:

| Strategy | Option Structure | P&L = | Edge Source |
|----------|-----------------|-------|-------------|
| Vol/Options | Short iron condor (16Δ/5Δ) | θ - Γ·ΔS² ± V·ΔIV + VRP | Variance risk premium |
| StatArb | Long ATM calls/puts on pair | OU spread × 4.5x optLev - θ | Mean reversion |
| Macro | Long 30Δ calls or puts (3mo) | Δ·trend + Γ·convexity - θ + tail | Trend + convexity |
| Exec/MM | SPY weekly quoting + scalp | Spread + γ-scalp + flow - inventory | Microstructure |

### Risk Framework (v5.1 — Post-Simons Audit)

- **Kelly sizing:** 70% fractional Kelly (reduced from 90% per Simons audit — Renaissance runs 0.5-0.7)
- **Conviction scaling:** Single-layer 5-day signal (0.6σ threshold) → linear scale to 2.0x max (simplified from 3-layer to reduce overfitting risk)
- **Vol targeting:** Dynamic leverage scales to maintain 28% annualized portfolio vol
- **Drawdown response:** 6–30% DD = increase exposure (buy the dip, up to 1.35x); 30%+ = catastrophe kill
- **Exposure cap:** Hard 24x gross maximum (reduced from 28x)
- **Regime-dependent financing:** 50bps (bull), 75bps (transition), 250bps (crisis), 400bps (quant quake)
- **Transaction costs:** 3bps × leverage × 15% daily turnover (scales with leverage, not flat per-trade)
- **Market impact:** Almgren-Chriss simplified: 3bps × √(excess leverage)

### Regime Model (4-state HMM)

HMM-inspired 4-state Markov chain:
- **Bull** (P stay = 98.8%): Compressed vol, elevated returns, low correlation
- **Transition** (P stay = 93.0%): Reduced alpha, higher vol, rising correlation
- **Crisis** (P stay = 94.5%): Vol/StatArb suffer, Macro thrives (crisis alpha), correlations spike
- **Quant Quake** (P stay = 40%): Extreme tail correlation (ρ>0.7 vol/statarb), all strategies correlated, IV explodes to 50%. Short-lived but devastating. Models Aug 2007 / Mar 2020 events.

### Simons Audit Fixes Applied (v5.1)

1. ✓ Kelly reduced 0.90 → 0.70
2. ✓ Conviction simplified: single-layer 5-day signal, 2.0x max cap
3. ✓ 4th regime added: Quant Quake with ρ>0.7, 400bps financing
4. ✓ TC scales with leverage: 3bps × lev × 15% turnover
5. ✓ Exposure cap reduced 28x → 24x
6. ✓ Leverage raised 14x → 15.5x to compensate for Kelly reduction

## How Cumulative P&L Is Calculated

For each trading day `t`:

```
1. Generate regime-dependent SPY price move and IV level
2. For each strategy:
   a. Compute options Greeks (Γ, θ, V) from Black-Scholes
   b. Daily P&L = f(Greeks, SPY move, IV change, edge) - transaction costs
3. Apply position weights: w_i = base_weight × kelly × conviction × regime_tilt
4. Apply leverage: lev = min(vol_target / rolling_vol, base_lev × 1.6)
5. Apply drawdown response: if DD > 6%, boost lev; if DD > 30%, cut to 35%
6. Cap gross exposure at 28x
7. Portfolio return = Σ(w_i × ret_i) × lev - financing - market_impact
8. Equity[t] = Equity[t-1] × (1 + portfolio_return)
9. Cumulative P&L % = (Equity[t] / 100,000 - 1) × 100
```

## Usage

**Backtest dashboard:** Open `apex-hf-engine.html` in Chrome/Firefox. Click "Run Backtest" or "New Path" for different market realizations. Adjust sliders for leverage, Kelly, conviction, vol target, etc.

**Trade analysis:** Open `apex-hf-trade-lab.jsx` as a Claude artifact. Filter by strategy/regime/conviction, then click "Export CSV" to download for pandas/R analysis.

## Predecessor: APEX Phase 1

The original APEX project (separate from this repo) focused on:
- SPY volume profile analysis (HVN/LVN/POC detection)
- Real-time SPY price terminal via Alpaca API
- Interactive HTML dashboard with momentum meters

APEX-HF builds on those concepts but is a fundamentally different system — a full multi-strategy simulation engine rather than a single-instrument analysis tool.

## Inspired By

- **Renaissance Technologies / Medallion Fund** — Leverage × high-Sharpe base, physics-inspired signal extraction
- **Citadel Securities** — Pod-shop model, exposure caps, forced strategy Darwinism
- **Bridgewater Associates** — Regime classification, risk parity, macro systematic
- **Jane Street** — Market-making, probabilistic thinking, execution optimization
- **Jim Simons** — "You can teach a physicist finance, but you can't teach a finance person physics"
