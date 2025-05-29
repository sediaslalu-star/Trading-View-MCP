#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import yahooFinance from 'yahoo-finance2';
import finnhub from 'finnhub';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import { config } from 'dotenv';

// Load environment variables
config();

// Configuration
const CONFIG = {
  logLevel: process.env.LOG_LEVEL || 'info',
  finnhubApiKey: process.env.FINNHUB_API_KEY,
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
  defaultDataSource: process.env.DEFAULT_DATA_SOURCE || 'yahoo',
  enableRealTime: process.env.ENABLE_REAL_TIME === 'true',
  cacheTtl: parseInt(process.env.CACHE_TTL_SECONDS) || 30,
  popularSymbols: (process.env.POPULAR_SYMBOLS || 'AAPL,GOOGL,MSFT,TSLA,AMZN,NVDA,META,BTC-USD,ETH-USD,SPY,QQQ').split(','),
  websocketReconnectInterval: parseInt(process.env.WEBSOCKET_RECONNECT_INTERVAL) || 5000,
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 100
};

// Initialize APIs
const finnhubClient = CONFIG.finnhubApiKey ? finnhub.ApiClient.instance : null;
if (finnhubClient) {
  finnhubClient.authentications['api_key'].apiKey = CONFIG.finnhubApiKey;
}

// Cache and state management
const cache = new Map();
const subscriptions = new Map();
const rateLimits = new Map();

// Logging utility
function log(level, message, data = {}) {
  if (CONFIG.logLevel === 'debug' || level !== 'debug') {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    }));
  }
}

// Rate limiting
function checkRateLimit(source) {
  const now = Date.now();
  const key = `${source}_${Math.floor(now / 60000)}`;
  const count = rateLimits.get(key) || 0;
  
  if (count >= CONFIG.maxRequestsPerMinute) {
    throw new McpError(ErrorCode.InternalError, `Rate limit exceeded for ${source}`);
  }
  
  rateLimits.set(key, count + 1);
  return true;
}

// Cache utilities
function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CONFIG.cacheTtl * 1000) {
    return cached.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Market data utilities
function isMarketHours() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // Weekend check
  if (day === 0 || day === 6) return false;
  
  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30; // 9:30 AM in minutes
  const marketClose = 16 * 60; // 4:00 PM in minutes
  const currentTime = hour * 60 + minute;
  
  return currentTime >= marketOpen && currentTime <= marketClose;
}

// Data source implementations
class DataSources {
  static async yahooQuote(symbol) {
    try {
      const quote = await yahooFinance.quote(symbol);
      return {
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        previousClose: quote.regularMarketPreviousClose,
        open: quote.regularMarketOpen,
        dayHigh: quote.regularMarketDayHigh,
        dayLow: quote.regularMarketDayLow,
        timestamp: new Date(),
        source: 'yahoo'
      };
    } catch (error) {
      log('error', 'Yahoo Finance error', { symbol, error: error.message });
      throw error;
    }
  }

