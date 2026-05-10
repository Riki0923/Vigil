import axios from 'axios';
import { ApifyClient } from 'apify-client';
import { execSync } from 'child_process';

export interface ApifyEnrichment {
  twitterMentions: any[];
  newsResults: any[];
  enrichedAt: string;
}

function getClient(): ApifyClient | null {
  const token = process.env.APIFY_API_KEY;
  if (!token) {
    console.warn('[Apify] No API key set, skipping enrichment');
    return null;
  }
  return new ApifyClient({ token });
}

async function runActorX402(actorId: string, input: any): Promise<any[]> {
  const privateKey = process.env.APIFY_X402_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[Apify X402] No private key set');
    return [];
  }

  const actorSlug = actorId.replace('/', '~');
  const url = `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items`;

  console.log('[Apify X402] Step 1, sending initial request without payment...');
  const firstResponse = await axios.post(
    url,
    input,
    {
      headers: {
        'X-APIFY-PAYMENT-PROTOCOL': 'X402',
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    }
  );
  console.log('[Apify X402] First response status:', firstResponse.status);
  console.log('[Apify X402] First response headers:', JSON.stringify(firstResponse.headers));

  if (firstResponse.status !== 402) {
    return firstResponse.data ?? [];
  }

  console.log('[Apify X402] Payment required, signing...');
  const paymentRequired = firstResponse.headers['payment-required'] ?? firstResponse.headers['PAYMENT-REQUIRED'];
  console.log('[Apify X402] Payment required header value:', paymentRequired);

  const mcpcOutput = execSync(`mcpc x402 sign ${paymentRequired}`, { encoding: 'utf8' });
  console.log('[Apify X402] mcpc full output:', mcpcOutput);
  const lines = mcpcOutput.split('\n');
  const sigHeaderIndex = lines.findIndex(l => l.includes('PAYMENT-SIGNATURE header:'));
  const signature = lines[sigHeaderIndex + 1]?.trim();
  console.log('[Apify X402] Extracted signature:', signature?.substring(0, 50));
  console.log('[Apify X402] Payment signed and sent');

  const secondResponse = await axios.post(
    url,
    input,
    {
      headers: {
        'X-APIFY-PAYMENT-PROTOCOL': 'X402',
        'PAYMENT-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  console.log('[Apify X402] Second response status:', secondResponse.status);
  console.log('[Apify X402] Second response data length:', secondResponse.data?.length);
  console.log('[Apify X402] Response data sample:', JSON.stringify(secondResponse.data).substring(0, 200));
  console.log('[Apify X402] Actor completed successfully');

  const items = secondResponse.data ?? [];
  const organicResults = items.flatMap((item: any) => item.organicResults ?? []);
  console.log('[Apify X402] Organic results count:', organicResults.length);
  if (organicResults.length > 0) {
    console.log('[Apify X402] First result:', organicResults[0]?.title);
  }
  return organicResults;
}

async function scrapeTwitter(client: ApifyClient, query: string): Promise<any[]> {
  try {
    console.log(`[Apify] Scraping Twitter for: "${query}"`);
    const run = await client.actor('apify/twitter-scraper').call({
      searchTerms: [query],
      maxItems: 5,
      queryType: 'Latest',
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] Twitter: ${items.length} results`);
    return items;
  } catch (err: any) {
    console.error('[Apify] Twitter scrape failed:', err.message);
    return [];
  }
}

async function scrapeNews(client: ApifyClient, query: string): Promise<any[]> {
  try {
    console.log(`[Apify] Scraping news for: "${query}"`);
    const run = await client.actor('apify/google-search-scraper').call({
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] News: ${items.length} results`);
    return items;
  } catch (err: any) {
    console.error('[Apify] News scrape failed:', err.message);
    return [];
  }
}

export async function enrichAlert(proxyAddress: string, _implAddress: string): Promise<ApifyEnrichment> {
  const query = `ethereum proxy upgrade ${proxyAddress.substring(0, 10)}`;
  console.log(`[Apify] Enriching alert for proxy ${proxyAddress.substring(0, 10)}...`);

  if (process.env.APIFY_X402_PRIVATE_KEY) {
    console.log('[Apify] Using X402 payment mode');
    const newsResults = await runActorX402('apify/google-search-scraper', {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
    }).catch((err: any) => { console.error('[Apify X402] News failed:', err.message); return []; });
    return { twitterMentions: [], newsResults, enrichedAt: new Date().toISOString() };
  }

  const client = getClient();
  if (!client) return { twitterMentions: [], newsResults: [], enrichedAt: new Date().toISOString() };

  const [twitterMentions, newsResults] = await Promise.all([
    scrapeTwitter(client, query),
    scrapeNews(client, query),
  ]);

  return { twitterMentions, newsResults, enrichedAt: new Date().toISOString() };
}
