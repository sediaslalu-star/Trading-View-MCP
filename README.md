# TradingView MCP Server - Complete Real-Time Market Data Implementation

This MCP (Model Context Protocol) server provides comprehensive real-time market data access through multiple data sources, enabling AI assistants to interact with live financial markets data. It supports stocks, forex, cryptocurrencies, and other financial instruments with real-time quotes, historical data, technical indicators, and market analysis.

## Features

### Comprehensive Market Data Coverage

* **Real-time Quotes**: Live bid/ask prices, volume, and market data
* **Historical Data**: OHLCV data with multiple timeframes (1m, 5m, 15m, 1h, 1d, 1w, 1M)
* **Technical Indicators**: SMA, EMA, RSI, MACD, Bollinger Bands, and more
* **Market Analysis**: Support/resistance levels, trend analysis, volatility metrics
* **News Feed**: Real-time financial news and market updates
* **Economic Calendar**: Upcoming earnings, dividends, and economic events

### Multi-Data Source Integration

* **Yahoo Finance**: Free real-time quotes and historical data
* **Finnhub**: Professional-grade market data with real-time WebSocket streams
* **Alpha Vantage**: Technical indicators and fundamental data
* **Built-in Fallbacks**: Automatic failover between data sources

### Real-Time Capabilities

* **WebSocket Streaming**: Live price updates with sub-second latency
* **Intelligent Caching**: Optimized data retrieval with configurable TTL
* **Rate Limiting**: Built-in protection against API limits
* **Market Hours Detection**: Automatic handling of market open/close times

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd trading-view-mcp

# Install dependencies
npm install

# Copy environment configuration
cp env.example .env

# Edit .env with your API keys (optional - Yahoo Finance works without keys)
nano .env
```

## Configuration

### API Keys (Optional but Recommended)

1. **Finnhub** (Free tier: 60 calls/minute)
   - Visit: https://finnhub.io/
   - Get free API key
   - Add to `.env`: `FINNHUB_API_KEY=your_key_here`

2. **Alpha Vantage** (Free tier: 5 calls/minute)
   - Visit: https://www.alphavantage.co/
   - Get free API key  
   - Add to `.env`: `ALPHA_VANTAGE_API_KEY=your_key_here`

### Environment Variables

```bash
# Required (with fallbacks)
FINNHUB_API_KEY=your_finnhub_api_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

# Optional Configuration
LOG_LEVEL=info
DEFAULT_DATA_SOURCE=yahoo
ENABLE_REAL_TIME=true
CACHE_TTL_SECONDS=30
```

## Running the Server

```bash
# Start the server
npm start

# Development mode with auto-reload
npm run dev