  static async finnhubQuote(symbol) {
    if (!finnhubClient) throw new Error('Finnhub API key not configured');
    
    try {
      checkRateLimit('finnhub');
      const api = new finnhub.DefaultApi();
      
      const quote = await new Promise((resolve, reject) => {
        api.quote(symbol, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });

      return {
        symbol,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        previousClose: quote.pc,
        open: quote.o,
        dayHigh: quote.h,
        dayLow: quote.l,
        timestamp: new Date(quote.t * 1000),
        source: 'finnhub'
      };
    } catch (error) {
      log('error', 'Finnhub error', { symbol, error: error.message });
      throw error;
    }
  }

  static async alphaVantageQuote(symbol) {
    if (!CONFIG.alphaVantageApiKey) throw new Error('Alpha Vantage API key not configured');
    
    try {
      checkRateLimit('alphavantage');
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${CONFIG.alphaVantageApiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      
      const quote = data['Global Quote'];
      if (!quote) throw new Error('No data found');

      return {
        symbol: quote['01. symbol'],
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change']),
        changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
        previousClose: parseFloat(quote['08. previous close']),
        open: parseFloat(quote['02. open']),
        dayHigh: parseFloat(quote['03. high']),
        dayLow: parseFloat(quote['04. low']),
        volume: parseInt(quote['06. volume']),
        timestamp: new Date(quote['07. latest trading day']),
        source: 'alphavantage'
      };
    } catch (error) {
      log('error', 'Alpha Vantage error', { symbol, error: error.message });
      throw error;
    }
  }

  static async getQuoteWithFallback(symbol) {
    const cacheKey = `quote_${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const sources = [
      () => this.finnhubQuote(symbol),
      () => this.alphaVantageQuote(symbol),
      () => this.yahooQuote(symbol)
    ];

    for (const source of sources) {
      try {
        const result = await source();
        setCache(cacheKey, result);
        return result;
      } catch (error) {
        log('debug', 'Data source failed, trying next', { error: error.message });
        continue;
      }
    }

    throw new McpError(ErrorCode.InternalError, `Unable to fetch quote for ${symbol}`);
  }

  static async getHistoricalData(symbol, period = '1y', interval = '1d') {
    const cacheKey = `historical_${symbol}_${period}_${interval}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const result = await yahooFinance.historical(symbol, {
        period1: this.getPeriodStartDate(period),
        period2: new Date(),
        interval
      });

      const formattedData = result.map(bar => ({
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        adjClose: bar.adjClose
      }));

      setCache(cacheKey, formattedData);
      return formattedData;
    } catch (error) {
      log('error', 'Historical data error', { symbol, error: error.message });
      throw new McpError(ErrorCode.InternalError, `Unable to fetch historical data for ${symbol}`);
    }
  }

  static getPeriodStartDate(period) {
    const now = new Date();
    const periodMap = {
      '1d': 1,
      '5d': 5,
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1y': 365,
      '2y': 730,
      '5y': 1825,
      '10y': 3650
    };

    const days = periodMap[period] || 365;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
}

// Technical analysis calculations
class TechnicalAnalysis {
  static calculateSMA(data, period) {
    const sma = [];
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val.close, 0);
      sma.push({
        date: data[i].date,
        value: sum / period
      });
    }
    return sma;
  }

  static calculateEMA(data, period) {
    if (data.length < period) return [];
    
    const multiplier = 2 / (period + 1);
    const ema = [];
    
    // First EMA value is the SMA
    const firstSMA = data.slice(0, period).reduce((acc, val) => acc + val.close, 0) / period;
    ema.push({ date: data[period - 1].date, value: firstSMA });
    
    for (let i = period; i < data.length; i++) {
      const value = (data[i].close * multiplier) + (ema[ema.length - 1].value * (1 - multiplier));
      ema.push({ date: data[i].date, value });
    }
    
    return ema;
  }

  static calculateRSI(data, period = 14) {
    if (data.length < period + 1) return [];
    
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    const rsi = [];
    for (let i = period - 1; i < gains.length; i++) {
      const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      
      const rs = avgGain / avgLoss;
      const rsiValue = 100 - (100 / (1 + rs));
      
      rsi.push({
        date: data[i + 1].date,
        value: rsiValue
      });
    }
    
    return rsi;
  }

