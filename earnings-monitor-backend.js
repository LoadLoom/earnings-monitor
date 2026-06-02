require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const PORT = process.env.PORT || 3000;

let monitoredTickers = new Set();
let lastCheckedEarnings = {};

async function fetchEarningsCalendar() {
  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?token=${FINNHUB_KEY}`
    );
    const data = await response.json();
    return data.earnings || [];
  } catch (error) {
    console.error('Error fetching earnings:', error);
    return [];
  }
}

async function fetchStockQuote(ticker) {
  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching quote for ${ticker}:`, error);
    return null;
  }
}

function isToday(dateString) {
  const today = new Date();
  const dateObj = new Date(dateString);
  return dateObj.toDateString() === today.toDateString();
}

function isThisWeek(dateString) {
  const today = new Date();
  const dateObj = new Date(dateString);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  return dateObj >= today && dateObj <= weekEnd;
}

async function sendDiscordAlert(ticker, summary, isGood) {
  if (!DISCORD_WEBHOOK) return;
  
  const color = isGood ? 3066993 : 15158332;
  const status = isGood ? '✓ GOOD - BUY SIGNAL' : '✗ NOT GOOD - CAUTION';
  
  const embed = {
    title: `${ticker} Earnings Released`,
    description: summary,
    color: color,
    fields: [
      { name: 'Action', value: status, inline: false },
      { name: 'Time', value: new Date().toLocaleTimeString(), inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    console.log(`Alert sent for ${ticker}`);
  } catch (error) {
    console.error('Error sending Discord alert:', error);
  }
}

function generateSummary(earning) {
  if (!earning.epsActual || !earning.revenueActual) {
    return 'Data not yet available - checking again...';
  }
  
  const epsDiff = ((earning.epsActual - earning.epsExpected) / earning.epsExpected * 100).toFixed(2);
  const revDiff = ((earning.revenueActual - earning.revenueExpected) / earning.revenueExpected * 100).toFixed(2);
  
  const epsStatus = epsDiff > 0 ? `Beat by ${epsDiff}%` : `Missed by ${Math.abs(epsDiff)}%`;
  const revStatus = revDiff > 0 ? `Beat by ${revDiff}%` : `Missed by ${Math.abs(revDiff)}%`;
  
  return `EPS: $${earning.epsActual.toFixed(2)} (expected $${earning.epsExpected.toFixed(2)}) - ${epsStatus}\nRevenue: $${earning.revenueActual.toFixed(1)}B (expected $${earning.revenueExpected.toFixed(1)}B) - ${revStatus}`;
}

async function monitorEarnings() {
  console.log(`\n[${new Date().toLocaleTimeString()}] Checking for earnings releases...`);
  
  const earnings = await fetchEarningsCalendar();
  
  const todayEarnings = earnings.filter(e => isToday(e.date));
  const weekEarnings = earnings.filter(e => isThisWeek(e.date));
  
  console.log(`Found ${todayEarnings.length} earnings today, ${weekEarnings.length} this week`);
  
  for (const earning of weekEarnings) {
    const ticker = earning.symbol;
    
    if (lastCheckedEarnings[ticker] && lastCheckedEarnings[ticker].epsActual) {
      continue;
    }
    
    const quote = await fetchStockQuote(ticker);
    
    if (earning.epsActual && earning.revenueActual) {
      const isGood = earning.epsActual > earning.epsExpected && earning.revenueActual > earning.revenueExpected;
      const summary = generateSummary(earning);
      
      await sendDiscordAlert(ticker, summary, isGood);
      lastCheckedEarnings[ticker] = earning;
    }
  }
}

app.get('/', (req, res) => {
  res.json({ 
    status: 'Running',
    message: 'Earnings monitor active - monitoring in real-time',
    lastCheck: new Date().toISOString(),
    monitored: Array.from(monitoredTickers)
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ healthy: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Earnings Monitor Running on port ${PORT}`);
  console.log(`📅 Monitoring for earnings starting: ${new Date().toISOString()}`);
  console.log(`⏰ Checking every 60 seconds\n`);
  
  monitorEarnings();
  setInterval(monitorEarnings, 60000);
});
