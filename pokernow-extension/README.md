# ♠ PokerNow Odds Calculator — Chrome Extension

A real-time poker odds calculator that runs as an overlay on [pokernow.club](https://pokernow.club), with a full manual calculator in the popup.

---

## Installation

1. Download or unzip the extension folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `pokernow-extension` folder
6. The ♠ icon will appear in your Chrome toolbar

---

## Features

### 🎯 Win Probability (Win % Tab)
- Monte Carlo simulation (4,000–5,000 iterations)
- Shows **Win / Tie / Lose** percentages
- Updates automatically as board cards are revealed
- Accounts for number of active opponents

### 🃏 Preflop Analysis (Preflop Tab)
- Classifies your hole cards into tiers:
  - **Tier 1 – Premium**: AA, KK, QQ, JJ, TT, AK, AQ
  - **Tier 2 – Strong**: Mid pairs, suited aces, broadway
  - **Tier 3 – Playable**: Suited connectors, weak aces
  - **Tier 4 – Marginal**: Everything else
- Shows equity estimate vs N opponents
- Includes play recommendations

### 🔢 Outs Calculator (Outs Tab)
- Available after the flop
- Counts cards that improve your hand
- Uses the **Rule of 2 and 4** for quick approximation
- Available after flop, turn, and river

### 📊 Live HUD
- Draggable overlay on PokerNow.club
- Auto-reads cards from the page DOM
- Toggle on/off with the popup switch
- Remembers position between sessions

### 🧮 Manual Calculator
- Enter any cards manually
- Works independently of PokerNow
- Adjust opponent count (1–8)
- Instant results with 5,000 simulations

---

## Card Format

| Input | Meaning |
|-------|---------|
| `Ah` | Ace of Hearts ♥ |
| `Kd` | King of Diamonds ♦ |
| `Ts` | Ten of Spades ♠ |
| `2c` | Two of Clubs ♣ |

Ranks: `2 3 4 5 6 7 8 9 T J Q K A`  
Suits: `s` (♠) `h` (♥) `d` (♦) `c` (♣)

---

## File Structure

```
pokernow-extension/
├── manifest.json       Chrome extension config
├── content.js          DOM scraper + HUD overlay logic
├── overlay.css         HUD overlay styles
├── popup.html          Extension popup UI
├── popup.js            Popup logic + manual calculator
├── background.js       Service worker
├── poker-engine.js     Core hand evaluation (reference)
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## Notes

- The **Live HUD** uses DOM scraping to detect cards. If PokerNow updates their frontend, selectors may need updating.
- Odds are statistical estimates based on simulation — always your decision to act on them.
- The extension only activates on `pokernow.club` domains.
- No data is ever sent to any server — all calculations happen locally in your browser.

---

## Updating Card Selectors

If the HUD stops reading cards after a PokerNow update, edit `content.js` and update the CSS selectors in `scrapeHoleCards()` and `scrapeBoardCards()` to match the new DOM structure. Use Chrome DevTools on pokernow.club to inspect the card elements.
