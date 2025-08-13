import { Injectable } from '@nestjs/common';
import { chromium, Page, BrowserContext } from 'playwright';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini'; // gpt-4o-mini, gpt-3.5-turbo, etc.

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
async function logDescriptionHTML(context: BrowserContext, link: string) {
    console.log(`\n[DESC HTML] masuk logDescriptionHTML -> ${link}`);
    const page = await context.newPage();
    try {
        await gotoWithRetry(page, link, 3);
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
        console.log('[DESC HTML] landed at:', page.url());

        // klik consent kalau ada (detail page kadang muncul lagi)
        try {
            const accept = page.getByRole('button', { name: /accept|agree|ok/i }).first();
            if (await accept.count()) {
                await accept.click({ timeout: 2000 }).catch(() => { });
                console.log('[DESC HTML] consent clicked on detail');
            }
        } catch { }

        // Expand jika ada
        const expander = page.getByRole('button', { name: /see full|show more/i }).first();
        if (await expander.count()) {
            await expander.click({ timeout: 2000 }).catch(() => { });
            await page.waitForTimeout(400);
            console.log('[DESC HTML] expanded');
        }

        // Scroll agar lazy content/iframe kebaca
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(700);

        const DESC_SELECTORS = [
            '[data-testid="ux-layout-section__item--description"]',
            '[data-testid="x-item-description"]',
            'section[aria-label="Description"]',
            '#viTabs_0_is',
            '#vi-desc-maincntr',
            '#vi-desc-maincntr2',
            '#desc_div',
            '.item-desc'
        ];
        const DESC_JOIN = DESC_SELECTORS.join(',');

        // Tunggu salah satu selector ATAU iframe deskripsi muncul
        const foundMain = await page.waitForSelector(DESC_JOIN, { timeout: 5000 }).catch(() => null);
        const foundIframe = await page.waitForSelector('iframe#desc_ifr, iframe[src*="desc"], iframe[title*="Description"]', { timeout: 6000 }).catch(() => null);

        let printed = false;

        // Ambil dari DOM utama (jika ada)
        for (const sel of DESC_SELECTORS) {
            const loc = page.locator(sel).first();
            if (await loc.count().catch(() => 0)) {
                const html = await loc.innerHTML().catch(() => '');
                if (html) {
                    console.log(`\n[DESC HTML] selector: ${sel}\n`, html);
                    const clean = htmlToCleanText(html, 3500);
                    console.log(`\n[DESC CLEAN] selector: ${sel}\n`, clean);

                    const pageTitle = await page.title().catch(() => '');
                    const summary = await summarizeWithOpenAI(pageTitle, clean);
                    console.log(`\n[DESC SUMMARY] ${summary}`);

                    printed = true;
                }
            }
        }

        // Fallback iframe (sering dipakai eBay)
        const frames = page.frames();
        for (const frame of frames) {
            if (/desc/i.test(frame.url())) {
                try {
                    const html = await frame.content();
                    console.log(`\n[DESC HTML - iframe: ${frame.url()}]\n`, html);
                    const clean = htmlToCleanText(html, 3500);
                    console.log(`\n[DESC CLEAN - iframe]\n`, clean);

                    const pageTitle = await page.title().catch(() => '');
                    const summary = await summarizeWithOpenAI(pageTitle, clean);
                    console.log(`\n[DESC SUMMARY] ${summary}`);

                    printed = true;
                } catch { }
            }
        }

        if (!printed) {
            console.log('[DESC HTML] no description selectors/iframe matched.');
            // Debug cepat: panjang content body
            const contentLen = (await page.content()).length;
            console.log('[DESC HTML] page.content length:', contentLen);
        }

    } catch (err) {
        console.error('Error getting description HTML:', err);
    } finally {
        await page.close().catch(() => { });
    }
}
function htmlToCleanText(html: string, limit = 3500): string {
    if (!html) return '-';

    // buang elemen yang tidak perlu
    html = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // ubah beberapa tag ke newline agar tetap terbaca
    html = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|li|div|section|tr|h[1-6]|article)>/gi, '\n');

    // ambil teks
    let text = html.replace(/<[^>]+>/g, ' ');

    // rapikan spasi & baris
    text = text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // buang boilerplate yang umum tidak relevan
    const BAD = /(seller assumes|report item|returns|refund|shipping|payment|powered by|ebay money back guarantee)/i;
    text = text
        .split('\n')
        .map(s => s.trim())
        .filter(s => s && !BAD.test(s))
        .join('\n');

    // batasi panjang supaya hemat (kalau nanti ke AI)
    if (text.length > limit) text = text.slice(0, limit) + '…';

    return text || '-';
}

