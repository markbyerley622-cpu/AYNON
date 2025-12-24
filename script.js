// ========================================
// AYNON - Client Side JavaScript
// WebSocket + Live Updates
// ========================================

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    // Your token contract address (for GeckoTerminal iframe)
    TOKEN_ADDRESS: 'YOUR_TOKEN_ADDRESS_HERE',

    // Check if running on Vercel (static hosting - no backend)
    IS_STATIC: window.location.hostname.includes('vercel.app') ||
               window.location.hostname.includes('netlify.app') ||
               window.location.hostname.includes('github.io'),

    // WebSocket server URL (only for local/backend server)
    WS_URL: window.location.protocol === 'https:'
        ? `wss://${window.location.host}`
        : `ws://${window.location.host}`,

    // API URL
    API_URL: window.location.origin,

    // Static mode - no backend available
    STATIC_MODE: false
};

// ========================================
// STATE
// ========================================
const state = {
    ws: null,
    connected: false,
    totalHolders: 0,
    niceCount: 0,
    naughtyCount: 0,
    niceList: [],
    naughtyList: [],
    recentActivity: []
};

// ========================================
// WEBSOCKET CONNECTION
// ========================================

let wsRetryCount = 0;
const MAX_WS_RETRIES = 2;

function connectWebSocket() {
    // Skip WebSocket on static hosts (Vercel, Netlify, etc.)
    if (CONFIG.IS_STATIC) {
        console.log('📡 Static hosting detected - WebSocket disabled');
        CONFIG.STATIC_MODE = true;
        updateConnectionStatus(false);
        updateAllUI();
        return;
    }

    // Don't retry too many times
    if (wsRetryCount >= MAX_WS_RETRIES) {
        console.log('⚠️ Max WebSocket retries reached - running in static mode');
        CONFIG.STATIC_MODE = true;
        updateConnectionStatus(false);
        updateAllUI();
        return;
    }

    try {
        state.ws = new WebSocket(CONFIG.WS_URL);

        state.ws.onopen = () => {
            console.log('🟢 WebSocket connected');
            state.connected = true;
            wsRetryCount = 0; // Reset on successful connection
            updateConnectionStatus(true);
        };

        state.ws.onclose = () => {
            console.log('🔴 WebSocket disconnected');
            state.connected = false;
            updateConnectionStatus(false);

            // Only retry if we haven't exceeded max retries
            if (wsRetryCount < MAX_WS_RETRIES) {
                wsRetryCount++;
                setTimeout(connectWebSocket, 3000);
            } else {
                CONFIG.STATIC_MODE = true;
                updateAllUI();
            }
        };

        state.ws.onerror = (error) => {
            console.log('WebSocket unavailable - static mode');
            // Don't spam console with errors
        };

        state.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        };

    } catch (error) {
        console.log('WebSocket not available - static mode');
        CONFIG.STATIC_MODE = true;
        updateAllUI();
    }
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'INITIAL_STATE':
            state.totalHolders = message.data.totalHolders;
            state.niceCount = message.data.niceCount;
            state.naughtyCount = message.data.naughtyCount;
            state.niceList = message.data.niceList;
            state.naughtyList = message.data.naughtyList;
            state.recentActivity = message.data.recentActivity;
            updateAllUI();
            break;

        case 'STATS_UPDATE':
            state.totalHolders = message.data.totalHolders;
            state.niceCount = message.data.niceCount;
            state.naughtyCount = message.data.naughtyCount;
            updateStats();
            break;

        case 'BUY':
            showNotification('nice', `New HODLER joined! +${formatTokenAmount(message.data.amount)}`);
            flashStat('nice');
            break;

        case 'SELL':
            showNotification('naughty', `SELLER detected! ${message.data.shame}`);
            flashStat('naughty');
            break;

        case 'ACTIVITY':
            addActivityItem(message.data);
            break;

        case 'LISTS_UPDATE':
            state.niceList = message.data.niceList;
            state.naughtyList = message.data.naughtyList;
            renderNiceList();
            renderNaughtyList();
            break;

        case 'CA_UPDATE':
            updateCADisplay(message.data.contractAddress);
            break;
    }
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.textContent = connected ? 'LIVE' : 'OFFLINE';
        statusEl.className = connected ? 'status-live' : 'status-offline';
    }
}

