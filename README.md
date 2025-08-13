
# eBay AI Scraper API

A NestJS-based REST API for scraping eBay data and leveraging AI-powered features. This project is designed for learning and demonstration purposes.

## Features
- Scrape eBay listings based on search queries
- AI-powered data processing (extendable)
- Modular, testable codebase using NestJS

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation
1. Clone the repository:
   ```sh
   git clone https://github.com/attoyibi/frontend-intern-basic-code.git
   cd frontend-intern-basic-code/ebay-ai-scraper
   ```
2. Install dependencies:
   ```sh
   npm install
   ```

### Running the Project
To start the development server:
```sh
npm run start:dev
```
The API will be available at `http://localhost:3000` by default.
For hit API end point at `http://localhost:3000/api/scraper/ebay?keyword=nike`
 
### Building for Production
```sh
npm run build
npm run start:prod
```

### Testing
- **Unit tests:**
  ```sh
  npm run test
  ```
- **End-to-end tests:**
  ```sh
  npm run test:e2e
  ```

## API Documentation

### Endpoints

#### Scrape eBay Listings
- **POST** `/scrape`
  - **Body:**
    ```json
    {
      "query": "string"
    }
    ```
  - **Response:**
    ```json
    [
      {
        "title": "string",
        "price": "string",
        "url": "string",
        ...
      }
    ]
    ```

#### AI Features
- **POST** `/ai/process`
  - **Body:**
    ```json
    {
      "data": "string"
    }
    ```
  - **Response:**
    ```json
    {
      "result": "string"
    }
    ```

> **Note:** See the source code in `src/scrape/` and `src/ai/` for more details on request/response formats and available features.

## Project Structure
```
src/
  app.controller.ts      # Main app controller
  app.module.ts          # Root module
  app.service.ts         # App-level services
  main.ts                # Entry point
  scrape/                # eBay scraping logic
    scrape.controller.ts
    scrape.service.ts
    dto/
  ai/                    # AI-related features
    ai.service.ts
    ai.module.ts
  common/                # Shared types and utilities
```

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](LICENSE)
