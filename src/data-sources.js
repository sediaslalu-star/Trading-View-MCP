import yahooFinance from 'yahoo-finance2';
import finnhub from 'finnhub';
import fetch from 'node-fetch';

/**
 * Data Sources Module
 * Handles all external data source integrations
 */

export class DataSourceManager {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.rateLimits = new Map();
    this.finnhubClient = null;
    
    if (config.finnhubApiKey) {
      this.finnhubClient = finnhub.ApiClient.instance;
      this.finnhubClient.authentications['api_key'].apiKey = config.finnhubApiKey;
    }
  }

  // Cache utilities
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtl * 1000) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // Rate limiting
  checkRateLimit(source) {
    const now = Date.now();
    const key = `${source}_${Math.floor(now / 60000)}`;
    const count = this.rateLimits.get(key) || 0;
    
    if (count >= this.config.maxRequestsPerMinute) {
      throw new Error(`Rate limit exceeded for ${source}`);
    }
    
    this.rateLimits.set(key, count + 1);
    return true;
  }

  // Yahoo Finance implementation
  async yahooQuote(symbol) {
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
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        averageVolume: quote.averageDailyVolume3Month,
        pe: quote.trailingPE,
        eps: quote.trailingEps,
        beta: quote.beta,
        timestamp: new Date(),
        source: 'yahoo'
      };
    } catch (error) {
      throw new Error(`Yahoo Finance error for ${symbol}: ${error.message}`);
    }
  }

  // Finnhub implementation
  async finnhubQuote(symbol) {
    if (!this.finnhubClient) throw new Error('Finnhub API key not configured');
    
    try {
      this.checkRateLimit('finnhub');
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
      throw new Error(`Finnhub error for ${symbol}: ${error.message}`);
    }
  }

  // Alpha Vantage implementation
  async alphaVantageQuote(symbol) {
    if (!this.config.alphaVantageApiKey) throw new Error('Alpha Vantage API key not configured');
    
    try {
      this.checkRateLimit('alphavantage');
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.config.alphaVantageApiKey}`;
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
      throw new Error(`Alpha Vantage error for ${symbol}: ${error.message}`);
    }
  }

  // Main quote method with fallbacks
  async getQuote(symbol) {
    const cacheKey = `quote_${symbol}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const sources = [
      () => this.finnhubQuote(symbol),
      () => this.alphaVantageQuote(symbol),
      () => this.yahooQuote(symbol)
    ];

    for (const source of sources) {
      try {
        const result = await source();
        this.setCache(cacheKey, result);
        return result;
      } catch (error) {
        console.log(`Data source failed: ${error.message}, trying next...`);
        continue;
      }
    }

    throw new Error(`Unable to fetch quote for ${symbol}`);
  }

  // Historical data
  async getHistoricalData(symbol, period = '1y', interval = '1d') {
    const cacheKey = `historical_${symbol}_${period}_${interval}`;
    const cached = this.getCached(cacheKey);
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

      this.setCache(cacheKey, formattedData);
      return formattedData;
    } catch (error) {
      throw new Error(`Unable to fetch historical data for ${symbol}: ${error.message}`);
    }
  }

  // Company profile from Finnhub
  async getCompanyProfile(symbol) {
    if (!this.finnhubClient) throw new Error('Finnhub API key required for company profiles');
    
    const cacheKey = `profile_${symbol}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      this.checkRateLimit('finnhub');
      const api = new finnhub.DefaultApi();
      
      const profile = await new Promise((resolve, reject) => {
        api.companyProfile2({'symbol': symbol}, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });

      const result = {
        symbol: profile.ticker,
        name: profile.name,
        country: profile.country,
        currency: profile.currency,
        exchange: profile.exchange,
        ipo: profile.ipo,
        marketCapitalization: profile.marketCapitalization,
        shareOutstanding: profile.shareOutstanding,
        logo: profile.logo,
        phone: profile.phone,
        weburl: profile.weburl,
        industry: profile.finnhubIndustry,
        source: 'finnhub'
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      throw new Error(`Unable to fetch company profile for ${symbol}: ${error.message}`);
    }
  }

  // News from Finnhub
  async getNews(symbol, from = null, to = null) {
    if (!this.finnhubClient) throw new Error('Finnhub API key required for news');
    
    const cacheKey = `news_${symbol}_${from}_${to}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      this.checkRateLimit('finnhub');
      const api = new finnhub.DefaultApi();
      
      const fromDate = from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const toDate = to || new Date().toISOString().split('T')[0];
      
      const news = await new Promise((resolve, reject) => {
        api.companyNews(symbol, fromDate, toDate, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });

      const result = news.slice(0, 10).map(article => ({
        headline: article.headline,
        summary: article.summary,
        source: article.source,
        url: article.url,
        datetime: new Date(article.datetime * 1000),
        category: article.category,
        image: article.image
      }));

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      throw new Error(`Unable to fetch news for ${symbol}: ${error.message}`);
    }
  }

  // Earnings calendar
  async getEarnings(symbol) {
    if (!this.finnhubClient) throw new Error('Finnhub API key required for earnings');
    
    const cacheKey = `earnings_${symbol}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      this.checkRateLimit('finnhub');
      const api = new finnhub.DefaultApi();
      
      const from = new Date().toISOString().split('T')[0];
      const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const earnings = await new Promise((resolve, reject) => {
        api.earningsCalendar({from, to, symbol}, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });

      const result = earnings.earningsCalendar?.map(earning => ({
        date: earning.date,
        epsActual: earning.epsActual,
        epsEstimate: earning.epsEstimate,
        hour: earning.hour,
        quarter: earning.quarter,
        revenueActual: earning.revenueActual,
        revenueEstimate: earning.revenueEstimate,
        symbol: earning.symbol,
        year: earning.year
      })) || [];

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      throw new Error(`Unable to fetch earnings for ${symbol}: ${error.message}`);
    }
  }

  // Search symbols
  async searchSymbols(query) {
    const cacheKey = `search_${query}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const searchResults = await yahooFinance.search(query);
      const symbols = searchResults.quotes.slice(0, 10).map(quote => ({
        symbol: quote.symbol,
        name: quote.longname || quote.shortname,
        exchange: quote.exchange,
        type: quote.quoteType,
        score: quote.score
      }));

      this.setCache(cacheKey, symbols);
      return symbols;
    } catch (error) {
      throw new Error(`Search failed for "${query}": ${error.message}`);
    }
  }

  // Cryptocurrency data
  async getCryptoQuote(symbol) {
    const cacheKey = `crypto_${symbol}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      // For crypto, we'll use a free API
      const response = await fetch(`https://api.coindesk.com/v1/bpi/currentprice/${symbol}.json`);
      if (!response.ok) {
        // Fallback to Yahoo Finance for crypto symbols like BTC-USD
        return await this.yahooQuote(`${symbol}-USD`);
      }
      
      const data = await response.json();
      const result = {
        symbol: `${symbol}-USD`,
        price: parseFloat(data.bpi[symbol].rate_float),
        currency: data.bpi[symbol].code,
        description: data.bpi[symbol].description,
        timestamp: new Date(data.time.updatedISO),
        source: 'coindesk'
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      // Fallback to Yahoo Finance
      return await this.yahooQuote(`${symbol}-USD`);
    }
  }

  // Utility methods
  getPeriodStartDate(period) {
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

  // Market status
  isMarketHours() {
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

  // Get popular symbols data
  async getPopularSymbolsData() {
    const symbols = this.config.popularSymbols || ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'];
    const quotes = await Promise.allSettled(
      symbols.map(symbol => this.getQuote(symbol))
    );

    return quotes
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
  }

  // Get market movers
  async getMarketMovers() {
    const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'CRM'];
    const quotes = await Promise.allSettled(
      symbols.map(symbol => this.getQuote(symbol))
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

    return { gainers, losers };
  }
} 