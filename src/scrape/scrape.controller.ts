import { Controller, Get, Query } from '@nestjs/common';
import { ScrapeService } from './scrape.service';

@Controller('scraper')
export class ScrapeController {
    constructor(private readonly scrapeService: ScrapeService) { }

    @Get()
    root() {
        return { ok: true, message: 'scraper endpoint alive' };
    }

    @Get('ebay')
    ebay(@Query('keyword') keyword: string) {
        if (!keyword) {
            return { ok: false, message: 'Keyword is required' };
        }
        // Here you would typically call a service to perform the scraping
        return this.scrapeService.scrapeEbay(keyword);
    }
}