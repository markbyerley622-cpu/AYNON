// ========================================
// AYNON SERVER - WebSocket + Solana Tracking
// ========================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    PORT: 3000,
    TOKEN_MINT: null,
    CONTRACT_ADDRESS: null,
    HELIUS_API_KEY: process.env.Heluis_RPC || null,
    SECRET_PASSWORD: process.env.Secret || 'admin123',
};

// ========================================
// STATE
// ========================================
const state = {
    holders: new Map(),
    sellers: new Map(),
    niceList: [],
    naughtyList: [],
    recentActivity: [],
    totalHolders: 0,
    lastUpdate: null
};

// Shame titles for sellers
const SHAME_TITLES = [
    'PAPER HANDS', 'NGMI', 'WEAK', 'GRINCH',
    'COAL ONLY', 'SHAME', 'SELLER', 'RUGGED SELF'
];

// ========================================
// EXPRESS SERVER
// ========================================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint - get current state
app.get('/api/state', (req, res) => {
    res.json({
        totalHolders: state.totalHolders,
        niceCount: state.niceList.length,
        naughtyCount: state.naughtyList.length,
        niceList: state.niceList.slice(0, 100),
        naughtyList: state.naughtyList.slice(0, 100),
        recentActivity: state.recentActivity.slice(0, 50),
        lastUpdate: state.lastUpdate
    });
});

