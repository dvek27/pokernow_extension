// ============================================================
// background.js — Service Worker for PokerNow Odds Extension
// ============================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const isPokerNow = tab.url && (tab.url.includes('pokernow.club') || tab.url.includes('pokernow.com'));
    if (changeInfo.status === 'complete' && isPokerNow) {
        chrome.action.setBadgeText({ text: '●', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    } else if (changeInfo.status === 'complete') {
        chrome.action.setBadgeText({ text: '', tabId });
    }
});