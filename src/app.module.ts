import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapeModule } from './scrape/scrape.module';

@Module({
  imports: [ScrapeModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
