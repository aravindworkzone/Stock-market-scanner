import indexStock from './index-stock.service.js';

async function main() {
  indexStock("NIFTY 500");
}

main().catch(console.error);