// ========================================
// UI UPDATES
// ========================================

function updateAllUI() {
    updateStats();
    renderNiceList();
    renderNaughtyList();
    renderActivityFeed();
}

function updateStats() {
    animateNumber('total-holders', state.totalHolders);
    animateNumber('nice-count', state.niceCount);
    animateNumber('naughty-count', state.naughtyCount);
}

function animateNumber(elementId, targetValue) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const current = parseInt(el.textContent.replace(/,/g, '')) || 0;
    const diff = targetValue - current;
    const steps = 20;
    const stepValue = diff / steps;
    let step = 0;

    const animate = () => {
        step++;
        const newValue = Math.round(current + stepValue * step);
        el.textContent = formatNumber(newValue);

        if (step < steps) {
            requestAnimationFrame(animate);
        } else {
            el.textContent = formatNumber(targetValue);
        }
    };

    animate();
}

function flashStat(type) {
    const el = document.querySelector(type === 'nice' ? '.nice-block' : '.naughty-block');
    if (el) {
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 500);
    }
}

// ========================================
// NICE LIST RENDERING
// ========================================

function renderNiceList(filter = '') {
    const container = document.getElementById('nice-list-content');
    const countEl = document.getElementById('nice-list-count');
    if (!container) return;

    let list = state.niceList;
    if (filter) {
        list = list.filter(item =>
            item.address.toLowerCase().includes(filter.toLowerCase())
        );
    }

    if (countEl) countEl.textContent = list.length;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="list-loading">
                <p>NO HOLDERS FOUND</p>
            </div>
        `;
        return;
    }

    container.innerHTML = list.slice(0, 50).map((item, index) => `
        <div class="wallet-entry" data-address="${item.address}" onclick="window.open('https://solscan.io/account/${item.address}', '_blank')">
            <div class="wallet-link">
                <div class="wallet-info">
                    <span class="wallet-rank">#${index + 1}</span>
                    <span class="wallet-address">${shortenAddress(item.address, 6)}</span>
                    <span class="wallet-time">${formatTokenAmount(item.balance)} $AYNON</span>
                </div>
                <span class="wallet-badge">${item.points || 0} PTS</span>
            </div>
        </div>
    `).join('');
}

// ========================================
// NAUGHTY LIST RENDERING
// ========================================

function renderNaughtyList(filter = '') {
    const container = document.getElementById('naughty-list-content');
    const countEl = document.getElementById('naughty-list-count');
    if (!container) return;

    let list = state.naughtyList;
    if (filter) {
        list = list.filter(item =>
            item.address.toLowerCase().includes(filter.toLowerCase())
        );
    }

    if (countEl) countEl.textContent = list.length;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="list-loading">
                <p>NO SELLERS YET!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = list.slice(0, 50).map(item => `
        <div class="wallet-entry" data-address="${item.address}">
            <div class="wallet-link" onclick="window.open('https://solscan.io/account/${item.address}', '_blank')">
                <div class="wallet-info">
                    <span class="wallet-address">${shortenAddress(item.address, 6)}</span>
                    <span class="wallet-time" style="color: var(--red);">${item.shame}</span>
                    ${item.signature ? `<a class="tx-link" href="https://solscan.io/tx/${item.signature}" target="_blank" onclick="event.stopPropagation();">View Sell TX</a>` : ''}
                    ${item.soldAt ? `<span class="wallet-time">${timeAgo(item.soldAt)}</span>` : ''}
                </div>
                <span class="wallet-badge">NGMI</span>
            </div>
        </div>
    `).join('');
}

// ========================================
// ACTIVITY FEED
// ========================================

function renderActivityFeed() {
    const container = document.getElementById('activity-feed');
    if (!container) return;

    if (state.recentActivity.length === 0) {
        container.innerHTML = `
            <div class="list-loading">
                <p>WAITING FOR ACTIVITY...</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.recentActivity.slice(0, 20).map(item => `
        <div class="activity-item ${item.type === 'buy' ? 'buy-item' : 'sell-item'}" onclick="window.open('https://solscan.io/account/${item.address}', '_blank')" style="cursor: pointer;">
            <div class="activity-icon ${item.type}">
                ${item.type === 'buy' ? '🎁' : '💀'}
            </div>
            <div class="activity-details">
                <div class="activity-type ${item.type}">
                    ${item.type === 'buy' ? 'JOINED NICE LIST' : 'ADDED TO NAUGHTY'}
                </div>
                <div class="activity-wallet">${shortenAddress(item.address, 6)}</div>
            </div>
            <div class="activity-amount">
                <div class="activity-tokens">${formatTokenAmount(item.amount)}</div>
                <div class="activity-time">${item.time}</div>
            </div>
        </div>
    `).join('');
}

