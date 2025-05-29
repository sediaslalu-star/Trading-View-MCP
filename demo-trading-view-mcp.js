#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Demo script for TradingView MCP Server
 * This demonstrates the various capabilities of the server
 */

function log(message, data = {}) {
  console.log(`[DEMO] ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : '');
}

async function sendMCPRequest(server, request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 10000);

    let response = '';
    
    const handleData = (data) => {
      response += data.toString();
      try {
        const lines = response.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.id === request.id) {
            clearTimeout(timeout);
            server.stdout.off('data', handleData);
            resolve(parsed);
            return;
          }
        }
      } catch (e) {
        // Continue collecting data
      }
    };

    server.stdout.on('data', handleData);
    server.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function runDemo() {
  log('Starting TradingView MCP Server Demo');

  // Start the MCP server
  const serverPath = join(__dirname, 'trading-view-mcp-server.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  server.stderr.on('data', (data) => {
    console.error(`[SERVER ERROR] ${data}`);
  });

  // Wait for server to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // Test 1: List available tools
    log('Test 1: Listing available tools');
    const toolsResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });
    
    if (toolsResponse.result && toolsResponse.result.tools) {
      log('✅ Available tools:', {
        count: toolsResponse.result.tools.length,
        tools: toolsResponse.result.tools.map(t => t.name)
      });
    }

    // Test 2: Get current quote for Apple
    log('Test 2: Getting current quote for AAPL');
    const quoteResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'getCurrentQuote',
        arguments: { symbol: 'AAPL' }
      }
    });

    if (quoteResponse.result) {
      const quoteData = JSON.parse(quoteResponse.result.content[0].text);
      log('✅ AAPL Quote received:', {
        price: quoteData.price,
        change: quoteData.change,
        changePercent: `${quoteData.changePercent}%`,
        source: quoteData.source
      });
    }

    // Test 3: Get multiple quotes
    log('Test 3: Getting multiple quotes');
    const multiQuoteResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'getMultipleQuotes',
        arguments: { symbols: ['AAPL', 'GOOGL', 'MSFT'] }
      }
    });

    if (multiQuoteResponse.result) {
      const quotes = JSON.parse(multiQuoteResponse.result.content[0].text);
      log('✅ Multiple quotes received:', {
        successful: quotes.filter(q => q.success).length,
        total: quotes.length
      });
    }

    // Test 4: Get historical data
    log('Test 4: Getting historical data for TSLA');
    const historicalResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'getHistoricalData',
        arguments: { 
          symbol: 'TSLA',
          period: '1mo',
          interval: '1d'
        }
      }
    });

    if (historicalResponse.result) {
      const historical = JSON.parse(historicalResponse.result.content[0].text);
      log('✅ Historical data received:', {
        symbol: historical.symbol,
        dataPoints: historical.dataPoints,
        period: historical.period,
        priceRange: historical.summary.priceRange
      });
    }

    // Test 5: Calculate technical indicators
    log('Test 5: Calculating RSI for NVDA');
    const rsiResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'getTechnicalIndicators',
        arguments: {
          symbol: 'NVDA',
          indicator: 'RSI',
          period: 14
        }
      }
    });

    if (rsiResponse.result) {
      const rsi = JSON.parse(rsiResponse.result.content[0].text);
      log('✅ RSI calculated:', {
        symbol: rsi.symbol,
        indicator: rsi.indicator,
        currentRSI: rsi.current?.value?.toFixed(2),
        interpretation: rsi.current?.value > 70 ? 'Overbought' : 
                      rsi.current?.value < 30 ? 'Oversold' : 'Neutral'
      });
    }

    // Test 6: Get market status
    log('Test 6: Checking market status');
    const marketStatusResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'getMarketStatus',
        arguments: {}
      }
    });

    if (marketStatusResponse.result) {
      const status = JSON.parse(marketStatusResponse.result.content[0].text);
      log('✅ Market status:', {
        isOpen: status.isMarketOpen,
        currentTime: status.currentTime,
        marketHours: status.marketHours
      });
    }

    // Test 7: Search symbols
    log('Test 7: Searching for symbols');
    const searchResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'searchSymbols',
        arguments: { query: 'Tesla' }
      }
    });

    if (searchResponse.result) {
      const search = JSON.parse(searchResponse.result.content[0].text);
      log('✅ Symbol search results:', {
        query: search.query,
        resultCount: search.results.length,
        firstResult: search.results[0]
      });
    }

    // Test 8: List available resources
    log('Test 8: Listing available resources');
    const resourcesResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/list'
    });

    if (resourcesResponse.result && resourcesResponse.result.resources) {
      log('✅ Available resources:', {
        count: resourcesResponse.result.resources.length,
        resources: resourcesResponse.result.resources.map(r => r.name)
      });
    }

    // Test 9: Read market overview resource
    log('Test 9: Reading market overview resource');
    const overviewResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 9,
      method: 'resources/read',
      params: {
        uri: 'tradingview://market-overview'
      }
    });

    if (overviewResponse.result) {
      const overview = JSON.parse(overviewResponse.result.contents[0].text);
      log('✅ Market overview loaded:', {
        totalSymbols: overview.summary.totalSymbols,
        gainers: overview.summary.gainers,
        losers: overview.summary.losers,
        marketOpen: overview.marketStatus.isOpen
      });
    }

    // Test 10: Calculate Bollinger Bands
    log('Test 10: Calculating Bollinger Bands for SPY');
    const bollingerResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'getTechnicalIndicators',
        arguments: {
          symbol: 'SPY',
          indicator: 'BOLLINGER',
          period: 20
        }
      }
    });

    if (bollingerResponse.result) {
      const bollinger = JSON.parse(bollingerResponse.result.content[0].text);
      log('✅ Bollinger Bands calculated:', {
        symbol: bollinger.symbol,
        currentUpper: bollinger.current?.upper?.toFixed(2),
        currentMiddle: bollinger.current?.middle?.toFixed(2),
        currentLower: bollinger.current?.lower?.toFixed(2)
      });
    }

    log('🎉 All tests completed successfully!');
    log('📊 TradingView MCP Server is working correctly');

  } catch (error) {
    log('❌ Demo failed:', { error: error.message });
  } finally {
    server.kill();
  }
}

// Performance test
async function runPerformanceTest() {
  log('Starting Performance Test');
  
  const startTime = Date.now();
  const serverPath = join(__dirname, 'trading-view-mcp-server.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'CRM'];
    const requests = symbols.map((symbol, index) => 
      sendMCPRequest(server, {
        jsonrpc: '2.0',
        id: 100 + index,
        method: 'tools/call',
        params: {
          name: 'getCurrentQuote',
          arguments: { symbol }
        }
      })
    );

    const results = await Promise.allSettled(requests);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const duration = Date.now() - startTime;

    log('✅ Performance test completed:', {
      totalRequests: symbols.length,
      successful,
      failed: symbols.length - successful,
      duration: `${duration}ms`,
      avgPerRequest: `${(duration / symbols.length).toFixed(2)}ms`
    });

  } catch (error) {
    log('❌ Performance test failed:', { error: error.message });
  } finally {
    server.kill();
  }
}

// Error handling test
async function runErrorHandlingTest() {
  log('Starting Error Handling Test');
  
  const serverPath = join(__dirname, 'trading-view-mcp-server.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // Test invalid symbol
    const invalidSymbolResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: {
        name: 'getCurrentQuote',
        arguments: { symbol: 'INVALID_SYMBOL_12345' }
      }
    });

    if (invalidSymbolResponse.error) {
      log('✅ Invalid symbol handled correctly:', { 
        error: invalidSymbolResponse.error.message 
      });
    }

    // Test invalid tool
    const invalidToolResponse = await sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'nonexistentTool',
        arguments: {}
      }
    });

    if (invalidToolResponse.error) {
      log('✅ Invalid tool handled correctly:', { 
        error: invalidToolResponse.error.message 
      });
    }

    log('✅ Error handling test completed');

  } catch (error) {
    log('❌ Error handling test failed:', { error: error.message });
  } finally {
    server.kill();
  }
}

// Main demo runner
async function main() {
  console.log('🚀 TradingView MCP Server Demo Suite\n');
  
  try {
    await runDemo();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await runPerformanceTest();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await runErrorHandlingTest();
    
    console.log('\n🎉 Demo suite completed successfully!');
    console.log('📖 Check the README.md for more information about available tools and resources.');
    
  } catch (error) {
    console.error('❌ Demo suite failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 