// ============================================================
// popup.js — Popup controller
// Handles: tab switching, manual calculator, live HUD data, toggle
// ============================================================

// ---------- Inlined poker engine (popup can't share content-script globals) ----------
const RANK_MAP = { '2':0, '3':1, '4':2, '5':3, '6':4, '7':5, '8':6, '9':7, 'T':8, 'J':9, 'Q':10, 'K':11, 'A':12 };
const SUIT_MAP = { 's':0, 'h':1, 'd':2, 'c':3 };
const RED_SUITS = new Set(['h', 'd']);

function cardToInt(str) {
    return (RANK_MAP[str[0]] << 2) | SUIT_MAP[str[1]];
}

function evaluateHand(cards) {
    let suitCounts = [0, 0, 0, 0], rankCounts = new Array(13).fill(0), suitRanks = [[], [], [], []];
    for (let i = 0; i < cards.length; i++) {
        let r = cards[i] >> 2, s = cards[i] & 3;
        rankCounts[r]++;
        suitCounts[s]++;
        suitRanks[s].push(r);
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) { if (suitCounts[s] >= 5) { flushSuit = s; break; } }
    if (flushSuit !== -1) {
        let fRanks = suitRanks[flushSuit].sort((a,b) => b - a);
        let sfHigh = getStraight(fRanks);
        if (sfHigh !== -1) return (8 << 24) | (sfHigh << 20);
        return (5 << 24) | (fRanks[0]<<20) | (fRanks[1]<<16) | (fRanks[2]<<12) | (fRanks[3]<<8) | fRanks[4];
    }
    let quads = -1, trips = -1, pairs = [], uniqueRanks = [];
    for (let r = 12; r >= 0; r--) {
        if (rankCounts[r] > 0) {
            uniqueRanks.push(r);
            if (rankCounts[r] === 4) quads = r;
            else if (rankCounts[r] === 3) { if (trips === -1) trips = r; else pairs.push(r); }
            else if (rankCounts[r] === 2) pairs.push(r);
        }
    }
    if (quads !== -1) {
        let kicker = uniqueRanks[0] === quads ? (uniqueRanks[1]||0) : uniqueRanks[0];
        return (7 << 24) | (quads << 20) | (kicker << 16);
    }
    if (trips !== -1 && pairs.length > 0) return (6 << 24) | (trips << 20) | (pairs[0] << 16);
    let sHigh = getStraight(uniqueRanks);
    if (sHigh !== -1) return (4 << 24) | (sHigh << 20);
    if (trips !== -1) {
        let k1 = uniqueRanks[0] === trips ? (uniqueRanks[1]||0) : uniqueRanks[0];
        let k2 = uniqueRanks[0] === trips ? (uniqueRanks[2]||0) : (uniqueRanks[1] === trips ? (uniqueRanks[2]||0) : (uniqueRanks[1]||0));
        return (3 << 24) | (trips << 20) | (k1 << 16) | (k2 << 12);
    }
    if (pairs.length >= 2) {
        let k = -1;
        for (let r of uniqueRanks) { if (r !== pairs[0] && r !== pairs[1]) { k = r; break; } }
        return (2 << 24) | (pairs[0] << 20) | (pairs[1] << 16) | ((k === -1 ? 0 : k) << 12);
    }
    if (pairs.length === 1) {
        let k1 = 0, k2 = 0, k3 = 0, idx = 0;
        for (let r of uniqueRanks) {
            if (r !== pairs[0]) {
                if (idx===0) k1=r; else if (idx===1) k2=r; else if (idx===2) { k3=r; break; }
                idx++;
            }
        }
        return (1 << 24) | (pairs[0] << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8);
    }
    return (0 << 24) | (uniqueRanks[0]<<20) | (uniqueRanks[1]<<16) | (uniqueRanks[2]<<12) | (uniqueRanks[3]<<8) | uniqueRanks[4];
}

