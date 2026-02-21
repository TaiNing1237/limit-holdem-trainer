// panels.js — Hand-results table & asset line-chart overlay panels

const Panels = (() => {
  let _active = null;

  // ── Open / close ─────────────────────────────────────────────────────────

  function toggle(id) {
    if (_active === id) {
      _close();
    } else {
      _close();
      _active = id;
      document.getElementById(`panel-${id}`)?.classList.add('panel-open');
      document.querySelectorAll('.ptab').forEach(b => b.classList.remove('ptab-active'));
      document.getElementById(`ptab-${id}`)?.classList.add('ptab-active');
      _render(id);
    }
  }

  function _close() {
    if (!_active) return;
    document.getElementById(`panel-${_active}`)?.classList.remove('panel-open');
    document.querySelectorAll('.ptab').forEach(b => b.classList.remove('ptab-active'));
    _active = null;
  }

  // Refresh whichever panel is currently open (called after each hand)
  function refresh() {
    if (_active) _render(_active);
  }

  function _render(id) {
    if (id === 'history') _renderHistory();
    else if (id === 'chart')   _renderChart();
  }

  // ── Hand-Results Table ────────────────────────────────────────────────────

  function _renderHistory() {
    const el = document.getElementById('panel-history-body');
    if (!el) return;

    const hands = History.getHands();
    if (hands.length === 0) {
      el.innerHTML = '<div class="pn-empty">No hands recorded yet. Play a few hands first.</div>';
      return;
    }

    const N = hands[0].numPlayers;
    const seatName = i => i === 0 ? 'You' : `AI ${i}`;

    // Sticky header
    let html = '<div class="ph-wrap"><table class="ph-table"><thead><tr>';
    html += '<th>#</th><th>Pot</th>';
    for (let i = 0; i < N; i++) {
      html += `<th class="${i === 0 ? 'ph-you' : ''}">${seatName(i)}</th>`;
    }
    html += '</tr></thead><tbody>';

    // Newest hand first
    for (let hi = hands.length - 1; hi >= 0; hi--) {
      const h = hands[hi];
      html += `<tr class="${hi % 2 === 0 ? 'ph-even' : ''}">`;
      html += `<td class="ph-num">${h.handNum}</td>`;
      html += `<td class="ph-pot">$${h.pot}</td>`;
      for (let i = 0; i < N; i++) {
        if (h.eliminated[i]) {
          html += `<td class="ph-elim">—</td>`;
        } else {
          const delta  = (h.chipsEnd[i] ?? 0) - h.chipsStart[i];
          const isWin  = h.winners.includes(i);
          const cls    = delta > 0 ? 'ph-pos' : delta < 0 ? 'ph-neg' : 'ph-zero';
          const prefix = delta > 0 ? '+$' : delta < 0 ? '-$' : '$';
          html += `<td class="${cls}${isWin ? ' ph-win-cell' : ''}">${prefix}${Math.abs(delta)}</td>`;
        }
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    el.innerHTML = html;
  }

  // ── Asset Line Chart ──────────────────────────────────────────────────────

  function _renderChart() {
    const el = document.getElementById('panel-chart-body');
    if (!el) return;

    const hands = History.getHands();
    // Series: starting chips + chip count after each recorded hand
    const series = [STARTING_CHIPS, ...hands.map(h => h.chipsEnd[POS.PLAYER] ?? STARTING_CHIPS)];

    if (series.length < 2) {
      el.innerHTML = '<div class="pn-empty">Play some hands to see your chip trend.</div>';
      return;
    }

    const cur   = series[series.length - 1];
    const net   = cur - STARTING_CHIPS;
    const best  = Math.max(...series);
    const worst = Math.min(...series);
    const upColor   = '#2ecc71';
    const downColor = '#e74c3c';
    const lineColor = cur >= STARTING_CHIPS ? upColor : downColor;

    // ── SVG chart ──
    const W = 320, H = 170;
    const PAD = { t: 18, r: 18, b: 30, l: 55 };
    const cW = W - PAD.l - PAD.r;
    const cH = H - PAD.t - PAD.b;

    const pad = (v, frac) => v * frac;
    const yMin  = Math.min(...series, STARTING_CHIPS) - pad(Math.abs(net) || 150, 0.12);
    const yMax  = Math.max(...series, STARTING_CHIPS) + pad(Math.abs(net) || 150, 0.12);
    const yRange = yMax - yMin || 1;

    const sx = i  => PAD.l + (i / (series.length - 1)) * cW;
    const sy = v  => PAD.t + cH - ((v - yMin) / yRange) * cH;

    // Grid lines + Y-axis labels
    let grid = '';
    const TICKS = 4;
    for (let t = 0; t <= TICKS; t++) {
      const v = yMin + (yRange / TICKS) * t;
      const y = sy(v).toFixed(1);
      grid += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="rgba(255,255,255,.07)" stroke-width="1"/>`;
      grid += `<text x="${PAD.l - 5}" y="${(+y + 3.5).toFixed(1)}" fill="#718093" font-size="8.5" text-anchor="end">$${Math.round(v)}</text>`;
    }

    // Starting-chips reference dashed line
    const refY = sy(STARTING_CHIPS).toFixed(1);
    grid += `<line x1="${PAD.l}" y1="${refY}" x2="${W - PAD.r}" y2="${refY}" stroke="rgba(244,208,63,.3)" stroke-width="1" stroke-dasharray="4,3"/>`;
    grid += `<text x="${W - PAD.r + 2}" y="${(+refY + 3).toFixed(1)}" fill="rgba(244,208,63,.5)" font-size="7.5">start</text>`;

    // Polyline points
    const polyPts = series.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

    // Area fill path
    const baseY  = sy(yMin).toFixed(1);
    const area   = `M${sx(0).toFixed(1)},${baseY} ` +
      series.map((v, i) => `L${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ') +
      ` L${sx(series.length - 1).toFixed(1)},${baseY} Z`;

    // X-axis labels (sparse)
    let xLabels = '';
    const maxLabels = 6;
    const xStep = Math.max(1, Math.ceil((series.length - 1) / maxLabels));
    for (let i = 0; i < series.length; i += xStep) {
      xLabels += `<text x="${sx(i).toFixed(1)}" y="${H - 8}" fill="#718093" font-size="8.5" text-anchor="middle">${i}</text>`;
    }
    const lastI = series.length - 1;
    if (lastI % xStep !== 0) {
      xLabels += `<text x="${sx(lastI).toFixed(1)}" y="${H - 8}" fill="#718093" font-size="8.5" text-anchor="middle">${lastI}</text>`;
    }

    // End-point dot
    const ex = sx(lastI).toFixed(1);
    const ey = sy(cur).toFixed(1);

    // High / low dots
    const hiIdx = series.indexOf(best);
    const loIdx = series.indexOf(worst);
    const hiDot = best !== cur
      ? `<circle cx="${sx(hiIdx).toFixed(1)}" cy="${sy(best).toFixed(1)}" r="3" fill="${upColor}" opacity=".7"/>`
      : '';
    const loDot = worst !== cur
      ? `<circle cx="${sx(loIdx).toFixed(1)}" cy="${sy(worst).toFixed(1)}" r="3" fill="${downColor}" opacity=".7"/>`
      : '';

    const sign = net >= 0 ? '+' : '-';

    el.innerHTML = `
      <div class="chart-stats">
        <div class="cs-row">
          <span class="cs-lbl">Current</span>
          <span class="cs-val" style="color:${lineColor}">$${cur.toLocaleString()}</span>
        </div>
        <div class="cs-row">
          <span class="cs-lbl">Net P&amp;L</span>
          <span class="cs-val" style="color:${lineColor}">${sign}$${Math.abs(net).toLocaleString()}</span>
        </div>
        <div class="cs-row">
          <span class="cs-lbl">Peak</span>
          <span class="cs-val" style="color:${upColor}">$${best.toLocaleString()}</span>
        </div>
        <div class="cs-row">
          <span class="cs-lbl">Trough</span>
          <span class="cs-val" style="color:${downColor}">$${worst.toLocaleString()}</span>
        </div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;margin-top:8px">
        <defs>
          <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="${lineColor}" stop-opacity="0.40"/>
            <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${grid}
        <path d="${area}" fill="url(#aGrad)"/>
        <polyline points="${polyPts}" fill="none" stroke="${lineColor}" stroke-width="2.2"
          stroke-linejoin="round" stroke-linecap="round"/>
        ${hiDot}${loDot}
        <circle cx="${ex}" cy="${ey}" r="4.5" fill="${lineColor}" stroke="#0f1729" stroke-width="2"/>
        ${xLabels}
        <text x="${PAD.l}" y="${H - 8}" fill="#4a5568" font-size="8">Hand</text>
      </svg>`;
  }

  return { toggle, refresh };
})();
