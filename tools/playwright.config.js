// @ts-check
// Testovací soubory žijí v ../tests/e2e, mimo tools/node_modules — Node by tam
// `require('@playwright/test')` nedohledal (resolution chodí jen po rodičích,
// ne po sourozencích). NODE_PATH musí být v env PŘED spuštěním workeru, proto
// se nastavuje tady a ne přímo v package.json/testu.
const path = require('path');
process.env.NODE_PATH = process.env.NODE_PATH
  ? `${path.join(__dirname, 'node_modules')}${path.delimiter}${process.env.NODE_PATH}`
  : path.join(__dirname, 'node_modules');
require('module').Module._initPaths();

const { defineConfig } = require('@playwright/test');

const BASE_URL = 'http://localhost:4173';

module.exports = defineConfig({
  testDir: '../tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx http-server .. -p 4173 -c-1 -s',
    url: BASE_URL,
    reuseExistingServer: true,
  },
});