function addActivityItem(activity) {
    state.recentActivity.unshift(activity);
    if (state.recentActivity.length > 50) {
        state.recentActivity = state.recentActivity.slice(0, 50);
    }

    const container = document.getElementById('activity-feed');
    if (!container) return;

    const itemHTML = `
        <div class="activity-item ${activity.type === 'buy' ? 'buy-item' : 'sell-item'} new-item" onclick="window.open('https://solscan.io/account/${activity.address}', '_blank')" style="cursor: pointer;">
            <div class="activity-icon ${activity.type}">
                ${activity.type === 'buy' ? '🎁' : '💀'}
            </div>
            <div class="activity-details">
                <div class="activity-type ${activity.type}">
                    ${activity.type === 'buy' ? 'JOINED NICE LIST' : 'ADDED TO NAUGHTY'}
                </div>
                <div class="activity-wallet">${shortenAddress(activity.address, 6)}</div>
            </div>
            <div class="activity-amount">
                <div class="activity-tokens">${formatTokenAmount(activity.amount)}</div>
                <div class="activity-time">Just now</div>
            </div>
        </div>
    `;

    // Remove loading message if present
    const loading = container.querySelector('.list-loading');
    if (loading) loading.remove();

    container.insertAdjacentHTML('afterbegin', itemHTML);

    // Remove old items if too many
    const items = container.querySelectorAll('.activity-item');
    if (items.length > 20) {
        items[items.length - 1].remove();
    }
}

// ========================================
// WALLET SEARCH
// ========================================