function getStraight(ranks) {
    if (ranks.length < 5) return -1;
    let consec = 1;
    for (let i = 0; i < ranks.length - 1; i++) {
        if (ranks[i] === ranks[i+1] + 1) {
            consec++;
            if (consec === 5) return ranks[i-3];
        } else if (ranks[i] !== ranks[i+1]) consec = 1;
    }
    if (ranks[0] === 12 && ranks.includes(3) && ranks.includes(2) && ranks.includes(1) && ranks.includes(0)) return 3;
    return -1;
}

function simulateOdds(holeCardsStr, boardCardsStr, numOpponents, iterations = 4000) {
    const hole = holeCardsStr.map(cardToInt);
    const board = boardCardsStr.map(cardToInt);
    const known = new Set([...hole, ...board]);
    const deck = [];
    for (let i = 0; i < 52; i++) { if (!known.has(i)) deck.push(i); }
    let wins = 0, ties = 0;
    const boardNeeded = 5 - board.length;
    const cardsNeeded = boardNeeded + (numOpponents * 2);
    for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < cardsNeeded; j++) {
            const rand = j + Math.floor(Math.random() * (deck.length - j));
            const temp = deck[j]; deck[j] = deck[rand]; deck[rand] = temp;
        }
        let dIdx = 0;
        const runBoard = [...board];
        for(let k = 0; k < boardNeeded; k++) runBoard.push(deck[dIdx++]);
        const myScore = evaluateHand([...hole, ...runBoard]);
        let iWin = true, isTie = false;
        for (let o = 0; o < numOpponents; o++) {
            const oppScore = evaluateHand([deck[dIdx++], deck[dIdx++], ...runBoard]);
            if (oppScore > myScore) { iWin = false; isTie = false; break; }
            else if (oppScore === myScore) isTie = true;
        }
        if (iWin && !isTie) wins++; else if (isTie) ties++;
    }
    return {
        win: (wins / iterations * 100).toFixed(1),
        tie: (ties / iterations * 100).toFixed(1),
        lose: ((iterations - wins - ties) / iterations * 100).toFixed(1)
    };
}

// ---------- Card input validation ----------
function isValidCard(str) {
    if (!str || str.length !== 2) return false;
    const r = str[0].toUpperCase();
    const s = str[1].toLowerCase();
    return RANK_MAP[r] !== undefined && SUIT_MAP[s] !== undefined;
}

function normalizeCard(str) {
    if (!str || str.length < 2) return '';
    return str[0].toUpperCase() + str[1].toLowerCase();
}

function cardToDisplay(card) {
    const suitChar = { s: '♠', h: '♥', d: '♦', c: '♣' }[card[1]];
    return card[0] + suitChar;
}

function fairShareHtml(winPct, playersPlaying) {
    const fair = 100 / Math.max(1, playersPlaying);
    const edge = winPct - fair;
    const edgeText = `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`;
    return `
        <div class="result-fair-share ${edge >= 0 ? 'positive' : 'negative'}">
          <span>${winPct.toFixed(1)}% vs ${fair.toFixed(1)}% fair share</span>
          <strong>${edgeText} edge</strong>
        </div>
    `;
}

