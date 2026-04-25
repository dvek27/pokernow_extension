// ============================================================
// content.js — Runs on pokernow.club / pokernow.com
// ============================================================

(function () {
    'use strict';

    const RED_SUITS = new Set(['h', 'd']);
    let isEnabled = true;
    let overlayEl = null;
    let activeTab = 'winpct';
    let lastSnapshot = null;

    chrome.storage.local.get(['enabled', 'hudPos'], (res) => {
        isEnabled = res.enabled !== false;
        ensureOverlay();
        if (res.hudPos) applyOverlayPosition(res.hudPos);
        if (!isEnabled) hideOverlay();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'TOGGLE') {
            isEnabled = msg.value;
            if (isEnabled) { ensureOverlay(); showOverlay(); }
            else hideOverlay();
            sendResponse({ ok: true });
            return true;
        }
        if (msg.type === 'GET_GAME_DATA') {
            sendResponse(scrapeGameState());
            return true;
        }
        if (msg.type === 'DIAGNOSE') {
            sendResponse(diagnose());
            return true;
        }
        return false;
    });

    // ============================================================
    // Scraper — targets PokerNow's real DOM:
    //
    //   <div class="card-container card-s card-s-J flipped big">
    //      <div class="card-flipper">
    //         <div class="card">
    //            <span class="value">J</span>
    //            <span class="suit sub-suit">s</span>
    //            <span class="suit">s</span>
    //         </div>
    //      </div>
    //   </div>
    //
    // Primary signal = the ".card-container" classes:  `card-<suit> card-<suit>-<rank>`
    //   e.g. "card-s card-s-J"  →  J♠
    //        "card-c card-c-10" →  T♣
    //   Face-down opponent cards use "card-p1", "card-p2" etc → no rank → skip.
    //
    // Hero's seat: .you-player
    // Board: .table-cards
    // Opponents: .table-player (excluding .you-player and .table-player-empty)
    // ============================================================

    function normalizeRank(s) {
        if (s == null) return null;
        s = String(s).trim().toUpperCase();
        if (s === '10') return 'T';
        if (/^[2-9TJQKA]$/.test(s)) return s;
        return null;
    }

    function normalizeSuit(s) {
        if (!s) return null;
        s = String(s).trim().toLowerCase();
        if (s === 's' || s === '♠') return 's';
        if (s === 'h' || s === '♥') return 'h';
        if (s === 'd' || s === '♦') return 'd';
        if (s === 'c' || s === '♣') return 'c';
        return null;
    }

    /**
     * Primary parser: read rank & suit from a .card-container's class list.
     * Matches patterns like:
     *   "card-s card-s-J"    → Js
     *   "card-c card-c-10"   → Tc
     *   "card-h card-h-A"    → Ah
     *   "card-p1" / "card-p2" → face-down, returns null
     */
    function parseFromContainerClass(containerEl) {
        if (!containerEl) return null;
        const cls = typeof containerEl.className === 'string'
            ? containerEl.className
            : (containerEl.className.baseVal || '');
        // Match suit + rank: card-<shdc>-<rank>
        const m = cls.match(/\bcard-([shdc])-(10|[2-9TJQKA])\b/i);
        if (m) {
            const suit = normalizeSuit(m[1]);
            const rank = normalizeRank(m[2]);
            if (rank && suit) return rank + suit;
        }
        return null;
    }

    /**
     * Fallback: read from inner .card > .value + .suit spans.
     */
    function parseFromCardSpans(cardContainerEl) {
        if (!cardContainerEl) return null;
        const cardEl = cardContainerEl.querySelector('.card');
        if (!cardEl) return null;
        const valueEl = cardEl.querySelector('.value');
        let suitEl = cardEl.querySelector('.suit:not(.sub-suit)');
        if (!suitEl) suitEl = cardEl.querySelector('.suit');
        if (!valueEl || !suitEl) return null;
        const rank = normalizeRank(valueEl.textContent);
        const suit = normalizeSuit(suitEl.textContent);
        if (!rank || !suit) return null;
        return rank + suit;
    }

    function parseCardContainer(containerEl) {
        // Spans are AUTHORITATIVE. The container class list sometimes contains
        // multiple "card-<x>" tokens for sizing/styling, e.g.:
        //   "card-container card-d card-s-J flipped card-p1 med"
        // where the REAL suit is "d" (diamond) but the second match "card-s-J"
        // is a size variant (s = small). Reading it as suit=s is wrong.
        // The inner .card > .value + .suit spans always reflect the true card.
        const fromSpans = parseFromCardSpans(containerEl);
        if (fromSpans) return fromSpans;
        // Only fall back to class parsing if spans aren't readable (rare).
        return parseFromContainerClass(containerEl);
    }

    function findHoleCards() {
        const hero = document.querySelector('.you-player');
        if (!hero) return { cards: [], via: 'no .you-player found' };

        // Look anywhere inside the hero seat for .card-container elements
        const containers = hero.querySelectorAll('.card-container');
        const cards = [];
        for (const c of containers) {
            const parsed = parseCardContainer(c);
            if (parsed) cards.push(parsed);
        }
        // Deduplicate preserving order (animation sometimes renders duplicates)
        const seen = new Set();
        const unique = [];
        for (const c of cards) { if (!seen.has(c)) { seen.add(c); unique.push(c); } }

        if (unique.length >= 2) return { cards: unique.slice(0, 2), via: '.you-player (spans)' };
        if (unique.length === 1) return { cards: unique, via: '.you-player (partial)' };
        return {
            cards: [],
            via: `.you-player found but no parseable cards (${containers.length} containers)`
        };
    }

    function findBoardCards() {
        const root = document.querySelector('.table-cards')
            || document.querySelector('.community-cards')
            || document.querySelector('.board-cards');
        if (!root) return { cards: [], via: 'no board root' };

        const containers = root.querySelectorAll('.card-container');
        const cards = [];
        for (const c of containers) {
            const parsed = parseCardContainer(c);
            if (parsed) cards.push(parsed);
        }
        const seen = new Set();
        const unique = [];
        for (const c of cards) { if (!seen.has(c)) { seen.add(c); unique.push(c); } }
        return { cards: unique.slice(0, 5), via: 'table-cards' };
    }

    function classText(el) {
        if (!el) return '';
        return typeof el.className === 'string'
            ? el.className
            : (el.className?.baseVal || '');
    }

    function seatText(seat) {
        return (seat?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function findSeatCandidates() {
        const candidates = new Set();
        const selectors = [
            '.table-player',
            '[class~="table-player"]',
            '[class*="table-player-"]',
            '[class*="seat"]'
        ];
        for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(node => {
                if (node.closest('.table-cards, .community-cards, .board-cards')) return;
                candidates.add(node);
            });
        }

        // Keep real seat nodes, not the parent wrapper around all seats and
        // not nested controls inside a .table-player.
        return Array.from(candidates).filter(seat => {
            if (!looksLikeSeat(seat)) return false;
            if (!isPrimarySeat(seat)) {
                for (const other of candidates) {
                    if (other === seat) continue;
                    if (seat.contains(other) && looksLikeSeat(other)) return false;
                }
            }
            for (const other of candidates) {
                if (other === seat) continue;
                if (other.contains(seat) && isPrimarySeat(other)) return false;
            }
            return true;
        });
    }

    function isPrimarySeat(seat) {
        return /\btable-player\b|\byou-player\b/.test(classText(seat));
    }

    function looksLikeSeat(seat) {
        const cls = classText(seat);
        if (/\btable-player\b/.test(cls)) return true;
        if (/\byou-player\b/.test(cls)) return true;
        if (seat.querySelector('.card-container')) return true;
        return !!seat.querySelector(
            '.table-player-name, .player-name, .nickname, .username, [class*="player-name"], [class*="nickname"], [class*="username"]'
        );
    }

    function isHeroSeat(seat) {
        return /\byou-player\b/.test(classText(seat));
    }

    function isEmptySeat(seat) {
        const cls = classText(seat);
        const text = seatText(seat).toLowerCase();
        return /\btable-player-empty\b|\bempty\b|\bavailable\b|\bsit-here\b/.test(cls)
            || /\bsit here\b|\bopen seat\b|\bavailable\b/.test(text);
    }

    function isInactiveSeat(seat) {
        const cls = classText(seat);
        const text = seatText(seat).toLowerCase();
        return /\bfolded\b|\bfold\b|\bsitting-out\b|\bsit-out\b|\baway\b|\bstand-up\b/.test(cls)
            || /\bfolded\b|\bsitting out\b|\bsit out\b|\baway\b/.test(text);
    }

    function hasPlayerName(seat) {
        return !!seat.querySelector(
            '.table-player-name, .player-name, .nickname, .username, [class*="player-name"], [class*="nickname"], [class*="username"]'
        );
    }

    function hasDealtCards(seat) {
        return Array.from(seat.querySelectorAll('.card-container')).some(card => {
            const cls = classText(card);
            if (/\bplaceholder\b|\bempty\b/.test(cls)) return false;
            return /\bcard-(?:p\d+|[shdc](?:-(?:10|[2-9TJQKA]))?)\b/i.test(cls)
                || !!card.querySelector('.card');
        });
    }

    /**
     * Count opponents still playing the current hand.
     *
     * Occupied seats are not the same as active opponents: players who fold or
     * sit out usually keep their name/stack in the DOM. Prefer dealt cards as
     * the live-hand signal, then fall back to occupied seats only if no
     * opponent card containers are exposed yet.
     */
    function analyzeOpponentSeats() {
        const seats = findSeatCandidates();
        const rows = seats.map((seat, i) => {
            const isHero = isHeroSeat(seat);
            const isEmpty = isEmptySeat(seat);
            const isInactive = isInactiveSeat(seat);
            const cards = hasDealtCards(seat);
            const name = hasPlayerName(seat);
            const occupied = !isHero && !isEmpty && (name || cards);
            const active = occupied && !isInactive && cards;
            return {
                i,
                seat,
                cls: classText(seat),
                isHero,
                isEmpty,
                isInactive,
                hasName: name,
                hasCards: cards,
                occupied,
                active,
                nameTxt: (seat.querySelector('.table-player-name, .player-name, .nickname, .username, [class*="player-name"], [class*="nickname"], [class*="username"]')?.textContent || '').trim().slice(0, 30),
                textPreview: seatText(seat).slice(0, 60)
            };
        });
        const activeCount = rows.filter(row => row.active).length;
        const occupiedCount = rows.filter(row => row.occupied && !row.isInactive).length;
        return {
            rows,
            count: activeCount > 0 ? activeCount : Math.max(1, occupiedCount)
        };
    }

    function findOpponents() {
        return analyzeOpponentSeats().count;
    }

    function findBoardRoot() {
        return document.querySelector('.table-cards')
            || document.querySelector('.community-cards')
            || document.querySelector('.board-cards');
    }

    function scrapeGameState() {
        try {
            const hole = findHoleCards();
            const board = findBoardCards();
            const opponents = findOpponents();
            return {
                holeCards: hole.cards,
                boardCards: board.cards,
                opponents,
                playersPlaying: opponents + (hole.cards.length === 2 ? 1 : 0),
                active: hole.cards.length === 2,
                url: location.href,
                _diag: { holeVia: hole.via, boardVia: board.via }
            };
        } catch (e) {
            return { holeCards: [], boardCards: [], opponents: 1, active: false, error: e.message };
        }
    }

    // ============================================================
    // Diagnostic: dumps DOM hints so we can fix selectors
    // ============================================================
    function diagnose() {
        const out = { url: location.href, hits: [] };
        const suspectSelectors = [
            '.card', '[class*="card"]',
            '.you-player', '.table-player', '.your-hand', '.hero',
            '.table-cards', '.community-cards', '.board',
            '.player', '.seat'
        ];
        for (const sel of suspectSelectors) {
            try {
                const nodes = document.querySelectorAll(sel);
                if (nodes.length === 0) continue;
                const sample = Array.from(nodes).slice(0, 3).map(n => ({
                    tag: n.tagName,
                    cls: (typeof n.className === 'string' ? n.className : (n.className.baseVal || '')).slice(0, 200),
                    text: (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    html: n.outerHTML.slice(0, 300)
                }));
                out.hits.push({ selector: sel, count: nodes.length, sample });
            } catch (e) { /* ignore */ }
        }

        // Deep hero dump — list every .card-container inside .you-player
        const hero = document.querySelector('.you-player');
        out.heroDeep = { found: !!hero, containers: [] };
        if (hero) {
            const containers = hero.querySelectorAll('.card-container');
            out.heroDeep.containerCount = containers.length;
            Array.from(containers).forEach((c, i) => {
                const cls = typeof c.className === 'string' ? c.className : (c.className.baseVal || '');
                out.heroDeep.containers.push({
                    i,
                    cls,
                    parsedFromClass: parseFromContainerClass(c),
                    parsedFromSpans: parseFromCardSpans(c),
                    text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                    innerHtml: c.outerHTML.slice(0, 800)
                });
            });
            // Also show any .card elements inside hero
            const cards = hero.querySelectorAll('.card');
            out.heroDeep.cardElCount = cards.length;
        }

        // Opponent seat breakdown
        const opponentAnalysis = analyzeOpponentSeats();
        out.opponentDeep = {
            computedCount: opponentAnalysis.count,
            seats: opponentAnalysis.rows.map(row => ({
                i: row.i,
                cls: row.cls,
                isHero: row.isHero,
                isEmpty: row.isEmpty,
                isInactive: row.isInactive,
                hasName: row.hasName,
                hasCards: row.hasCards,
                occupied: row.occupied,
                active: row.active,
                nameTxt: row.nameTxt,
                textPreview: row.textPreview
            }))
        };

        out.scrape = scrapeGameState();
        return out;
    }

    // Expose for manual console use
    window.__pnDiagnose = diagnose;
    window.__pnScrape = scrapeGameState;

    // ============================================================
    // Overlay UI
    // ============================================================
    function ensureOverlay() {
        if (overlayEl && document.body && document.body.contains(overlayEl)) return;
        if (!document.body) { setTimeout(ensureOverlay, 200); return; }

        overlayEl = document.createElement('div');
        overlayEl.id = 'pn-odds-overlay';
        overlayEl.innerHTML = `
            <div class="pn-header" id="pn-drag">
              <span class="pn-logo">♠ ODDS</span>
              <div class="pn-tabs">
                <button class="pn-tab active" data-tab="winpct">WIN%</button>
                <button class="pn-tab" data-tab="preflop">PRE</button>
                <button class="pn-tab" data-tab="outs">OUTS</button>
                <button class="pn-tab" data-tab="recommend">REC</button>
              </div>
              <button class="pn-close" title="Hide">×</button>
            </div>
            <div class="pn-body" id="pn-body">
              <div class="pn-waiting">Waiting for cards...</div>
            </div>
            <div class="pn-drag-handle" id="pn-drag2">⋯ DRAG ⋯</div>
        `;
        document.body.appendChild(overlayEl);

        overlayEl.querySelectorAll('.pn-tab').forEach(t => {
            t.addEventListener('click', (e) => {
                e.stopPropagation();
                activeTab = t.dataset.tab;
                overlayEl.querySelectorAll('.pn-tab').forEach(x => x.classList.toggle('active', x === t));
                renderOverlay(lastSnapshot);
            });
        });

        overlayEl.querySelector('.pn-close').addEventListener('click', (e) => {
            e.stopPropagation();
            hideOverlay();
            chrome.storage.local.set({ enabled: false });
            isEnabled = false;
        });

        attachDrag(overlayEl.querySelector('#pn-drag'));
        attachDrag(overlayEl.querySelector('#pn-drag2'));
    }

    function showOverlay() { if (overlayEl) overlayEl.style.display = ''; }
    function hideOverlay() { if (overlayEl) overlayEl.style.display = 'none'; }

    function applyOverlayPosition(pos) {
        if (!overlayEl || !pos) return;
        overlayEl.style.top = pos.top + 'px';
        overlayEl.style.left = pos.left + 'px';
        overlayEl.style.right = 'auto';
    }

    function attachDrag(handle) {
        if (!handle) return;
        let dragging = false, offX = 0, offY = 0;
        handle.style.cursor = 'move';
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.pn-tab') || e.target.closest('.pn-close')) return;
            dragging = true;
            const rect = overlayEl.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
            overlayEl.style.right = 'auto';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - overlayEl.offsetWidth, e.clientX - offX));
            const y = Math.max(0, Math.min(window.innerHeight - overlayEl.offsetHeight, e.clientY - offY));
            overlayEl.style.left = x + 'px';
            overlayEl.style.top = y + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const rect = overlayEl.getBoundingClientRect();
            chrome.storage.local.set({ hudPos: { left: rect.left, top: rect.top } });
        });
    }

    // ============================================================
    // Rendering
    // ============================================================
    function cardHtml(c) {
        const suitChar = { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];
        const red = RED_SUITS.has(c[1]);
        return `<span class="pn-card ${red ? 'red' : 'black'}">${c[0]}${suitChar}</span>`;
    }

    function streetName(n) {
        return n === 0 ? 'PREFLOP' : n === 3 ? 'FLOP' : n === 4 ? 'TURN' : n === 5 ? 'RIVER' : '';
    }

    function renderWatchOut(warnings) {
        if (!warnings) return '';
        if (warnings.length === 0) {
            return `
              <div class="pn-nuts">
                <div class="pn-nuts-title">NUTS</div>
                <div class="pn-nuts-note">No possible opponent hand beats yours right now.</div>
              </div>
            `;
        }
        const rows = warnings.map(w => `
          <div class="pn-watch-row">
            <div class="pn-watch-hand">${w.label}</div>
            <div class="pn-watch-note">${w.probability}% · ${w.note}</div>
          </div>
        `).join('');
        return `
          <div class="pn-watchout">
            <div class="pn-watch-title">WATCH OUT</div>
            ${rows}
          </div>
        `;
    }

    function renderFairShare(winPct, playersPlaying) {
        const fair = 100 / Math.max(1, playersPlaying);
        const edge = winPct - fair;
        const edgeText = `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`;
        return `
          <div class="pn-fair-share ${edge >= 0 ? 'positive' : 'negative'}">
            <span>${winPct.toFixed(1)}% vs ${fair.toFixed(1)}% fair share</span>
            <strong>${edgeText} edge</strong>
          </div>
        `;
    }

    function buildRecommendation({ snap, winPct, tiePct, warnings, outs }) {
        const playersPlaying = snap.playersPlaying || snap.opponents + 1;
        const fair = 100 / Math.max(1, playersPlaying);
        const edge = winPct - fair;
        const postflop = snap.boardCards.length >= 3;
        const nuts = postflop && warnings && warnings.length === 0;
        const topThreat = warnings && warnings.length ? warnings[0].probability : 0;
        const weightedOuts = outs?.weightedOuts || 0;
        const drawOdds = outs?.approxOdds || 0;
        const cls = classifyPreflopHand(snap.holeCards[0], snap.holeCards[1]);

        let action = 'CHECK';
        let tone = 'neutral';
        let confidence = 'Medium';
        const reasons = [];

        if (!postflop) {
            if (cls.tier <= 1 || edge >= 22) {
                action = 'RAISE';
                tone = 'raise';
                reasons.push('premium preflop equity');
                reasons.push(`${edge >= 0 ? '+' : ''}${edge.toFixed(1)}% edge over fair share`);
            } else if (cls.tier === 2 || edge >= 8) {
                action = 'CALL / SMALL RAISE';
                tone = 'call';
                reasons.push('playable preflop edge');
                reasons.push('avoid bloating multiway pots without initiative');
            } else if (edge >= -3) {
                action = 'CHECK / CALL SMALL';
                tone = 'call';
                reasons.push('near fair-share equity');
                reasons.push('continue only at low price');
            } else {
                action = 'FOLD';
                tone = 'fold';
                confidence = 'High';
                reasons.push('below fair-share equity');
                reasons.push('weak ROI versus active players');
            }
        } else if (nuts) {
            action = 'RAISE';
            tone = 'raise';
            confidence = 'High';
            reasons.push('you currently have the nuts');
            reasons.push('maximize value while worse hands can continue');
        } else if (winPct >= 70 && edge >= 25 && topThreat < 18) {
            action = 'RAISE';
            tone = 'raise';
            confidence = 'High';
            reasons.push('large equity edge');
            reasons.push('low better-hand risk');
        } else if (winPct >= 55 && edge >= 12 && topThreat < 28) {
            action = 'RAISE / CALL';
            tone = 'raise';
            reasons.push('strong value edge');
            reasons.push('keep pressure, but respect heavy action');
        } else if (weightedOuts >= 8 && drawOdds >= 30 && topThreat < 35) {
            action = 'CALL / SEMI-BLUFF';
            tone = 'call';
            reasons.push(`${weightedOuts} equity-weighted outs`);
            reasons.push(`${drawOdds}% draw realization estimate`);
        } else if (winPct >= fair - 3 || tiePct >= 12) {
            action = 'CHECK / CALL SMALL';
            tone = 'call';
            reasons.push('near break-even equity');
            reasons.push('avoid large pots without a clear edge');
        } else {
            action = 'FOLD';
            tone = 'fold';
            confidence = weightedOuts < 4 ? 'High' : 'Medium';
            reasons.push(`${edge.toFixed(1)}% below fair share`);
            reasons.push(weightedOuts >= 4 ? 'continue only if price is very cheap' : 'not enough clean equity');
        }

        if (topThreat >= 30 && tone !== 'fold' && !nuts) {
            reasons.push(`${topThreat}% top better-hand risk`);
            if (tone === 'raise') action = action === 'RAISE' ? 'CALL / POT CONTROL' : action;
        }

        return {
            action,
            tone,
            confidence,
            fair,
            edge,
            reasons: reasons.slice(0, 3)
        };
    }

    function renderRecommendation(rec, winPct) {
        return `
          <div class="pn-rec-card ${rec.tone}">
            <div class="pn-rec-kicker">RECOMMENDATION</div>
            <div class="pn-rec-action">${rec.action}</div>
            <div class="pn-rec-meta">${rec.confidence} confidence · ${winPct.toFixed(1)}% win · ${rec.edge >= 0 ? '+' : ''}${rec.edge.toFixed(1)}% edge</div>
          </div>
          <div class="pn-rec-reasons">
            ${rec.reasons.map(reason => `<div class="pn-rec-reason">${reason}</div>`).join('')}
          </div>
          <div class="pn-rec-note">Heuristic only: pot odds, stack depth, position, and betting history can change the best action.</div>
        `;
    }

    function renderOverlay(snap) {
        if (!overlayEl) return;
        const body = overlayEl.querySelector('#pn-body');
        if (!snap || !snap.active) {
            body.innerHTML = `<div class="pn-waiting">Waiting for cards...</div>`;
            return;
        }

        const holeHtml = snap.holeCards.map(cardHtml).join('');
        const boardHtml = snap.boardCards.map(cardHtml).join('');
        const playersPlaying = snap.playersPlaying || snap.opponents + 1;
        const warnings = snap.boardCards.length >= 3 && typeof possibleBetterHands === 'function'
            ? possibleBetterHands(snap.holeCards, snap.boardCards, 4, snap.opponents)
            : null;

        if (activeTab === 'winpct') {
            body.innerHTML = `
              <div class="pn-cards-row">${holeHtml}</div>
              ${snap.boardCards.length ? `<div class="pn-cards-row">${boardHtml}</div>` : ''}
              <div class="pn-street-badge">${streetName(snap.boardCards.length)} · ${playersPlaying} PLAYING</div>
              <div class="pn-calculating"><span class="pn-spinner"></span>calculating odds...</div>
            `;

            // Increased to 5000 iterations for stability
            setTimeout(() => {
                if (!overlayEl) return;
                try {
                    const res = simulateOdds(snap.holeCards, snap.boardCards, snap.opponents, 5000);
                    const winPct = parseFloat(res.win);

                    let distHtml = '<div class="pn-dist-table">';
                    Object.entries(res.handDist).reverse().forEach(([name, pct]) => {
                        distHtml += `
                          <div class="pn-dist-row">
                            <span>${name}</span>
                            <span class="pn-dist-val">${pct}%</span>
                          </div>`;
                    });
                    distHtml += '</div>';

                    body.innerHTML = `
                      <div class="pn-cards-row">${holeHtml}</div>
                      ${snap.boardCards.length ? `<div class="pn-cards-row">${boardHtml}</div>` : ''}
                      <div class="pn-street-badge">${streetName(snap.boardCards.length)} · ${playersPlaying} PLAYING</div>
                      <div class="pn-odds-grid">
                        <div class="pn-odds-cell win">
                          <div class="pn-odds-pct">${res.win}%</div>
                          <div class="pn-odds-label">WIN</div>
                        </div>
                        <div class="pn-odds-cell tie">
                          <div class="pn-odds-pct">${res.tie}%</div>
                          <div class="pn-odds-label">TIE</div>
                        </div>
                      </div>
                      <div class="pn-bar wide"><div class="pn-bar-fill win-fill" style="width:${res.win}%"></div></div>
                      ${renderFairShare(winPct, playersPlaying)}
                      ${renderWatchOut(warnings)}
                      ${distHtml}
                    `;
                } catch (err) {
                    body.innerHTML = `<div class="pn-error">Simulation Error</div>`;
                }
            }, 10);
        }
        else if (activeTab === 'preflop') {
            const cls = classifyPreflopHand(snap.holeCards[0], snap.holeCards[1]);
            const eq = preflopEquity(cls.tier, snap.opponents);
            const strengthPct = (100 - (cls.tier - 1) * 25);

            body.innerHTML = `
              <div class="pn-cards-row">${holeHtml}</div>
              <div class="pn-hand-label" style="color:${cls.color}">${cls.label}</div>
              <div class="pn-strength-meter">
                <div class="pn-strength-fill" style="width:${strengthPct}%; background:${cls.color}"></div>
              </div>
              <div class="pn-equity-block">
                <div class="pn-equity-pct">${eq}%</div>
                <div class="pn-equity-sub">POT EQUITY vs ${snap.opponents} OPP</div>
              </div>
              <div class="pn-preflop-tips" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
                <strong>STRATEGY:</strong> ${cls.tier <= 2 ? 'Play aggressively.' : 'Play cautiously.'}
              </div>
            `;
        }
        else if (activeTab === 'outs') {
            if (snap.boardCards.length < 3) {
                body.innerHTML = `<div class="pn-waiting">Flop needed for outs...</div>`;
                return;
            }
            const o = calculateOuts(snap.holeCards, snap.boardCards, snap.opponents);
            const oddsText = o.approxOdds > 0 ? `${(100/o.approxOdds).toFixed(1)}:1` : 'N/A';
            body.innerHTML = `
              <div class="pn-draw-type">${o.drawLabel}</div>
              <div class="pn-outs-main" style="margin-bottom:0">
                <div class="pn-outs-count">${o.weightedOuts}</div>
                <div class="pn-outs-label">EQUITY-WEIGHTED OUTS</div>
              </div>
              <div class="pn-outs-detail">
                ${o.outs} clean · ${o.marginalOuts} partial · ${o.dirtyOuts} dirty
              </div>
              ${o.cleanCards ? `<div class="pn-outs-cards">Clean: ${o.cleanCards}</div>` : ''}
              ${o.marginalCards ? `<div class="pn-outs-cards">Partial: ${o.marginalCards}</div>` : ''}
              <div class="pn-outs-grid">
                <div class="pn-outs-card">
                  <div class="pn-rule-pct">${o.approxOdds}%</div>
                  <div class="pn-rule-sub">PROBABILITY</div>
                </div>
                <div class="pn-outs-card">
                  <div class="pn-rule-pct">${oddsText}</div>
                  <div class="pn-rule-sub">ODDS</div>
                </div>
              </div>
              ${renderWatchOut(o.warning || warnings)}
            `;
        }
        else if (activeTab === 'recommend') {
            body.innerHTML = `
              <div class="pn-cards-row">${holeHtml}</div>
              ${snap.boardCards.length ? `<div class="pn-cards-row">${boardHtml}</div>` : ''}
              <div class="pn-street-badge">${streetName(snap.boardCards.length)} · ${playersPlaying} PLAYING</div>
              <div class="pn-calculating"><span class="pn-spinner"></span>building recommendation...</div>
            `;

            setTimeout(() => {
                if (!overlayEl) return;
                try {
                    const res = simulateOdds(snap.holeCards, snap.boardCards, snap.opponents, 4000);
                    const winPct = parseFloat(res.win);
                    const tiePct = parseFloat(res.tie);
                    const outs = snap.boardCards.length >= 3
                        ? calculateOuts(snap.holeCards, snap.boardCards, snap.opponents)
                        : null;
                    const rec = buildRecommendation({ snap, winPct, tiePct, warnings, outs });
                    body.innerHTML = `
                      <div class="pn-cards-row">${holeHtml}</div>
                      ${snap.boardCards.length ? `<div class="pn-cards-row">${boardHtml}</div>` : ''}
                      <div class="pn-street-badge">${streetName(snap.boardCards.length)} · ${playersPlaying} PLAYING</div>
                      ${renderRecommendation(rec, winPct)}
                      ${renderFairShare(winPct, playersPlaying)}
                      ${renderWatchOut(warnings)}
                    `;
                } catch (err) {
                    body.innerHTML = `<div class="pn-error">Recommendation Error</div>`;
                }
            }, 10);
        }
    }

    function snapshotKey(s) {
        if (!s) return '';
        return s.holeCards.join(',') + '|' + s.boardCards.join(',') + '|' + s.opponents + '|' + s.active;
    }

    setInterval(() => {
        if (!isEnabled) return;
        ensureOverlay();
        const snap = scrapeGameState();
        const key = snapshotKey(snap);
        const lastKey = snapshotKey(lastSnapshot);
        if (key !== lastKey) {
            lastSnapshot = snap;
            renderOverlay(snap);
        }
    }, 1500);

    console.log('PokerNow Odds HUD loaded. Run __pnDiagnose() in console to inspect DOM.');
})();