async function searchWallet(address = null) {
    const input = address || document.getElementById('wallet-search')?.value.trim();
    const resultContainer = document.getElementById('search-result');
    const resultCard = resultContainer?.querySelector('.result-card');

    if (!input) {
        showNotification('error', 'Enter a wallet address');
        return;
    }

    if (!isValidSolanaAddress(input)) {
        showNotification('error', 'Invalid Solana address');
        return;
    }

    if (!resultContainer || !resultCard) return;

    // Show loading
    resultContainer.classList.remove('hidden');
    resultCard.innerHTML = `
        <div class="list-loading">
            <div class="loader"></div>
            <p>CHECKING SANTA'S LIST...</p>
        </div>
    `;

    try {
        // Check local state first
        let walletData = null;

        const niceEntry = state.niceList.find(h => h.address === input);
        const naughtyEntry = state.naughtyList.find(s => s.address === input);

        if (niceEntry) {
            walletData = {
                address: input,
                balance: niceEntry.balance,
                status: 'NICE',
                isNice: true,
                isNaughty: false
            };
        } else if (naughtyEntry) {
            walletData = {
                address: input,
                balance: 0,
                status: 'NAUGHTY',
                isNice: false,
                isNaughty: true,
                shame: naughtyEntry.shame
            };
        } else {
            // Try API
            if (!CONFIG.DEMO_MODE) {
                const response = await fetch(`${CONFIG.API_URL}/api/wallet/${input}`);
                walletData = await response.json();
            } else {
                walletData = {
                    address: input,
                    balance: 0,
                    status: 'UNKNOWN',
                    isNice: false,
                    isNaughty: false
                };
            }
        }

        renderWalletResult(walletData, resultCard);

    } catch (error) {
        console.error('Search error:', error);
        resultCard.innerHTML = `
            <div class="list-loading">
                <p>ERROR CHECKING WALLET</p>
            </div>
        `;
    }

    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderWalletResult(data, card) {
    card.className = 'result-card';
    if (data.isNice) card.classList.add('nice-result');
    if (data.isNaughty) card.classList.add('naughty-result');

    const statusColor = data.isNice ? 'var(--nice-color)' : data.isNaughty ? 'var(--naughty-color)' : '#888';
    const statusIcon = data.isNice ? '🎁' : data.isNaughty ? '💀' : '❓';

    card.innerHTML = `
        <div class="result-header">
            <span class="result-status" style="color: ${statusColor}">
                ${statusIcon} ${data.status}
            </span>
            <span class="result-wallet">${shortenAddress(data.address, 8)}</span>
        </div>
        <div class="result-grid">
            <div class="result-item">
                <span class="item-label">BALANCE</span>
                <span class="item-value">${formatTokenAmount(data.balance || 0)} $AYNON</span>
            </div>
            <div class="result-item">
                <span class="item-label">STATUS</span>
                <span class="item-value" style="color: ${statusColor}">${data.status}</span>
            </div>
            <div class="result-item">
                <span class="item-label">FIRST SEEN</span>
                <span class="item-value">${data.firstSeen ? timeAgo(data.firstSeen) : 'N/A'}</span>
            </div>
            <div class="result-item">
                <span class="item-label">LAST TX</span>
                <span class="item-value">${data.lastActivity ? timeAgo(data.lastActivity) : 'N/A'}</span>
            </div>
        </div>
        <div class="result-verdict ${data.isNice ? 'nice-verdict' : data.isNaughty ? 'naughty-verdict' : ''}">
            ${getVerdict(data)}
        </div>
    `;
}

function getVerdict(data) {
    if (data.isNaughty) {
        const shames = [
            "PAPER HANDS DETECTED! No presents for this wallet!",
            "SELLER ALERT! This wallet is on the NAUGHTY list forever!",
            "NGMI! Sold their $AYNON. Only coal awaits.",
            "THE GRINCH WOULD BE PROUD... Naughty list confirmed!"
        ];
        return shames[Math.floor(Math.random() * shames.length)];
    }

    if (data.isNice) {
        const praises = [
            "DIAMOND HANDS! This wallet is on Santa's NICE LIST!",
            "HODLER CONFIRMED! Christmas rewards incoming!",
            "NICE LIST VERIFIED! Keep holding for maximum presents!",
            "SANTA APPROVES! Strong hands get rewarded!"
        ];
        return praises[Math.floor(Math.random() * praises.length)];
    }

    return "This wallet doesn't hold $AYNON. Buy now to join the Nice List!";
}

// ========================================
// NOTIFICATIONS
// ========================================

function showNotification(type, message) {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span class="notif-icon">${type === 'nice' ? '🎁' : type === 'naughty' ? '💀' : '⚠️'}</span>
        <span class="notif-text">${message}</span>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function shortenAddress(address, chars = 4) {
    if (!address) return '--';
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    return new Intl.NumberFormat().format(Math.floor(num));
}

function formatTokenAmount(amount, decimals = 9) {
    if (!amount) return '0';
    const value = amount / Math.pow(10, decimals);
    if (value >= 1000000) return (value / 1000000).toFixed(2) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(2) + 'K';
    return value.toFixed(2);
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
}

function isValidSolanaAddress(address) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

// ========================================
// SNOW EFFECT
// ========================================

function createSnowflake() {
    const container = document.getElementById('snow-container');
    if (!container) return;

    const snowflake = document.createElement('div');
    snowflake.classList.add('snowflake');
    snowflake.innerHTML = ['❄', '❅', '❆', '*'][Math.floor(Math.random() * 4)];

    snowflake.style.left = Math.random() * 100 + 'vw';
    snowflake.style.animationDuration = Math.random() * 3 + 4 + 's';
    snowflake.style.opacity = Math.random() * 0.6 + 0.4;
    snowflake.style.fontSize = (Math.random() * 10 + 8) + 'px';

    container.appendChild(snowflake);
    setTimeout(() => snowflake.remove(), 7000);
}

// ========================================
// SPEECH BUBBLES
// ========================================

const pepeSpeechOptions = [
    'HODL OR GET REKT!',
    'PAPER HANDS = NGMI',
    'DIAMOND HANDS ONLY!',
    'SELLERS GET COAL!',
    'TO THE MOON!',
    'STAY NICE, STAY RICH!'
];

const santaSpeechOptions = [
    '"Checking my list twice!"',
    '"Ho ho HODL!"',
    '"Paper hands get coal!"',
    '"I see you selling..."',
    '"Nice holders win!"',
    '"WAGMI if you HODL!"'
];

function changePepeSpeech() {
    const el = document.getElementById('pepe-speech');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
        el.textContent = pepeSpeechOptions[Math.floor(Math.random() * pepeSpeechOptions.length)];
        el.style.opacity = '1';
    }, 200);
}