// API endpoint - check specific wallet
app.get('/api/wallet/:address', async (req, res) => {
    const { address } = req.params;

    try {
        const walletData = await checkWallet(address);
        res.json(walletData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint - verify secret password
app.post('/api/verify-secret', (req, res) => {
    const { password } = req.body;
    if (password === CONFIG.SECRET_PASSWORD) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

// API endpoint - update contract address (for GeckoTerminal chart)
app.post('/api/update-ca', (req, res) => {
    const { password, contractAddress } = req.body;
    if (password !== CONFIG.SECRET_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    CONFIG.CONTRACT_ADDRESS = contractAddress;
    console.log(`📝 Contract Address updated: ${contractAddress}`);

    // Broadcast to all clients for GeckoTerminal chart
    broadcast('CA_UPDATE', { contractAddress });

    res.json({ success: true, contractAddress });
});

// Holder refresh tracking
let lastHolderRefresh = 0;
const REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes in milliseconds
let autoRefreshTimer = null;

// Helper to extract token mint from pool address via GeckoTerminal
async function getTokenMintFromPool(poolAddress) {
    try {
        console.log(`🔍 Checking if ${poolAddress} is a pool...`);
        const response = await fetch(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (response.ok) {
            const data = await response.json();
            if (data.data?.relationships?.base_token?.data?.id) {
                // Extract token address from ID like "solana_TOKEN_ADDRESS"
                const tokenId = data.data.relationships.base_token.data.id;
                const tokenMint = tokenId.replace('solana_', '');
                console.log(`✅ Pool detected! Base token mint: ${tokenMint}`);
                return tokenMint;
            }
        }
    } catch (error) {
        console.log('Not a pool or error:', error.message);
    }
    return null;
}

// Core function to fetch holders - tries multiple APIs
async function fetchHoldersFromAPIs(inputAddress) {
    console.log(`🔍 Fetching holders for: ${inputAddress}`);

    let tokenAddress = inputAddress;
    let poolAddress = null;

    // First, check if this is a pool address and get the token mint
    const tokenMintFromPool = await getTokenMintFromPool(inputAddress);
    if (tokenMintFromPool) {
        console.log(`🔄 Switching from pool to token mint: ${tokenMintFromPool}`);
        poolAddress = inputAddress;
        tokenAddress = tokenMintFromPool;
    }

    let holders = [];

    // Method 1: Try Birdeye API (good for newer tokens)
    try {
        console.log('Trying Birdeye API...');
        const birdeyeResponse = await fetch(
            `https://public-api.birdeye.so/defi/token_holder?address=${tokenAddress}&offset=0&limit=100`,
            {
                headers: {
                    'Accept': 'application/json',
                    'x-chain': 'solana'
                }
            }
        );

        if (birdeyeResponse.ok) {
            const birdeyeData = await birdeyeResponse.json();
            console.log('Birdeye response:', JSON.stringify(birdeyeData).substring(0, 500));

            if (birdeyeData.data?.items && Array.isArray(birdeyeData.data.items)) {
                holders = birdeyeData.data.items.map(h => ({
                    address: h.owner || h.holderAddress,
                    balance: parseInt(h.uiAmount * Math.pow(10, h.decimals || 9)) || parseInt(h.amount) || 0,
                    tokenAccount: h.tokenAccount || h.address
                })).filter(h => h.balance > 0 && h.address);

                console.log(`📊 Birdeye found ${holders.length} holders`);
            }
        }
    } catch (error) {
        console.log('Birdeye API error:', error.message);
    }

    // Method 2: Try Solscan API (free, no key required)
    if (holders.length === 0) {
        try {
            console.log('Trying Solscan API...');
            const solscanResponse = await fetch(
                `https://api.solscan.io/token/holders?token=${tokenAddress}&offset=0&size=100`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'AYNON-Server/1.0'
                    }
                }
            );

            if (solscanResponse.ok) {
                const solscanData = await solscanResponse.json();
                console.log('Solscan response:', JSON.stringify(solscanData).substring(0, 500));

                if (solscanData.data && Array.isArray(solscanData.data)) {
                    holders = solscanData.data.map(h => ({
                        address: h.owner || h.address,
                        balance: parseInt(h.amount) || 0,
                        tokenAccount: h.address
                    })).filter(h => h.balance > 0);

                    console.log(`📊 Solscan found ${holders.length} holders`);
                }
            }
        } catch (error) {
            console.log('Solscan API error:', error.message);
        }
    }

    // Method 3: Try Solscan v2 API
    if (holders.length === 0) {
        try {
            console.log('Trying Solscan v2 API...');
            const response = await fetch(
                `https://api-v2.solscan.io/v2/token/holders?token=${tokenAddress}&page=1&page_size=100`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'AYNON-Server/1.0'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                console.log('Solscan v2 response:', JSON.stringify(data).substring(0, 500));

                if (data.data?.items || data.data?.result) {
                    const items = data.data.items || data.data.result || [];
                    holders = items.map(h => ({
                        address: h.owner || h.address,
                        balance: parseInt(h.amount) || parseInt(h.balance) || 0,
                        tokenAccount: h.token_account || h.address
                    })).filter(h => h.balance > 0);

                    console.log(`📊 Solscan v2 found ${holders.length} holders`);
                }
            }
        } catch (error) {
            console.log('Solscan v2 API error:', error.message);
        }
    }

    // Method 4: Try GeckoTerminal API for token info
    if (holders.length === 0) {
        try {
            console.log('Trying GeckoTerminal API...');
            const geckoResponse = await fetch(
                `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${tokenAddress}`,
                {
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );

            if (geckoResponse.ok) {
                const geckoData = await geckoResponse.json();
                console.log('GeckoTerminal response:', JSON.stringify(geckoData).substring(0, 500));

                // GeckoTerminal doesn't provide holder list, but we can get token info
                if (geckoData.data?.attributes) {
                    console.log(`📊 Token found on GeckoTerminal: ${geckoData.data.attributes.name}`);
                    // Store token info for reference
                    CONFIG.TOKEN_INFO = geckoData.data.attributes;
                }
            }
        } catch (error) {
            console.log('GeckoTerminal API error:', error.message);
        }
    }

    // Method 5: Try Helius if we have API key
    if (holders.length === 0 && CONFIG.HELIUS_API_KEY) {
        try {
            console.log('Trying Helius RPC...');
            const heliusResponse = await fetch(
                `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'holder-fetch',
                        method: 'getTokenAccounts',
                        params: {
                            mint: tokenAddress,
                            limit: 1000
                        }
                    })
                }
            );

            const heliusData = await heliusResponse.json();
            console.log('Helius response:', JSON.stringify(heliusData).substring(0, 500));

            if (heliusData.result?.token_accounts) {
                holders = heliusData.result.token_accounts.map(h => ({
                    address: h.owner,
                    balance: parseInt(h.amount) || 0,
                    tokenAccount: h.address
                })).filter(h => h.balance > 0);

                console.log(`📊 Helius found ${holders.length} holders`);
            }
        } catch (error) {
            console.log('Helius API error:', error.message);
        }
    }

    // Method 6: Try public Solana RPC
    if (holders.length === 0) {
        try {
            console.log('Trying public Solana RPC...');
            const rpcUrl = CONFIG.HELIUS_API_KEY
                ? `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`
                : 'https://api.mainnet-beta.solana.com';

            const rpcResponse = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'largest-accounts',
                    method: 'getTokenLargestAccounts',
                    params: [tokenAddress]
                })
            });

            const rpcData = await rpcResponse.json();
            console.log('RPC getTokenLargestAccounts:', JSON.stringify(rpcData).substring(0, 500));

            if (rpcData.result?.value && rpcData.result.value.length > 0) {
                // Get account owners
                const accountAddresses = rpcData.result.value.map(a => a.address);

                const accountsResponse = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'get-accounts',
                        method: 'getMultipleAccounts',
                        params: [accountAddresses, { encoding: 'jsonParsed' }]
                    })
                });

                const accountsData = await accountsResponse.json();

                if (accountsData.result?.value) {
                    holders = accountsData.result.value.map((acc, i) => {
                        if (acc?.data?.parsed?.info?.owner) {
                            return {
                                address: acc.data.parsed.info.owner,
                                balance: parseInt(rpcData.result.value[i].amount) || 0,
                                tokenAccount: accountAddresses[i]
                            };
                        }
                        return null;
                    }).filter(h => h && h.balance > 0);

                    console.log(`📊 RPC found ${holders.length} holders`);
                }
            }
        } catch (error) {
            console.log('Public RPC error:', error.message);
        }
    }

    // Sort by balance descending
    holders.sort((a, b) => b.balance - a.balance);

    console.log(`📊 Total holders found: ${holders.length}`);
    return { holders, tokenMint: tokenAddress, poolAddress };
}

// Update state with new holder data
function updateHolderState(holders, mintAddress) {
    // Track previous holders to detect sellers
    const previousHolders = new Set(state.holders.keys());

    // Update state
    state.holders.clear();
    holders.forEach(h => {
        state.holders.set(h.address, {
            address: h.address,
            balance: h.balance,
            tokenAccount: h.tokenAccount,
            firstSeen: Date.now(),
            lastSeen: Date.now()
        });
        previousHolders.delete(h.address);
    });

    // Anyone who was a holder but isn't anymore is a seller
    previousHolders.forEach(address => {
        if (!state.sellers.has(address)) {
            state.sellers.set(address, {
                address: address,
                soldAt: Date.now(),
                shame: SHAME_TITLES[Math.floor(Math.random() * SHAME_TITLES.length)]
            });
        }
    });

    CONFIG.TOKEN_MINT = mintAddress;
    lastHolderRefresh = Date.now();
    updateLists();

    // Broadcast updated lists
    broadcast('LISTS_UPDATE', {
        niceList: state.niceList.slice(0, 100),
        naughtyList: state.naughtyList.slice(0, 100)
    });

    broadcast('STATS_UPDATE', {
        totalHolders: state.totalHolders,
        niceCount: state.niceList.length,
        naughtyCount: state.naughtyList.length
    });
}

// Auto-refresh function
async function autoRefreshHolders() {
    if (!CONFIG.TOKEN_MINT) return;

    const now = Date.now();
    if (now - lastHolderRefresh < REFRESH_INTERVAL) {
        console.log(`⏳ Skipping refresh, last was ${Math.round((now - lastHolderRefresh) / 1000)}s ago`);
        return;
    }

    try {
        console.log('🔄 Auto-refreshing holder data...');
        const result = await fetchHoldersFromAPIs(CONFIG.TOKEN_MINT);
        updateHolderState(result.holders, result.tokenMint);
        console.log(`✅ Auto-refresh complete: ${result.holders.length} holders`);
    } catch (error) {
        console.error('Auto-refresh error:', error.message);
    }
}

// Start auto-refresh timer
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(autoRefreshHolders, REFRESH_INTERVAL);
    console.log(`⏰ Auto-refresh started (every ${REFRESH_INTERVAL / 60000} minutes)`);
}

// API endpoint - fetch token holders from Helius
app.post('/api/fetch-holders', async (req, res) => {
    const { password, mintAddress } = req.body;
    if (password !== CONFIG.SECRET_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!mintAddress) {
        return res.status(400).json({ error: 'Mint address required' });
    }

    // Rate limiting - don't fetch more than once per 3 minutes
    const now = Date.now();
    if (CONFIG.TOKEN_MINT === mintAddress && now - lastHolderRefresh < REFRESH_INTERVAL) {
        const waitTime = Math.ceil((REFRESH_INTERVAL - (now - lastHolderRefresh)) / 1000);
        return res.status(429).json({
            error: `Please wait ${waitTime} seconds before refreshing again`,
            nextRefresh: lastHolderRefresh + REFRESH_INTERVAL
        });
    }

    try {
        const result = await fetchHoldersFromAPIs(mintAddress);
        updateHolderState(result.holders, result.tokenMint);

        // Also update contract address for GeckoTerminal if we found a pool
        if (result.poolAddress) {
            CONFIG.CONTRACT_ADDRESS = result.poolAddress;
            broadcast('CA_UPDATE', { contractAddress: result.poolAddress });
        } else if (!CONFIG.CONTRACT_ADDRESS) {
            CONFIG.CONTRACT_ADDRESS = result.tokenMint;
            broadcast('CA_UPDATE', { contractAddress: result.tokenMint });
        }

        // Start auto-refresh if not already running
        startAutoRefresh();

        console.log(`✅ Loaded ${result.holders.length} holders (token: ${result.tokenMint})`);

        res.json({
            success: true,
            holdersCount: result.holders.length,
            holders: result.holders.slice(0, 100),
            tokenMint: result.tokenMint,
            poolAddress: result.poolAddress,
            nextRefresh: lastHolderRefresh + REFRESH_INTERVAL
        });

    } catch (error) {
        console.error('Error fetching holders:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// WEBSOCKET SERVER
// ========================================
const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
    console.log('Client connected');
    clients.add(ws);

    // Send current state to new client
    ws.send(JSON.stringify({
        type: 'INITIAL_STATE',
        data: {
            totalHolders: state.totalHolders,
            niceCount: state.niceList.length,
            naughtyCount: state.naughtyList.length,
            niceList: state.niceList.slice(0, 100),
            naughtyList: state.naughtyList.slice(0, 100),
            recentActivity: state.recentActivity.slice(0, 20),
            contractAddress: CONFIG.CONTRACT_ADDRESS
        }
    }));

    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Broadcast to all connected clients
function broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ========================================
// WALLET CHECK
// ========================================

async function checkWallet(address) {
    const isHolder = state.holders.has(address);
    const isSeller = state.sellers.has(address);

    let balance = 0;
    let status = 'UNKNOWN';
    let firstSeen = null;
    let lastActivity = null;

    if (isHolder) {
        const holderData = state.holders.get(address);
        balance = holderData.balance;
        firstSeen = holderData.firstSeen;
        lastActivity = holderData.lastSeen;
        status = 'NICE';
    }

    if (isSeller) {
        const sellerData = state.sellers.get(address);
        lastActivity = sellerData.soldAt;
        status = 'NAUGHTY';
    }

    return {
        address,
        balance,
        status,
        firstSeen,
        lastActivity,
        isNice: status === 'NICE',
        isNaughty: status === 'NAUGHTY'
    };
}

// ========================================
// LIST MANAGEMENT
// ========================================

function updateLists() {
    // Nice list - sorted by balance
    state.niceList = Array.from(state.holders.values())
        .sort((a, b) => b.balance - a.balance)
        .map(h => ({
            address: h.address,
            balance: h.balance,
            tokenAccount: h.tokenAccount,
            points: Math.floor(h.balance / 1000000),
            status: 'HODLER'
        }));

    // Naughty list - sorted by sell time (includes signature for tx link)
    state.naughtyList = Array.from(state.sellers.values())
        .sort((a, b) => b.soldAt - a.soldAt)
        .map(s => ({
            address: s.address,
            shame: s.shame,
            soldAt: s.soldAt,
            signature: s.signature || null,
            status: 'SELLER'
        }));

    state.totalHolders = state.niceList.length;
    state.lastUpdate = Date.now();
}

// ========================================
// HELIUS WEBHOOK (for real-time updates)
// ========================================

app.post('/webhook/helius', (req, res) => {
    console.log('Received webhook:', JSON.stringify(req.body).substring(0, 200));

    const transactions = req.body;

    if (Array.isArray(transactions)) {
        transactions.forEach(tx => {
            const involvesToken = tx.tokenTransfers?.some(t =>
                t.mint === CONFIG.TOKEN_MINT
            );

            if (involvesToken) {
                processTransaction(tx);
            }
        });
    }

    res.status(200).json({ received: true });
});

function processTransaction(tx) {
    const isSell = tx.type === 'SELL' || tx.tokenTransfers?.some(t =>
        t.mint === CONFIG.TOKEN_MINT && t.fromUserAccount
    );

    const wallet = tx.feePayer || tx.source;
    const amount = tx.tokenTransfers?.[0]?.tokenAmount || 0;
    const timestamp = tx.timestamp * 1000;
    const signature = tx.signature;

    if (isSell) {
        if (!state.sellers.has(wallet)) {
            state.sellers.set(wallet, {
                address: wallet,
                soldAmount: amount,
                soldAt: timestamp,
                signature: signature,
                shame: SHAME_TITLES[Math.floor(Math.random() * SHAME_TITLES.length)]
            });

            state.holders.delete(wallet);

            const activity = {
                type: 'sell',
                address: wallet,
                amount: amount,
                signature: signature,
                time: 'Just now',
                timestamp: timestamp
            };
            state.recentActivity.unshift(activity);

            broadcast('SELL', {
                wallet,
                amount,
                signature,
                shame: state.sellers.get(wallet).shame
            });

            broadcast('ACTIVITY', activity);
        }
    } else {
        const existing = state.holders.get(wallet) || { firstSeen: timestamp };
        state.holders.set(wallet, {
            address: wallet,
            balance: (existing.balance || 0) + amount,
            firstSeen: existing.firstSeen,
            lastSeen: timestamp,
            signature: signature
        });

        const activity = {
            type: 'buy',
            address: wallet,
            amount: amount,
            signature: signature,
            time: 'Just now',
            timestamp: timestamp
        };
        state.recentActivity.unshift(activity);

        broadcast('BUY', { wallet, amount, signature });
        broadcast('ACTIVITY', activity);
    }

    if (state.recentActivity.length > 100) {
        state.recentActivity = state.recentActivity.slice(0, 100);
    }

    updateLists();
}

// ========================================
// INITIALIZATION
// ========================================

async function init() {
    console.log('🎅 AYNON Server Starting...');
    console.log('================================');

    if (!CONFIG.HELIUS_API_KEY) {
        console.log('⚠️  Helius API key not found in .env (Heluis_RPC)');
    } else {
        console.log('✅ Helius API key loaded');
    }

    console.log('');
    console.log('📊 Starting with empty state');
    console.log('   Use admin panel (Ctrl+D) to:');
    console.log('   - Set CA for GeckoTerminal chart');
    console.log('   - Set TMA to fetch holders from Helius');
    console.log('');

    // Start server
    server.listen(CONFIG.PORT, () => {
        console.log(`🚀 Server running at http://localhost:${CONFIG.PORT}`);
        console.log(`📡 WebSocket available at ws://localhost:${CONFIG.PORT}`);
        console.log('================================');
    });
}

init();
