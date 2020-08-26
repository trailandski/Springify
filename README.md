# Springify
Realtime product synchronization between Springboard Retail and Shopify.


## Features
- Instant updates via Springboard Retail webhooks.
- Daily synchronization
    - Also, Springboard does not fire webhooks for image changes. The daily sync is responsible
    for keeping product images up to date.
- Monthly re-synchronization. All item data is invalidated and refreshed every 30 days.

## Important
Do not ever change an Item's #. Changing an Item # will break synchronization of that item.
If you change an Item # you should also delete the corresponding Shopify variant.

## Scripts

`npm run build`

`npm run test`

`npm run deploy staging`

`npm run deploy prod`

## OOSP Policy (Online Out-of-Stock Purchase Policy)
If set to Allow, the website will show this item as in-stock, despite having no in-stock inventory.
If no value is specified, Springify will default to "Deny". In other words, leaving the field blank will
cause the item to disappear once we run out of stock.

## Shipping
### Specialty Shipping Codes
- A shipping level of -2 will mark the item with "In-Store Pickup Only".
- A shipping level of 0 will mark the item with "Free Shipping".
- A shipping level of -1 will prevent the item from being published to Shopify entirely.
### Configuring Shipping Levels
Shipping levels can be configured at two different stages.
1. *configs/product-types.csv*: Applies shipping levels to products based on sub class.
2. *Shipping Level Custom Field*: Applies shipping levels to specific items. A shipping level given at this level will override *configs/product-types.csv*.
### What if a shipping level is not specified in the config file or at the item level?
In that case, the item will still be published to Shopify. The item will be assigned a default shipping level of 1.

## Pricing
To prevent MAP breakage, Springify requires that all item's have a set MAP threshold. You can set the
MAP threshold for an item by changing the custom field. If you leave the MAP threshold blank, Springify
will consider Original Price/MSRP the Minimum Advisable Price.
### Web Price (Highest Priority)
- If Web Price is set, all other prices are ignored. 
- A Web Price that breaks MAP will result in an error and the item will not be published to Shopify.
### Current Price
Current Price will only be used if it is above MAP or MAP is not enforced for this item.
### Original Price
In cases where Current Price breaks MAP, the MAP Threshold will be used.
