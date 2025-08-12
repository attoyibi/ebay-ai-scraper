import { Injectable } from '@nestjs/common';
import { chromium, Page, BrowserContext } from 'playwright';

async function gotoWithRetry(page: Page, url: string, maxRetries = 3) {
    for (let i = 1; i <= maxRetries; i++) {
        try {
            console.log(`[SCRAPER] goto attempt ${i}: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            return;
        } catch (e) {
            console.warn('[SCRAPER] goto failed:', i, String(e));
            if (i === maxRetries) throw e;
            await page.waitForTimeout(1500 * i);
        }
    }
}

@Injectable()
export class ScrapeService {
    async scrapeEbay(keyword: string) {
        const primary = process.env.EBAY_DOMAIN || 'www.ebay.com';
        const fallback = process.env.EBAY_ALT_DOMAIN || 'www.ebay.co.uk';

        const makeUrl = (domain: string) =>
            `https://${domain}/sch/i.html?_nkw=${encodeURIComponent(keyword)}&_pgn=1`;

        const browser = await chromium.launch({ headless: false, slowMo: 200 });
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            locale: 'en-US',
            viewport: { width: 1280, height: 800 },
            timezoneId: 'UTC',
        });

        try {
            const page = await context.newPage();
            let urlTried = makeUrl(primary);

            console.log('[SCRAPER] start', { keyword, urlTried });

            // 1) coba .com dulu, kalau gagal → coba .co.uk
            try {
                await gotoWithRetry(page, urlTried, 3);
            } catch {
                urlTried = makeUrl(fallback);
                console.log('[SCRAPER] switching to fallback domain:', urlTried);
                await gotoWithRetry(page, urlTried, 3);
            }

            // (opsional) klik consent kalau ada, biar nggak nutup view
            try {
                await page.waitForTimeout(500);
                const accept = page.getByRole('button', { name: /accept/i }).first();
                if (await accept.count()) {
                    await accept.click({ timeout: 3000 }).catch(() => { });
                    console.log('[SCRAPER] consent clicked');
                }
            } catch { }

            // await page.locator('li.s-item').first().waitFor({ timeout: 30000 }).catch(() => {
            //     console.error('[SCRAPER] item not found');
            // });
            // selector persis dari HTML kamu
            const TITLE_STRICT = 'div[role="heading"][aria-level="3"].s-card__title > .su-styled-text';


            // tunggu minimal satu title muncul
            await page.waitForSelector(TITLE_STRICT, { timeout: 30_000 }).catch(() => { });

            // bantu lazy-load dikit
            await page.waitForTimeout(500);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(800);

            // KUMPULKAN SEMUA TITLE (strict + fallback), bersihkan kosong & duplikat
            const titles: string[] = await page.evaluate(() => {
                const getText = (el: Element | null) => (el?.textContent || '').replace(/\s+\n/g, ' ').trim();

                const strictSel = 'div[role="heading"][aria-level="3"].s-card__title > .su-styled-text';
                const strict = Array.from(document.querySelectorAll(strictSel)).map(getText);

                // fallback kecil ke UI lama, kalau ada
                const fallback = Array.from(document.querySelectorAll('h3.s-item__title')).map(getText);

                const merged = [...strict, ...fallback]
                    .map(t => t.trim())
                    .filter(t => t && !/shop on ebay/i.test(t)); // buang placeholder/iklan

                // hilangkan duplikat, pertahankan urutan
                return Array.from(new Set(merged));
            });

            titles.forEach((t, i) => console.log(`#${i + 1}: ${t}`));

            console.log('[SCRAPER] items visible');

            // biar kelihatan 2 detik
            await page.waitForTimeout(2000);

            return { ok: true, message: `Opened eBay OK for "${keyword}"`, url: urlTried, item: { titles }, };
        } catch (error) {
            console.error('[SCRAPER] error', String(error));
            return { ok: false, error: String(error) };
        } finally {
            await browser.close(); // <- selalu tutup di finally
        }
    }
}