function changeSantaSpeech() {
    const el = document.getElementById('santa-speech');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
        el.textContent = santaSpeechOptions[Math.floor(Math.random() * santaSpeechOptions.length)];
        el.style.opacity = '1';
    }, 200);
}

// ========================================
// DEMO MODE
// ========================================

function loadDemoData() {
    console.log('📊 Running in demo mode');

    // Generate demo data
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    function randomAddress() {
        let addr = '';
        for (let i = 0; i < 44; i++) {
            addr += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return addr;
    }

    // Nice list
    state.niceList = Array.from({ length: 25 }, (_, i) => ({
        address: randomAddress(),
        balance: Math.floor(Math.random() * 100000000000),
        points: Math.floor(Math.random() * 5000),
        status: 'HODLER'
    })).sort((a, b) => b.balance - a.balance);

    // Naughty list
    const shames = ['PAPER HANDS', 'NGMI', 'WEAK', 'GRINCH', 'SHAME', 'SELLER'];
    state.naughtyList = Array.from({ length: 15 }, () => ({
        address: randomAddress(),
        shame: shames[Math.floor(Math.random() * shames.length)],
        status: 'SELLER'
    }));

    // Activity
    state.recentActivity = Array.from({ length: 15 }, () => ({
        type: Math.random() > 0.3 ? 'buy' : 'sell',
        address: randomAddress(),
        amount: Math.floor(Math.random() * 10000000000),
        time: ['Just now', '2m ago', '5m ago', '10m ago', '1h ago'][Math.floor(Math.random() * 5)]
    }));

    state.totalHolders = state.niceList.length;
    state.niceCount = state.niceList.length;
    state.naughtyCount = state.naughtyList.length;

    updateAllUI();

    // Simulate live activity
    setInterval(() => {
        const isBuy = Math.random() > 0.25;
        const activity = {
            type: isBuy ? 'buy' : 'sell',
            address: randomAddress(),
            amount: Math.floor(Math.random() * 5000000000),
            time: 'Just now'
        };

        addActivityItem(activity);

        if (isBuy) {
            state.niceCount++;
            state.totalHolders++;
            showNotification('nice', `New HODLER! +${formatTokenAmount(activity.amount)}`);
        } else {
            state.naughtyCount++;
            showNotification('naughty', 'SELLER DETECTED! NGMI!');
        }

        updateStats();

    }, 10000 + Math.random() * 10000);
}

// ========================================
// GECKO TERMINAL IFRAME
// ========================================

async function loadGeckoTerminal() {
    const container = document.getElementById('gecko-terminal');
    if (!container) return;

    if (!CONFIG.TOKEN_ADDRESS || CONFIG.TOKEN_ADDRESS === 'YOUR_TOKEN_ADDRESS_HERE') {
        container.innerHTML = `
            <div class="list-loading">
                <div class="loader"></div>
                <p>LOADING CHART...</p>
            </div>
        `;
        return;
    }

    // Show loading
    container.innerHTML = `
        <div class="list-loading">
            <div class="loader"></div>
            <p>LOADING CHART...</p>
        </div>
    `;

    const address = CONFIG.TOKEN_ADDRESS;

    // Try multiple approaches to find the right embed URL
    try {
        // Method 1: Try as pool address first (direct embed)
        console.log('Trying address as pool...');
        const poolCheckResponse = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${address}`);

        if (poolCheckResponse.ok) {
            const poolData = await poolCheckResponse.json();
            if (poolData.data) {
                console.log('Address is a pool:', address);
                container.innerHTML = `
                    <iframe
                        src="https://www.geckoterminal.com/solana/pools/${address}?embed=1&info=0&swaps=1&grayscale=0&light_chart=0"
                        frameborder="0"
                        allow="clipboard-write"
                        allowfullscreen
                        style="width: 100%; height: 100%; border: none; border-radius: 4px;"
                    ></iframe>
                `;
                return;
            }
        }

        // Method 2: Try as token address and get its pools
        console.log('Trying address as token...');
        const tokenPoolsResponse = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${address}/pools?page=1`);

        if (tokenPoolsResponse.ok) {
            const tokenData = await tokenPoolsResponse.json();
            if (tokenData.data && tokenData.data.length > 0) {
                const poolAddress = tokenData.data[0].attributes.address;
                console.log('Found pool for token:', poolAddress);
                container.innerHTML = `
                    <iframe
                        src="https://www.geckoterminal.com/solana/pools/${poolAddress}?embed=1&info=0&swaps=1&grayscale=0&light_chart=0"
                        frameborder="0"
                        allow="clipboard-write"
                        allowfullscreen
                        style="width: 100%; height: 100%; border: none; border-radius: 4px;"
                    ></iframe>
                `;
                return;
            }
        }

        // Method 3: Search for the token
        console.log('Searching GeckoTerminal...');
        const searchResponse = await fetch(`https://api.geckoterminal.com/api/v2/search/pools?query=${address}&network=solana`);

        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.data && searchData.data.length > 0) {
                const foundPool = searchData.data[0].attributes.address;
                console.log('Found via search:', foundPool);
                container.innerHTML = `
                    <iframe
                        src="https://www.geckoterminal.com/solana/pools/${foundPool}?embed=1&info=0&swaps=1&grayscale=0&light_chart=0"
                        frameborder="0"
                        allow="clipboard-write"
                        allowfullscreen
                        style="width: 100%; height: 100%; border: none; border-radius: 4px;"
                    ></iframe>
                `;
                return;
            }
        }

        // Fallback: Show message that token not found on GeckoTerminal
        console.log('Token not found on GeckoTerminal');
        container.innerHTML = `
            <div class="list-loading">
                <p>TOKEN NOT FOUND ON GECKOTERMINAL</p>
                <p style="font-size: 0.7rem; margin-top: 10px;">Token may be too new or not yet indexed</p>
                <a href="https://www.geckoterminal.com/solana/tokens/${address}" target="_blank"
                   style="color: var(--gold); font-size: 0.8rem; margin-top: 15px; display: block;">
                   CHECK GECKOTERMINAL DIRECTLY
                </a>
            </div>
        `;

    } catch (error) {
        console.error('GeckoTerminal error:', error);
        container.innerHTML = `
            <div class="list-loading">
                <p>CHART LOADING ERROR</p>
                <a href="https://www.geckoterminal.com/solana/tokens/${address}" target="_blank"
                   style="color: var(--gold); font-size: 0.8rem; margin-top: 15px; display: block;">
                   VIEW ON GECKOTERMINAL
                </a>
            </div>
        `;
    }
}

