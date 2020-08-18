# Springify
Realtime product synchronization between Springboard Retail and Shopify.

## Features
- Instant updates via Springboard Retail webhooks.
- Daily synchronization
    - Why? In case Springboard's webhook service experiences downtime. 
    - Also, Springboard does not fire webhooks for image changes. The daily sync is responsible
    for keeping product images up to date.
- Weekly re-synchronization. All item data is invalided and refreshed every 7 days.

## Scripts

`npm run build`

`npm run test`

`npm run deploy staging`

`npm run deploy prod`