# Test the implementation
npm test
```

## Available Tools

### Market Data Tools

#### Real-Time Quotes
- `getCurrentQuote`: Get real-time price, volume, and market data
- `getMultipleQuotes`: Batch quotes for multiple symbols
- `getMarketStatus`: Check if markets are open/closed

#### Historical Data
- `getHistoricalData`: OHLCV data with flexible timeframes
- `getIntradayData`: Minute-level data for day trading
- `getHistoricalQuotes`: Historical price points

#### Technical Analysis
- `getTechnicalIndicators`: Calculate SMA, EMA, RSI, MACD, etc.
- `getBollingerBands`: Upper, middle, lower bands with periods
- `getSupportResistance`: Key price levels and zones
- `getTrendAnalysis`: Trend direction and strength

#### Market Intelligence
- `getMarketNews`: Latest financial news for symbols
- `getEarningsCalendar`: Upcoming earnings announcements
- `getDividendHistory`: Historical dividend payments
- `getAnalystRatings`: Buy/hold/sell recommendations

#### Cryptocurrency
- `getCryptoQuote`: Real-time crypto prices
- `getCryptoMarketCap`: Market capitalization data
- `getCryptoFearGreed`: Fear & Greed index

#### Forex
- `getForexRates`: Currency exchange rates
- `getForexMajors`: Major currency pairs
- `getEconomicCalendar`: Economic events and indicators

### Streaming Tools
- `subscribeToQuotes`: Real-time price streaming
- `subscribeToNews`: Live news feed
- `unsubscribeFromQuotes`: Stop price streaming

## Available Resources

### Dynamic Market Data
- `trending-stocks`: Currently trending stocks with momentum
- `market-movers`: Biggest gainers and losers
- `earnings-today`: Today's earnings announcements
- `market-overview`: Overall market summary (indices, sectors)

### Real-Time Feeds
- `live-quotes`: Real-time quotes for popular symbols
- `crypto-markets`: Live cryptocurrency market data
- `forex-rates`: Current foreign exchange rates
- `market-news`: Latest financial news feed

### Analysis Resources
- `technical-analysis`: Pre-calculated technical indicators
- `market-sentiment`: Sentiment analysis and market mood
- `sector-performance`: Sector rotation and performance
- `volatility-metrics`: VIX and volatility measurements

## Implementation Examples

### Basic Quote Retrieval
```javascript
// Get current Apple stock price
const quote = await getCurrentQuote("AAPL");
console.log(`AAPL: $${quote.price} (${quote.change > 0 ? '+' : ''}${quote.changePercent}%)`);
```

### Historical Data Analysis
```javascript
// Get 1-year daily data for analysis
const data = await getHistoricalData("TSLA", "1d", "1y");
const sma20 = await getTechnicalIndicators("TSLA", "SMA", 20);
```

### Real-Time Streaming
```javascript
// Subscribe to real-time Apple quotes
await subscribeToQuotes(["AAPL", "GOOGL", "MSFT"]);
// Prices will update automatically via WebSocket
```

### Multi-Timeframe Analysis
```javascript
// Compare different timeframes
const daily = await getHistoricalData("BTC-USD", "1d", "3m");
const hourly = await getHistoricalData("BTC-USD", "1h", "1w");
const minute = await getIntradayData("BTC-USD", "5m");
```

## Error Handling and Resilience

### Automatic Fallbacks
1. **Primary**: Finnhub (if API key provided)
2. **Secondary**: Alpha Vantage (if API key provided)  
3. **Fallback**: Yahoo Finance (always available)

### Rate Limiting Protection
- Intelligent request queuing
- Automatic retry with exponential backoff
- Per-source rate limit tracking

### Data Validation
- Real-time data quality checks
- Automatic bad data filtering
- Cross-source validation

## Supported Markets

### Equities
- US Stocks (NYSE, NASDAQ)
- International Markets (major exchanges)
- ETFs and Mutual Funds
- Indices (S&P 500, NASDAQ, Dow Jones)

### Cryptocurrencies
- Major cryptocurrencies (BTC, ETH, etc.)
- Altcoins and DeFi tokens
- Stablecoins (USDT, USDC)
- Real-time market cap data

### Forex
- Major pairs (EUR/USD, GBP/USD, etc.)
- Minor and exotic pairs
- Commodity currencies
- Central bank rates

### Commodities
- Precious metals (Gold, Silver)
- Energy (Oil, Natural Gas)
- Agricultural commodities

## Performance Optimizations

### Caching Strategy
- **Level 1**: In-memory cache (30 seconds TTL)
- **Level 2**: Redis cache (5 minutes TTL) - if available
- **Level 3**: API response caching

### WebSocket Optimization
- Intelligent connection pooling
- Automatic reconnection with backoff
- Subscription management
- Message queuing during disconnections

### Data Compression
- Gzip compression for historical data
- Delta compression for real-time updates
- Efficient JSON serialization

## Security Considerations

### API Key Management
- Environment-based configuration
- Rotation support
- Secure storage recommendations

### Rate Limiting
- Per-client rate limiting
- API quota management
- Graceful degradation

### Data Privacy
- No storage of user queries
- Minimal logging of sensitive data
- Configurable data retention

## Monitoring and Diagnostics

### Health Checks
- Data source availability
- WebSocket connection status
- Cache performance metrics
- API quota usage

### Logging
- Structured JSON logging
- Configurable log levels
- Performance metrics
- Error tracking

## Contributing

1. Fork the repository
2. Create feature branch
3. Add comprehensive tests
4. Update documentation
5. Submit pull request

## License

MIT License - see LICENSE file for details

## Disclaimer

This software is provided for educational and informational purposes only. Market data may be delayed or inaccurate. Always verify data from official sources before making financial decisions. The authors are not responsible for any trading losses or financial decisions made based on this data.

## Support

- GitHub Issues: For bug reports and feature requests
- Documentation: See `/docs` folder for detailed API documentation
- Examples: Check `/examples` folder for implementation samples 