// ========================================
// INITIALIZATION
// ========================================

function init() {
    console.log('🎅 AYNON Client Starting...');

    // Start snow
    setInterval(createSnowflake, 200);

    // Start speech changes
    setInterval(changePepeSpeech, 4000);
    setInterval(changeSantaSpeech, 5000);

    // Load GeckoTerminal
    loadGeckoTerminal();

    // Try to connect to WebSocket server
    connectWebSocket();

    // Show empty states after a short delay if not connected
    setTimeout(() => {
        if (!state.connected && !CONFIG.IS_STATIC) {
            console.log('No server connection - run: node server.js');
        }
        updateAllUI(); // Show empty states
    }, 1000);
}

// ========================================
// EVENT LISTENERS
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    init();

    // Search button
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => searchWallet());
    }

    // Search on Enter
    const searchInput = document.getElementById('wallet-search');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchWallet();
        });
    }

    // Nice list filter
    const niceFilter = document.getElementById('nice-filter');
    if (niceFilter) {
        niceFilter.addEventListener('input', (e) => {
            renderNiceList(e.target.value);
        });
    }

    // Naughty list filter
    const naughtyFilter = document.getElementById('naughty-filter');
    if (naughtyFilter) {
        naughtyFilter.addEventListener('input', (e) => {
            renderNaughtyList(e.target.value);
        });
    }
});