// ============================================================
// DOM setup
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    // ---------- Tab switching ----------
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.panel;
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            panels.forEach(p => p.classList.toggle('active', p.id === `panel-${target}`));
        });
    });

    // ---------- Master HUD toggle ----------
    const masterToggle = document.getElementById('masterToggle');
    chrome.storage.local.get(['enabled'], (res) => {
        masterToggle.checked = res.enabled !== false;
    });
    masterToggle.addEventListener('change', () => {
        const isEnabled = masterToggle.checked;
        chrome.storage.local.set({ enabled: isEnabled });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE', value: isEnabled })
                    .catch(() => { /* content script may not be loaded; ignore */ });
            }
        });
    });

    // ---------- Status bar ----------
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    function setStatus(state, text) {
        statusDot.className = 'status-dot ' + state;
        statusText.textContent = text;
    }

    // ---------- Manual calculator ----------
    const hole1 = document.getElementById('hole1');
    const hole2 = document.getElementById('hole2');
    const boardInputs = document.querySelectorAll('.board-card');
    const opponentCountEl = document.getElementById('opponentCount');
    const incBtn = document.getElementById('incOpponents');
    const decBtn = document.getElementById('decOpponents');
    const calcBtn = document.getElementById('calcBtn');
    const resultsEl = document.getElementById('results');

    let opponents = 1;

    function updateOpponentDisplay() {
        opponentCountEl.textContent = opponents;
    }

    incBtn.addEventListener('click', () => {
        if (opponents < 8) { opponents++; updateOpponentDisplay(); }
    });
    decBtn.addEventListener('click', () => {
        if (opponents > 1) { opponents--; updateOpponentDisplay(); }
    });

    // Card input styling (valid / red)
    function styleCardInput(input) {
        const val = input.value.trim();
        input.classList.remove('valid', 'red-card');
        if (val.length === 0) return;
        const normalized = normalizeCard(val);
        if (isValidCard(normalized)) {
            input.classList.add('valid');
            if (RED_SUITS.has(normalized[1])) input.classList.add('red-card');
        }
    }

    [hole1, hole2, ...boardInputs].forEach(input => {
        input.addEventListener('input', () => styleCardInput(input));
        input.addEventListener('blur', () => {
            if (input.value) input.value = normalizeCard(input.value.trim());
            styleCardInput(input);
        });
    });

    function runManualCalculation() {
        const h1 = normalizeCard(hole1.value.trim());
        const h2 = normalizeCard(hole2.value.trim());

        if (!isValidCard(h1) || !isValidCard(h2)) {
            resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Enter two valid hole cards (e.g. Ah Kd)</div>`;
            return;
        }
        if (h1 === h2) {
            resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Hole cards must be different</div>`;
            return;
        }

        const board = [];
        for (const inp of boardInputs) {
            const v = normalizeCard(inp.value.trim());
            if (v === '') continue;
            if (!isValidCard(v)) {
                resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Invalid board card: "${inp.value}"</div>`;
                return;
            }
            board.push(v);
        }

        // Duplicate check
        const all = [h1, h2, ...board];
        if (new Set(all).size !== all.length) {
            resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Duplicate cards detected</div>`;
            return;
        }

        // Board can be 0, 3, 4 or 5 cards
        if (board.length !== 0 && board.length < 3) {
            resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Board must have 0, 3, 4, or 5 cards</div>`;
            return;
        }

        resultsEl.innerHTML = `<div class="empty-state"><span class="spin"></span>Simulating...</div>`;

        // Defer so spinner can paint
        setTimeout(() => {
            try {
                const res = simulateOdds([h1, h2], board, opponents, 5000);
                const playersPlaying = opponents + 1;
                const winPct = parseFloat(res.win);
                const street = board.length === 0 ? 'PREFLOP' :
                    board.length === 3 ? 'FLOP' :
                        board.length === 4 ? 'TURN' : 'RIVER';

                const cardsHtml = [h1, h2].map(c => {
                    const red = RED_SUITS.has(c[1]);
                    return `<span class="mini-card ${red ? 'red' : 'black'}">${cardToDisplay(c)}</span>`;
                }).join(' ');

                resultsEl.innerHTML = `
                    <div class="result-card">
                      <div class="result-hand-info">
                        <div>${cardsHtml}</div>
                        <div class="result-street">${street}</div>
                      </div>
                      <div class="result-odds-row">
                        <div class="result-odds-item">
                          <div class="result-pct c-win">${res.win}%</div>
                          <div class="result-lbl">WIN</div>
                        </div>
                        <div class="result-odds-item">
                          <div class="result-pct c-tie">${res.tie}%</div>
                          <div class="result-lbl">TIE</div>
                        </div>
                        <div class="result-odds-item">
                          <div class="result-pct c-lose">${res.lose}%</div>
                          <div class="result-lbl">LOSE</div>
                        </div>
                      </div>
                      <div class="result-bar-track">
                        <div class="result-bar-fill" style="width:${res.win}%"></div>
                      </div>
                      ${fairShareHtml(winPct, playersPlaying)}
                    </div>
                `;
            } catch (err) {
                resultsEl.innerHTML = `<div class="empty-state" style="color:var(--red)">Error: ${err.message}</div>`;
            }
        }, 30);
    }

    calcBtn.addEventListener('click', runManualCalculation);

    // Enter key submits
    [hole1, hole2, ...boardInputs].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runManualCalculation();
        });
    });

    updateOpponentDisplay();

    // ---------- Live HUD data polling ----------
    const liveDataEl = document.getElementById('liveData');
    let pollTimer = null;

    function renderLiveEmpty(msg) {
        liveDataEl.innerHTML = `<div class="empty-state">${msg}</div>`;
    }

    function renderLive(data, results) {
        const playersPlaying = data.playersPlaying || data.opponents + 1;
        const winPct = parseFloat(results.win);
        const cardsHtml = data.holeCards.map(c => {
            const red = RED_SUITS.has(c[1]);
            return `<span class="mini-card ${red ? 'red' : 'black'}">${cardToDisplay(c)}</span>`;
        }).join(' ');

        const boardHtml = data.boardCards.length > 0
            ? data.boardCards.map(c => {
                const red = RED_SUITS.has(c[1]);
                return `<span class="mini-card ${red ? 'red' : 'black'}">${cardToDisplay(c)}</span>`;
            }).join(' ')
            : '<span style="color:var(--muted);font-size:10px">preflop</span>';

        const street = data.boardCards.length === 0 ? 'PREFLOP' :
            data.boardCards.length === 3 ? 'FLOP' :
                data.boardCards.length === 4 ? 'TURN' : 'RIVER';

        liveDataEl.innerHTML = `
            <div class="result-card">
              <div class="result-hand-info">
                <div>${cardsHtml}</div>
                <div class="result-street">${street} · ${playersPlaying} PLAYING</div>
              </div>
              <div style="margin:6px 0 8px;">${boardHtml}</div>
              <div class="result-odds-row">
                <div class="result-odds-item">
                  <div class="result-pct c-win">${results.win}%</div>
                  <div class="result-lbl">WIN</div>
                </div>
                <div class="result-odds-item">
                  <div class="result-pct c-tie">${results.tie}%</div>
                  <div class="result-lbl">TIE</div>
                </div>
                <div class="result-odds-item">
                  <div class="result-pct c-lose">${results.lose}%</div>
                  <div class="result-lbl">LOSE</div>
                </div>
              </div>
              <div class="result-bar-track">
                <div class="result-bar-fill" style="width:${results.win}%"></div>
              </div>
              ${fairShareHtml(winPct, playersPlaying)}
            </div>
        `;
    }

    function pollLive() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab || !tab.url) {
                setStatus('inactive', 'No active tab');
                renderLiveEmpty('No active tab');
                return;
            }
            const isPokerNow = tab.url.includes('pokernow.club') || tab.url.includes('pokernow.com');
            if (!isPokerNow) {
                setStatus('inactive', 'Not on PokerNow');
                renderLiveEmpty('Open pokernow.club to see live data');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { type: 'GET_GAME_DATA' }, (response) => {
                if (chrome.runtime.lastError) {
                    setStatus('inactive', 'Content script not loaded — refresh PokerNow');
                    renderLiveEmpty('Refresh the PokerNow page to activate the HUD');
                    return;
                }
                if (!response) {
                    setStatus('inactive', 'No response from page');
                    renderLiveEmpty('Waiting for page...');
                    return;
                }
                if (!response.active) {
                    setStatus('active', 'Connected · waiting for hand');
                    renderLiveEmpty('Waiting for your hole cards...');
                    return;
                }

                const playersPlaying = response.playersPlaying || response.opponents + 1;
                setStatus('active', `Connected · ${playersPlaying} playing`);
                try {
                    const results = simulateOdds(response.holeCards, response.boardCards, response.opponents, 3000);
                    renderLive(response, results);
                } catch (err) {
                    renderLiveEmpty(`Error: ${err.message}`);
                }
            });
        });
    }

    // ---------- Diagnose button ----------
    const diagnoseBtn = document.getElementById('diagnoseBtn');
    const diagOut = document.getElementById('diagOut');
    if (diagnoseBtn) {
        diagnoseBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.url ||
                    (!tab.url.includes('pokernow.club') && !tab.url.includes('pokernow.com'))) {
                    diagOut.style.display = 'block';
                    diagOut.textContent = 'Open a PokerNow game tab first.';
                    return;
                }
                chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' }, (resp) => {
                    diagOut.style.display = 'block';
                    if (chrome.runtime.lastError) {
                        diagOut.textContent = 'Error: ' + chrome.runtime.lastError.message +
                            '\n\nTry refreshing the PokerNow page.';
                        return;
                    }
                    if (!resp) {
                        diagOut.textContent = 'No response from content script. Refresh PokerNow.';
                        return;
                    }
                    let txt = 'URL: ' + resp.url + '\n\n';
                    txt += 'SCRAPE RESULT:\n' + JSON.stringify(resp.scrape, null, 2) + '\n\n';

                    if (resp.heroDeep) {
                        txt += 'HERO DEEP DUMP:\n';
                        txt += '  .you-player found: ' + resp.heroDeep.found + '\n';
                        txt += '  .card-container count: ' + (resp.heroDeep.containerCount ?? 0) + '\n';
                        txt += '  inner .card count: ' + (resp.heroDeep.cardElCount ?? 0) + '\n';
                        (resp.heroDeep.containers || []).forEach(c => {
                            txt += `\n  [container ${c.i}]\n`;
                            txt += `    cls: ${c.cls}\n`;
                            txt += `    text: ${c.text}\n`;
                            txt += `    → parsed from class: ${c.parsedFromClass}\n`;
                            txt += `    → parsed from spans: ${c.parsedFromSpans}\n`;
                            txt += `    html: ${c.innerHtml}\n`;
                        });
                        txt += '\n';
                    }

                    if (resp.opponentDeep) {
                        txt += 'OPPONENT SEAT BREAKDOWN:\n';
                        txt += '  computed opponent count: ' + resp.opponentDeep.computedCount + '\n';
                        (resp.opponentDeep.seats || []).forEach(s => {
                            txt += `\n  [seat ${s.i}] ${s.isHero ? '(HERO)' : s.isEmpty ? '(EMPTY)' : s.isInactive ? '(INACTIVE)' : s.active ? '(ACTIVE)' : ''}\n`;
                            txt += `    cls: ${s.cls}\n`;
                            txt += `    hasName: ${s.hasName} · hasCards: ${s.hasCards} · occupied: ${s.occupied} · active: ${s.active}\n`;
                            txt += `    nameTxt: "${s.nameTxt}"\n`;
                            txt += `    text: ${s.textPreview}\n`;
                        });
                        txt += '\n';
                    }

                    txt += 'DOM HITS:\n';
                    for (const hit of resp.hits) {
                        txt += '\n▶ ' + hit.selector + '  (' + hit.count + ')\n';
                        hit.sample.forEach((s, i) => {
                            txt += `  [${i}] <${s.tag}> class="${s.cls}"\n`;
                            txt += `      text: ${s.text}\n`;
                            txt += `      html: ${s.html}\n`;
                        });
                    }
                    diagOut.textContent = txt;
                });
            });
        });
    }

    // Initial status check
    setStatus('inactive', 'Checking page...');
    pollLive();
    pollTimer = setInterval(pollLive, 2000);

    window.addEventListener('unload', () => {
        if (pollTimer) clearInterval(pollTimer);
    });
});
