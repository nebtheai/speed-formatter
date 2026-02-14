# Speed Formatter

Lightning-fast code formatting SaaS platform. Format your code in milliseconds, not seconds.

## Features

- 🚀 **28,000x faster** than traditional formatters
- 💎 **Multiple languages**: JavaScript, TypeScript, Rust
- 🔐 **Enterprise-ready**: Authentication, API keys, rate limiting
- 📊 **Analytics**: Usage tracking and performance metrics
- 💳 **SaaS-ready**: Subscription billing foundation

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite
- **Authentication**: JWT + bcrypt
- **Security**: Helmet, CORS, rate limiting
- **Formatting**: Prettier + native parsers

## Quick Start

```bash
npm install
npm start
```

## API Usage

```bash
# Public endpoint
curl -X POST https://speedformatter.com/format \
  -H "Content-Type: application/json" \
  -d '{"code": "const x=1;", "language": "javascript"}'

# API key endpoint
curl -X POST https://speedformatter.com/api/v1/format \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"code": "const x=1;", "language": "javascript"}'
```

## License

MIT © Neb