// Global function for onclick handlers
window.searchWallet = searchWallet;

// ========================================
// SECRET ADMIN PANEL (Ctrl+D)
// ========================================

let adminUnlocked = false;
let adminPassword = null;

// Ctrl+D handler to open secret panel
window.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault(); // Prevent browser bookmark dialog

        // On static hosts, admin panel requires backend
        if (CONFIG.IS_STATIC || CONFIG.STATIC_MODE) {
            showNotification('error', 'Admin panel requires backend server. Run locally with: node server.js');
            return;
        }

        if (adminUnlocked) {
            // Already unlocked, just show the panel
            showSecretPanel();
            return;
        }

        // Prompt for password
        const password = prompt('Enter admin password:');
        if (!password) return;

        try {
            const res = await fetch(`${CONFIG.API_URL}/api/verify-secret`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (data.valid) {
                adminUnlocked = true;
                adminPassword = password;
                showSecretPanel();
                showNotification('nice', 'Admin access granted!');
            } else {
                showNotification('error', 'Invalid password!');
            }
        } catch (error) {
            console.error('Auth error:', error);
            showNotification('error', 'Server not running. Start with: node server.js');
        }
    }
});

function showSecretPanel() {
    const panel = document.getElementById('secret-panel');
    if (panel) {
        panel.classList.remove('hidden');
    }
}

function hideSecretPanel() {
    const panel = document.getElementById('secret-panel');
    if (panel) {
        panel.classList.add('hidden');
    }
}

