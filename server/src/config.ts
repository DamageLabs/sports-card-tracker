import path from 'path';

export interface Config {
  port: number;
  frontendUrl: string;
  dataDir: string;
  rawDir: string;
  processedDir: string;
  dbPath: string;
  jwtSecret: string;
  jobPollInterval: number;
  puppeteerEnabled: boolean;
  puppeteerHeadless: boolean;
  compCacheTtlMs: number;
  rateLimits: Record<string, number>;
  ebayImageBaseUrl: string;
  gcpScpHost: string;
  gcpScpUser: string;
  gcpScpPort: number;
  gcpScpKeyPath: string;
  gcpScpRemoteDir: string;
  gcpImageBaseUrl: string;
}

export function loadConfig(): Config {
  const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../..');
  const port = parseInt(process.env.PORT || '8000', 10);

  return {
    port,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    dataDir,
    rawDir: process.env.RAW_DIR || path.join(dataDir, 'raw'),
    processedDir: process.env.PROCESSED_DIR || path.join(dataDir, 'processed'),
    dbPath: process.env.DB_PATH || path.join(dataDir, 'server', 'database.sqlite'),
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jobPollInterval: parseInt(process.env.JOB_POLL_INTERVAL || '5000', 10),
    puppeteerEnabled: process.env.PUPPETEER_ENABLED !== 'false',
    puppeteerHeadless: process.env.PUPPETEER_HEADLESS !== 'false',
    compCacheTtlMs: parseInt(process.env.COMP_CACHE_TTL_MS || '86400000', 10),
    ebayImageBaseUrl: process.env.EBAY_IMAGE_BASE_URL || `http://localhost:${port}`,
    gcpScpHost: process.env.GCP_SCP_HOST || '',
    gcpScpUser: process.env.GCP_SCP_USER || '',
    gcpScpPort: parseInt(process.env.GCP_SCP_PORT || '22', 10),
    gcpScpKeyPath: process.env.GCP_SCP_KEY_PATH || '',
    gcpScpRemoteDir: process.env.GCP_SCP_REMOTE_DIR || '',
    gcpImageBaseUrl: process.env.GCP_IMAGE_BASE_URL || '',
    rateLimits: {
      eBay: parseInt(process.env.RATE_LIMIT_EBAY || '2000', 10),
      SportsCardsPro: parseInt(process.env.RATE_LIMIT_SPORTSCARDSPRO || '1000', 10),
      CardLadder: parseInt(process.env.RATE_LIMIT_CARDLADDER || '1500', 10),
      MarketMovers: parseInt(process.env.RATE_LIMIT_MARKETMOVERS || '1500', 10),
      '130Point': parseInt(process.env.RATE_LIMIT_130POINT || '6000', 10),
      PSA: parseInt(process.env.RATE_LIMIT_PSA || '3000', 10),
      GemRate: parseInt(process.env.RATE_LIMIT_GEMRATE || '2000', 10),
    },
  };
}
