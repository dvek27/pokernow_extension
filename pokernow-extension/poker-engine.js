// poker-engine.js — Core hand evaluation & odds calculator with optimizations
// ============================================================

const RANK_MAP = { '2':0, '3':1, '4':2, '5':3, '6':4, '7':5, '8':6, '9':7, 'T':8, 'J':9, 'Q':10, 'K':11, 'A':12 };
const SUIT_MAP = { 's':0, 'h':1, 'd':2, 'c':3 };
const HAND_NAMES = ["High Card", "Pair", "Two Pair", "Trips", "Straight", "Flush", "Full House", "Quads", "Str. Flush"];
const INT_TO_RANK = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const INT_TO_SUIT = ['s','h','d','c'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

function cardToInt(str) {
    return (RANK_MAP[str[0]] << 2) | SUIT_MAP[str[1]];
}

function intToCard(card) {
    return INT_TO_RANK[card >> 2] + INT_TO_SUIT[card & 3];
}

function makeDeck(excluded = []) {
    const known = new Set(excluded);
    const deck = [];
    for (let i = 0; i < 52; i++) { if (!known.has(i)) deck.push(i); }
    return deck;
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

function simulateOdds(holeCardsStr, boardCardsStr, numOpponents, iterations = 5000) {
    const hole = holeCardsStr.map(cardToInt);
    const board = boardCardsStr.map(cardToInt);
    const known = new Set([...hole, ...board]);
    const deck = [];
    for (let i = 0; i < 52; i++) { if (!known.has(i)) deck.push(i); }

    let wins = 0, ties = 0;
    let handCounts = new Array(9).fill(0);

    // Simulation loop
    for (let i = 0; i < iterations; i++) {
        // FIX 1: Clone the deck so we don't destroy it across iterations
        let shuffledDeck = shuffleDeck([...deck]);

        // Deal remaining cards for the board and opponents
        const runBoard = [...board, ...dealBoard(shuffledDeck, 5 - board.length)];
        let myFullHand = [...hole, ...runBoard];
        let myScore = evaluateHand(myFullHand);

        // Track opponent hand evaluations
        let opponentHands = [];
        for (let o = 0; o < numOpponents; o++) {
            let opponentHand = [shuffledDeck.pop(), shuffledDeck.pop(), ...runBoard];
            opponentHands.push(evaluateHand(opponentHand));
        }

        // Check results: compare hands
        let result = checkWinner(myScore, opponentHands);
        wins += result.wins;
        ties += result.ties;

        // Collect hand rankings for advanced distribution
        handCounts[myScore >> 24]++;
    }

    return computeFinalResults(wins, ties, handCounts, iterations);
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function dealBoard(deck, cardsNeeded) {
    return deck.splice(0, cardsNeeded);
}

function checkWinner(myScore, opponentScores) {
    let wins = 0, ties = 0;
    for (let i = 0; i < opponentScores.length; i++) {
        if (opponentScores[i] > myScore) return { wins: 0, ties: 0 };
        else if (opponentScores[i] === myScore) ties++;
    }
    // FIX 2: Mutually exclusive win and tie conditions
    return { wins: ties === 0 ? 1 : 0, ties: ties > 0 ? 1 : 0 };
}

function computeFinalResults(wins, ties, handCounts, iterations) {
    const handDist = {};
    for(let r=0; r<9; r++) {
        const pct = (handCounts[r] / iterations * 100);
        if (pct > 0.5) handDist[HAND_NAMES[r]] = pct.toFixed(1);
    }

    return {
        win: (wins / iterations * 100).toFixed(1),
        tie: (ties / iterations * 100).toFixed(1),
        lose: ((iterations - wins - ties) / iterations * 100).toFixed(1),
        handDist
    };
}

function equityVsRandomHands(hole, board, opponents = 1, iterations = 500) {
    const known = new Set([...hole, ...board]);
    const deck = makeDeck([...known]);
    const boardNeeded = 5 - board.length;
    let wins = 0, ties = 0;

    for (let i = 0; i < iterations; i++) {
        const shuffledDeck = shuffleDeck([...deck]);
        const runBoard = [...board, ...dealBoard(shuffledDeck, boardNeeded)];
        const myScore = evaluateHand([...hole, ...runBoard]);
        let ahead = true, tied = false;

        for (let o = 0; o < opponents; o++) {
            const oppScore = evaluateHand([shuffledDeck.pop(), shuffledDeck.pop(), ...runBoard]);
            if (oppScore > myScore) { ahead = false; tied = false; break; }
            if (oppScore === myScore) tied = true;
        }

        if (ahead && !tied) wins++;
        else if (tied) ties++;
    }

    return (wins + ties * 0.5) / iterations;
}

function boardStats(cards) {
    const suitCounts = [0, 0, 0, 0];
    const rankCounts = new Array(13).fill(0);
    for (const card of cards) {
        suitCounts[card & 3]++;
        rankCounts[card >> 2]++;
    }
    return { suitCounts, rankCounts };
}

function possibleBetterHands(holeCardsStr, boardCardsStr, limit = 4, numOpponents = 1) {
    if (boardCardsStr.length < 3) return [];
    const hole = holeCardsStr.map(cardToInt);
    const board = boardCardsStr.map(cardToInt);
    const heroScore = evaluateHand([...hole, ...board]);
    const heroRank = heroScore >> 24;
    const deck = makeDeck([...hole, ...board]);
    const totalCombos = deck.length * (deck.length - 1) / 2;
    const opponents = Math.max(1, numOpponents || 1);
    const better = new Map();

    for (let i = 0; i < deck.length; i++) {
        for (let j = i + 1; j < deck.length; j++) {
            const oppHole = [deck[i], deck[j]];
            const score = evaluateHand([...oppHole, ...board]);
            if (score <= heroScore) continue;

            const rank = score >> 24;
            const name = HAND_NAMES[rank];
            const key = name;
            const item = better.get(key) || {
                rank,
                label: name,
                examples: [],
                combos: 0
            };
            item.combos++;
            if (item.examples.length < 2) {
                item.examples.push(oppHole.map(intToCard).join(' '));
            }
            better.set(key, item);
        }
    }

    const { suitCounts, rankCounts } = boardStats(board);
    const texture = [];
    const flushSuit = suitCounts.findIndex(c => c >= 3);
    if (flushSuit !== -1 && heroRank < 5) {
        texture.push(`${SUIT_NAMES[flushSuit]} flushes are live`);
    }
    if (rankCounts.some(c => c >= 2) && heroRank < 6) {
        texture.push('paired board can make full houses');
    }

    return Array.from(better.values())
        .sort((a, b) => b.combos - a.combos || b.rank - a.rank)
        .slice(0, limit)
        .map(item => ({
            probability: Math.round((1 - Math.pow(1 - item.combos / totalCombos, opponents)) * 100),
            label: item.label,
            combos: item.combos,
            examples: item.examples,
            note: texture.shift() || `${item.combos} possible combo${item.combos === 1 ? '' : 's'}`
        }));
}

const PREFLOP_EQ = { 1:[85,72,64,56,51,47,43,40], 2:[70,58,49,42,37,33,30,28], 3:[62,48,39,33,29,26,24,22], 4:[54,39,31,26,22,20,18,16] };
function classifyPreflopHand(c1, c2) {
    const r1 = RANK_MAP[c1[0]], r2 = RANK_MAP[c2[0]];
    const suited = c1[1] === c2[1], paired = r1 === r2;
    const high = Math.max(r1, r2), low = Math.min(r1, r2);

    if (paired) {
        if (high >= 10) return { tier: 1, label: 'Premium Pair', color: '#10b981' };
        if (high >= 7) return { tier: 2, label: 'Mid Pair', color: '#34d399' };
        return { tier: 3, label: 'Small Pair', color: '#f59e0b' };
    }
    if (high === 12) {
        if (low >= 10) return { tier: 1, label: 'Premium Ace', color: '#10b981' };
        if (suited) return { tier: 2, label: 'Suited Ace', color: '#34d399' };
        return { tier: 3, label: 'Offsuit Ace', color: '#f59e0b' };
    }
    if (suited && high - low === 1 && high >= 8) return { tier: 2, label: 'Suited Connector', color: '#34d399' };
    if (high >= 11 && low >= 9) return { tier: 2, label: 'High Broadway', color: '#34d399' };

    return { tier: 4, label: 'Marginal', color: '#6e7681' };
}

function preflopEquity(tier, numOpponents) { return PREFLOP_EQ[tier][Math.min(numOpponents - 1, 7)]; }

function calculateOuts(holeCardsStr, boardCardsStr, numOpponents = 1) {
    if (boardCardsStr.length < 3) return null;
    const hole = holeCardsStr.map(cardToInt);
    const board = boardCardsStr.map(cardToInt);
    const remaining = makeDeck([...hole, ...board]);

    const currentBestScore = evaluateHand([...hole, ...board]);
    const currentEquity = equityVsRandomHands(hole, board, numOpponents, 350);
    if (board.length >= 5) {
        return {
            outs: 0,
            weightedOuts: 0,
            dirtyOuts: 0,
            marginalOuts: 0,
            drawLabel: 'River: no cards to come',
            approxOdds: 0,
            currentEquity: Math.round(currentEquity * 100),
            cleanCards: '',
            marginalCards: '',
            warning: possibleBetterHands(holeCardsStr, boardCardsStr, 4, numOpponents)
        };
    }
    const clean = [];
    const dirty = [];
    const marginal = [];

    for (const card of remaining) {
        const nextBoard = [...board, card];
        const nextScore = evaluateHand([...hole, ...nextBoard]);
        if (nextScore <= currentBestScore) continue;

        const nextEquity = equityVsRandomHands(hole, nextBoard, numOpponents, 220);
        const gain = nextEquity - currentEquity;
        const out = {
            card: intToCard(card),
            hand: HAND_NAMES[nextScore >> 24],
            equity: Math.round(nextEquity * 100),
            gain: Math.round(gain * 100)
        };

        if (nextEquity >= 0.72 || gain >= 0.24) clean.push(out);
        else if (nextEquity >= currentEquity + 0.08) marginal.push(out);
        else dirty.push(out);
    }

    const outs = clean.length;
    const weightedOuts = clean.length + marginal.length * 0.5 + dirty.length * 0.15;
    const cardsToCome = 5 - board.length;
    const approxOdds = cardsToCome <= 0
        ? 0
        : Math.min(100, Math.round((1 - Math.pow(1 - (weightedOuts / remaining.length), cardsToCome)) * 100));

    let drawLabel = 'Thin or dirty draw';
    if (weightedOuts >= 12) drawLabel = 'Monster draw';
    else if (weightedOuts >= 8) drawLabel = 'Strong draw';
    else if (weightedOuts >= 4) drawLabel = 'Medium draw';
    else if (outs > 0) drawLabel = 'Clean but narrow draw';

    const bestClean = clean.slice(0, 5).map(o => o.card).join(' ');
    const bestMarginal = marginal.slice(0, 5).map(o => o.card).join(' ');

    return {
        outs,
        weightedOuts: Number(weightedOuts.toFixed(1)),
        dirtyOuts: dirty.length,
        marginalOuts: marginal.length,
        drawLabel,
        approxOdds,
        currentEquity: Math.round(currentEquity * 100),
        cleanCards: bestClean,
        marginalCards: bestMarginal,
        warning: possibleBetterHands(holeCardsStr, boardCardsStr, 4, numOpponents)
    };
}

if (typeof module !== 'undefined') module.exports = { simulateOdds, classifyPreflopHand, preflopEquity, calculateOuts, possibleBetterHands };

// FIX 3: Explicitly expose functions to the window object so content.js can access them
if (typeof window !== 'undefined') {
    window.simulateOdds = simulateOdds;
    window.classifyPreflopHand = classifyPreflopHand;
    window.preflopEquity = preflopEquity;
    window.calculateOuts = calculateOuts;
    window.possibleBetterHands = possibleBetterHands;
}