  static calculateBollingerBands(data, period = 20, stdDev = 2) {
    const sma = this.calculateSMA(data, period);
    const bands = [];

    for (let i = 0; i < sma.length; i++) {
      const dataSlice = data.slice(i, i + period);
      const mean = sma[i].value;
      const variance = dataSlice.reduce((acc, val) => acc + Math.pow(val.close - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);

      bands.push({
        date: sma[i].date,
        middle: mean,
        upper: mean + (standardDeviation * stdDev),
        lower: mean - (standardDeviation * stdDev)
      });
    }

    return bands;
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'trading-view-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'getCurrentQuote',
        description: 'Get real-time quote for a stock symbol',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol (e.g., AAPL, GOOGL)' }
          },
          required: ['symbol']
        }
      },
      {
        name: 'getMultipleQuotes',
        description: 'Get real-time quotes for multiple symbols',
        inputSchema: {
          type: 'object',
          properties: {
            symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of stock symbols'
            }
          },
          required: ['symbols']
        }
      },
      {
        name: 'getHistoricalData',
        description: 'Get historical price data for a symbol',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            period: { 
              type: 'string', 
              enum: ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y'],
              description: 'Time period for historical data',
              default: '1y'
            },
            interval: {
              type: 'string',
              enum: ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'],
              description: 'Data interval',
              default: '1d'
            }
          },
          required: ['symbol']
        }
      },
      {
        name: 'getTechnicalIndicators',
        description: 'Calculate technical indicators for a symbol',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            indicator: {
              type: 'string',
              enum: ['SMA', 'EMA', 'RSI', 'BOLLINGER'],
              description: 'Technical indicator type'
            },
            period: { 
              type: 'number', 
              description: 'Period for calculation (e.g., 20 for 20-day SMA)',
              default: 20
            }
          },
          required: ['symbol', 'indicator']
        }
      },
      {
        name: 'getMarketStatus',
        description: 'Check if market is currently open',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'searchSymbols',
        description: 'Search for stock symbols',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (company name or symbol)' }
          },
          required: ['query']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'getCurrentQuote': {
        const quote = await DataSources.getQuoteWithFallback(args.symbol);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              symbol: quote.symbol,
              price: quote.price,
              change: quote.change,
              changePercent: quote.changePercent,
              volume: quote.volume,
              marketCap: quote.marketCap,
              dayRange: `${quote.dayLow} - ${quote.dayHigh}`,
              previousClose: quote.previousClose,
              open: quote.open,
              timestamp: quote.timestamp,
              source: quote.source,
              isMarketOpen: isMarketHours()
            }, null, 2)
          }]
        };
      }

      case 'getMultipleQuotes': {
        const quotes = await Promise.allSettled(
          args.symbols.map(symbol => DataSources.getQuoteWithFallback(symbol))
        );
        
        const results = quotes.map((result, index) => ({
          symbol: args.symbols[index],
          success: result.status === 'fulfilled',
          data: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason.message : null
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }]
        };
      }

      case 'getHistoricalData': {
        const data = await DataSources.getHistoricalData(
          args.symbol,
          args.period || '1y',
          args.interval || '1d'
        );
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              symbol: args.symbol,
              period: args.period || '1y',
              interval: args.interval || '1d',
              dataPoints: data.length,
              data: data.slice(-100), // Return last 100 points to avoid huge responses
              summary: {
                firstDate: data[0]?.date,
                lastDate: data[data.length - 1]?.date,
                priceRange: {
                  high: Math.max(...data.map(d => d.high)),
                  low: Math.min(...data.map(d => d.low))
                }
              }
            }, null, 2)
          }]
        };
      }

      case 'getTechnicalIndicators': {
        const historicalData = await DataSources.getHistoricalData(args.symbol, '1y', '1d');
        let result;

        switch (args.indicator) {
          case 'SMA':
            result = TechnicalAnalysis.calculateSMA(historicalData, args.period || 20);
            break;
          case 'EMA':
            result = TechnicalAnalysis.calculateEMA(historicalData, args.period || 20);
            break;
          case 'RSI':
            result = TechnicalAnalysis.calculateRSI(historicalData, args.period || 14);
            break;
          case 'BOLLINGER':
            result = TechnicalAnalysis.calculateBollingerBands(historicalData, args.period || 20);
            break;
          default:
            throw new McpError(ErrorCode.InvalidParams, `Unknown indicator: ${args.indicator}`);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              symbol: args.symbol,
              indicator: args.indicator,
              period: args.period,
              data: result.slice(-50), // Last 50 points
              current: result[result.length - 1]
            }, null, 2)
          }]
        };
      }

      case 'getMarketStatus': {
        const isOpen = isMarketHours();
        const now = new Date();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              isMarketOpen: isOpen,
              currentTime: now.toISOString(),
              marketHours: '9:30 AM - 4:00 PM ET',
              nextMarketOpen: isOpen ? null : 'Next market day at 9:30 AM ET',
              timezone: 'America/New_York'
            }, null, 2)
          }]
        };
      }

      case 'searchSymbols': {
        try {
          const searchResults = await yahooFinance.search(args.query);
          const symbols = searchResults.quotes.slice(0, 10).map(quote => ({
            symbol: quote.symbol,
            name: quote.longname || quote.shortname,
            exchange: quote.exchange,
            type: quote.quoteType
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query: args.query,
                results: symbols
              }, null, 2)
            }]
          };
        } catch (error) {
          throw new McpError(ErrorCode.InternalError, `Search failed: ${error.message}`);
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    log('error', 'Tool execution failed', { tool: name, error: error.message });
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, error.message);
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'tradingview://market-overview',
        mimeType: 'application/json',
        name: 'Market Overview',
        description: 'Current market overview with popular symbols'
      },
      {
        uri: 'tradingview://trending-stocks',
        mimeType: 'application/json',
        name: 'Trending Stocks',
        description: 'Currently trending stocks with momentum'
      },
      {
        uri: 'tradingview://market-movers',
        mimeType: 'application/json',
        name: 'Market Movers',
        description: 'Biggest gainers and losers in the market'
      }
    ]
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    switch (uri) {
      case 'tradingview://market-overview': {
        const quotes = await Promise.allSettled(
          CONFIG.popularSymbols.map(symbol => DataSources.getQuoteWithFallback(symbol))
        );

        const marketData = quotes
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value);

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              timestamp: new Date().toISOString(),
              marketStatus: {
                isOpen: isMarketHours(),
                session: isMarketHours() ? 'regular' : 'closed'
              },
              symbols: marketData,
              summary: {
                totalSymbols: marketData.length,
                gainers: marketData.filter(q => q.change > 0).length,
                losers: marketData.filter(q => q.change < 0).length,
                unchanged: marketData.filter(q => q.change === 0).length
              }
            }, null, 2)
          }]
        };
      }

      case 'tradingview://trending-stocks': {
        // For demonstration, we'll use popular symbols
        // In production, this could connect to trending APIs
        const trendingSymbols = ['AAPL', 'TSLA', 'NVDA', 'AMD', 'GOOGL'];
        const quotes = await Promise.allSettled(
          trendingSymbols.map(symbol => DataSources.getQuoteWithFallback(symbol))
        );

        const trendingData = quotes
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value)
          .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              timestamp: new Date().toISOString(),
              trending: trendingData.map(quote => ({
                symbol: quote.symbol,
                price: quote.price,
                change: quote.change,
                changePercent: quote.changePercent,
                volume: quote.volume,
                momentum: Math.abs(quote.changePercent) > 2 ? 'high' : 'moderate'
              }))
            }, null, 2)
          }]
        };
      }

      case 'tradingview://market-movers': {
        const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'CRM'];
        const quotes = await Promise.allSettled(
          symbols.map(symbol => DataSources.getQuoteWithFallback(symbol))
        );

        const validQuotes = quotes
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value);

        const gainers = validQuotes
          .filter(q => q.changePercent > 0)
          .sort((a, b) => b.changePercent - a.changePercent)
          .slice(0, 5);

        const losers = validQuotes
          .filter(q => q.changePercent < 0)
          .sort((a, b) => a.changePercent - b.changePercent)
          .slice(0, 5);

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              timestamp: new Date().toISOString(),
              gainers: gainers.map(q => ({
                symbol: q.symbol,
                price: q.price,
                change: q.change,
                changePercent: q.changePercent
              })),
              losers: losers.map(q => ({
                symbol: q.symbol,
                price: q.price,
                change: q.change,
                changePercent: q.changePercent
              }))
            }, null, 2)
          }]
        };
      }

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }
  } catch (error) {
    log('error', 'Resource read failed', { uri, error: error.message });
    throw new McpError(ErrorCode.InternalError, error.message);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'TradingView MCP Server started successfully', {
    version: '1.0.0',
    dataSource: CONFIG.defaultDataSource,
    realTimeEnabled: CONFIG.enableRealTime,
    popularSymbols: CONFIG.popularSymbols.length
  });
}

main().catch((error) => {
  log('error', 'Server startup failed', { error: error.message });
  process.exit(1);
}); 