async function summarizeWithOpenAI(title: string, cleanText: string): Promise<string> {
    if (!cleanText || cleanText === '-') return '-';
    try {
        const trimmed = cleanText.length > 3500 ? cleanText.slice(0, 3500) + '…' : cleanText;
        const resp = await openai.responses.create({
            model: OPENAI_MODEL, // misal 'gpt-4o-mini'
            instructions:
                'Ringkas deskripsi produk e-commerce secara objektif (Bahasa Indonesia), maksimal 2 kalimat. Jangan ada promosi.',
            input: `Judul: ${title}\nTeks:\n${trimmed}\n\nRingkas jadi 1–2 kalimat.`,
            max_output_tokens: 160,
            temperature: 0.2,
        });
        return (resp as any).output_text?.trim?.() || '-';
    } catch (err) {
        console.warn('[AI] summarize error:', err);
        return '-';
    }
}



@Injectable()
export class ScrapeService {
    async scrapeEbay(keyword: string) {
        const primary = process.env.EBAY_DOMAIN || 'www.ebay.com';
        const fallback = process.env.EBAY_ALT_DOMAIN || 'www.ebay.co.uk';

        // ⬇️ now accepts page number
        const makeUrl = (domain: string, p: number = 1) =>
            `https://${domain}/sch/i.html?_nkw=${encodeURIComponent(keyword)}&_pgn=${p}`;

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
            let urlTried = makeUrl(primary, 1);

            console.log('[SCRAPER] start', { keyword, urlTried });

            // coba .com dulu, lalu fallback
            try {
                await gotoWithRetry(page, urlTried, 3);
            } catch {
                urlTried = makeUrl(fallback, 1);
                console.log('[SCRAPER] switching to fallback domain:', urlTried);
                await gotoWithRetry(page, urlTried, 3);
            }

            // consent jika ada
            try {
                await page.waitForTimeout(500);
                const accept = page.getByRole('button', { name: /accept/i }).first();
                if (await accept.count()) {
                    await accept.click({ timeout: 3000 }).catch(() => { });
                    console.log('[SCRAPER] consent clicked');
                }
            } catch { }

            // selectors
            const CARD_SEL = 'li.s-card, li.s-item';
            const TITLE_NEW =
                'div[role="heading"][aria-level="3"].s-card__title > .su-styled-text';
            const PRICE_SPANS = '.s-card__attribute-row .s-card__price';
            // ⬇️ tambahkan varian link, termasuk <a class="image-treatment">
            const LINK_SELS = ['a.s-item__link', 'a.image-treatment', 'a[role="link"]'];

            // ⬇️ PAGINATION LOOP
            const allItems: Array<{ title: string; price: string; link: string }> = [];
            const maxPages = 3; // atur sesuai kebutuhan / jadikan param
            const currentDomain = new URL(urlTried).hostname;

            for (let p = 1; p <= maxPages; p++) {
                const pageUrl = makeUrl(currentDomain, p);
                console.log(`[SCRAPER] page ${p} -> ${pageUrl}`);
                await gotoWithRetry(page, pageUrl, 3);

                // pastikan ada card
                const firstCard = page.locator(CARD_SEL).first();
                const hasCard = await firstCard.isVisible({ timeout: 10000 }).catch(() => false);
                if (!hasCard) {
                    console.log('[SCRAPER] no cards, stop pagination');
                    break;
                }

                // bantu lazy-load
                await page.waitForTimeout(400);
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(600);

                // hanya card yang punya title
                const cards = page.locator(CARD_SEL, { has: page.locator(TITLE_NEW) });
                const count = await cards.count();
                console.log(`[SCRAPER] page ${p} items: ${count}`);
                if (!count) break;

                // ekstraksi (inject selector via argumen kedua)
                const rawItems = await cards.evaluateAll(
                    (elements, arg) =>
                        elements
                            .map((el) => {
                                const title =
                                    el.querySelector(arg.TITLE_NEW)?.textContent?.trim() || '';
                                const price =
                                    el.querySelector(arg.PRICE_SPANS)?.textContent?.trim() || '';
                                if (!title || !price) return null;

                                // cari anchor berdasarkan prioritas selector
                                let href = '';
                                for (const sel of arg.LINK_SELS) {
                                    const a = el.querySelector(sel);
                                    if (a && a.getAttribute('href')) {
                                        href = a.getAttribute('href')!;
                                        break;
                                    }
                                }
                                return { title, price, href };
                            })
                            .filter(Boolean),
                    { TITLE_NEW, PRICE_SPANS, LINK_SELS }
                );
                // normalisasi URL relatif → absolut, gunakan URL halaman saat ini (pageUrl)
                const items = (rawItems as any[]).map((it) => ({
                    title: it.title,
                    price: it.price,
                    link: new URL(it.href, pageUrl).href,
                }));

                allItems.push(...items);

                // throttle antar halaman
                await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
            }

            console.log(`[SCRAPER] total items: ${allItems.length}`);

            // Coba ambil deskripsi untuk item pertama (atau loop semua)
            if (allItems.length > 0) {
                await logDescriptionHTML(context, allItems[30].link);
                console.log('[DEBUG] will open detail:', allItems[30].link);
            }
            return {
                ok: true,
                message: `Opened eBay OK for "${keyword}"`,
                url: urlTried,
                items: allItems,
            };
        } catch (error) {
            console.error('[SCRAPER] error', String(error));
            return { ok: false, error: String(error) };
        } finally {
            await browser.close();
        }
    }
}