// Update Contract Address
async function updateContractAddress() {
    const caInput = document.getElementById('ca-input');
    const ca = caInput?.value.trim();

    if (!ca) {
        showNotification('error', 'Enter a contract address');
        return;
    }

    if (!isValidSolanaAddress(ca)) {
        showNotification('error', 'Invalid Solana address');
        return;
    }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/update-ca`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, contractAddress: ca })
        });
        const data = await res.json();

        if (data.success) {
            updateCADisplay(ca);
            showNotification('nice', 'Contract address updated!');
        } else {
            showNotification('error', data.error || 'Failed to update');
        }
    } catch (error) {
        console.error('Update CA error:', error);
        showNotification('error', 'Server error');
    }
}

// Load GeckoTerminal chart separately
async function loadGeckoChart() {
    const geckoInput = document.getElementById('gecko-ca-input');
    const geckoCA = geckoInput?.value.trim();

    if (!geckoCA) {
        showNotification('error', 'Enter a contract address for chart');
        return;
    }

    if (!isValidSolanaAddress(geckoCA)) {
        showNotification('error', 'Invalid Solana address');
        return;
    }

    CONFIG.TOKEN_ADDRESS = geckoCA;
    loadGeckoTerminal();
    showNotification('nice', 'Loading chart...');
}

// Fetch token holders from Helius
async function fetchTokenHolders() {
    const tmaInput = document.getElementById('tma-input');
    const tma = tmaInput?.value.trim();

    if (!tma) {
        showNotification('error', 'Enter a token mint address');
        return;
    }

    if (!isValidSolanaAddress(tma)) {
        showNotification('error', 'Invalid Solana address');
        return;
    }

    const statusEl = document.getElementById('holder-status');
    const statusText = document.getElementById('holder-status-text');

    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusText.textContent = 'Fetching holders...';
    }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/fetch-holders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, mintAddress: tma })
        });
        const data = await res.json();

        if (data.success) {
            if (statusText) {
                statusText.textContent = `Found ${data.holdersCount} holders!`;
            }
            showNotification('nice', `Loaded ${data.holdersCount} holders!`);

            // Update the lists
            if (data.holders) {
                state.niceList = data.holders.map((h, i) => ({
                    address: h.address,
                    balance: h.balance,
                    points: Math.floor(h.balance / 1000000),
                    status: 'HODLER'
                }));
                state.niceCount = data.holdersCount;
                state.totalHolders = data.holdersCount;
                updateAllUI();
            }

            setTimeout(() => {
                if (statusEl) statusEl.classList.add('hidden');
            }, 3000);
        } else {
            if (statusText) {
                statusText.textContent = `Error: ${data.error}`;
            }
            showNotification('error', data.error || 'Failed to fetch holders');
        }
    } catch (error) {
        console.error('Fetch holders error:', error);
        if (statusText) {
            statusText.textContent = 'Server error';
        }
        showNotification('error', 'Server error');
    }
}

// Update the CA display banner
function updateCADisplay(ca) {
    const banner = document.getElementById('ca-banner');
    const display = document.getElementById('ca-display');

    if (banner && display && ca) {
        display.textContent = ca;
        banner.classList.remove('hidden');

        // Also update the GeckoTerminal iframe
        CONFIG.TOKEN_ADDRESS = ca;
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            loadGeckoTerminal();
        }, 100);
    }
}

// Copy CA to clipboard
function copyCAToClipboard() {
    const display = document.getElementById('ca-display');
    if (display && display.textContent !== '--') {
        navigator.clipboard.writeText(display.textContent).then(() => {
            showNotification('nice', 'Contract address copied!');
        }).catch(() => {
            showNotification('error', 'Failed to copy');
        });
    }
}

// Secret panel event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Close button
    const closeBtn = document.getElementById('close-secret-panel');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideSecretPanel);
    }

    // Overlay click to close
    const overlay = document.querySelector('.secret-panel-overlay');
    if (overlay) {
        overlay.addEventListener('click', hideSecretPanel);
    }

    // Update CA button
    const updateCABtn = document.getElementById('update-ca-btn');
    if (updateCABtn) {
        updateCABtn.addEventListener('click', updateContractAddress);
    }

    // Load chart button
    const loadChartBtn = document.getElementById('load-chart-btn');
    if (loadChartBtn) {
        loadChartBtn.addEventListener('click', loadGeckoChart);
    }

    // Fetch holders button
    const fetchHoldersBtn = document.getElementById('fetch-holders-btn');
    if (fetchHoldersBtn) {
        fetchHoldersBtn.addEventListener('click', fetchTokenHolders);
    }

    // Copy CA button
    const copyCABtn = document.getElementById('copy-ca-btn');
    if (copyCABtn) {
        copyCABtn.addEventListener('click', copyCAToClipboard);
    }

    // Enter key handlers for inputs
    const geckoInput = document.getElementById('gecko-ca-input');
    if (geckoInput) {
        geckoInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadGeckoChart();
        });
    }

    const caInput = document.getElementById('ca-input');
    if (caInput) {
        caInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') updateContractAddress();
        });
    }

    const tmaInput = document.getElementById('tma-input');
    if (tmaInput) {
        tmaInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') fetchTokenHolders();
        });
    }
});

console.log('🎄 AYNON script loaded');
