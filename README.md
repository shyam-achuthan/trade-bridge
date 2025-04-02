# OrderProvider - Multi-Broker Trading API for Node.js

OrderProvider is a unified interface for managing trading orders across multiple brokers including Upstox, Zerodha, Dhan, and more. This library allows you to place orders, manage positions, and access market data through a single standardized API.

## Features

- **Unified API**: Interact with multiple brokers through a single consistent interface
- **Instrument Metadata**: Download and cache broker-specific instrument data
- **Order Management**: Place, modify and cancel orders
- **Position Management**: List and exit positions with various strategies
- **Holdings Management**: Retrieve and manage your portfolio holdings
- **Broker Agnostic**: Easily extend to support additional brokers

## Supported Brokers

- [Upstox](https://upstox.com/)
- [Zerodha](https://zerodha.com/)
- [Dhan](https://dhan.co/)
- More brokers can be added by implementing the broker client interface

## Installation

```bash
npm install @profitolio/order-provider
```

## Dependencies

This package has the following dependencies:

- axios
- kiteconnect (for Zerodha integration)
- dotenv (for environment configuration)

## Quick Start

1. **Setup Environment Variables**

   Create a `.env` file in your project root:

   ```env
   # Common settings
   CACHE_DIR=./cache
   CACHE_EXPIRY_HOURS=24

   # Upstox configuration
   UPSTOX_ENABLED=true
   UPSTOX_API_KEY=your_upstox_api_key
   UPSTOX_SECRET_KEY=your_upstox_secret_key
   UPSTOX_REDIRECT_URI=https://your-app.com/redirect
   UPSTOX_AUTH_CODE=auth_code_from_redirect

   # Zerodha configuration
   ZERODHA_ENABLED=true
   ZERODHA_API_KEY=your_zerodha_api_key
   ZERODHA_API_SECRET=your_zerodha_api_secret
   ZERODHA_REQUEST_TOKEN=request_token_from_redirect
   ZERODHA_ACCESS_TOKEN=your_zerodha_access_token

   # Dhan configuration
   DHAN_ENABLED=true
   DHAN_CLIENT_ID=your_dhan_client_id
   DHAN_ACCESS_TOKEN=your_dhan_access_token
   ```

2. **Initialize OrderProvider**

   ```javascript
   const config = require("./config/environment");
   const OrderProvider = require("@profitolio/order-provider");

   const orderProvider = new OrderProvider(config);
   ```

3. **Place an Order**

   ```javascript
   async function placeOrder() {
     try {
       // Update instrument cache first
       await orderProvider.updateInstrumentCache("upstox");

       // Place a market order
       const response = await orderProvider.placeOrder("upstox", {
         symbolName: "RELIANCE-EQ",
         transactionType: "BUY",
         orderType: "MARKET",
         quantity: 1,
         product: "INTRADAY",
       });

       console.log("Order placed:", response);
     } catch (error) {
       console.error("Error placing order:", error.message);
     }
   }

   placeOrder();
   ```

## API Reference

### OrderProvider Class

The main class for interacting with brokers.

#### Constructor

```javascript
const orderProvider = new OrderProvider(config);
```

- `config`: Configuration object with broker details and credentials

#### Methods

- **`registerBroker(brokerName, credentials)`**: Register a new broker client
- **`updateInstrumentCache(brokerName)`**: Download and cache instrument data
- **`findInstrumentBySecurityId(brokerName, securityId)`**: Look up instrument details

#### Order Management

- **`placeOrder(brokerName, orderParams)`**: Place an order
- **`cancelAllOrders(brokerName)`**: Cancel all open orders
- **`cancelSingleOrder(brokerName, orderId)`**: Cancel a specific order

#### Position Management

- **`listAllPositions(brokerName)`**: List all positions
- **`exitAllPositions(brokerName)`**: Exit all positions with market orders
- **`exitAllPositionsLimit(brokerName, limitParams)`**: Exit positions with limit orders
- **`exitAllPositionsAddStopLoss(brokerName, slParams)`**: Exit positions with stop loss

#### Holdings Management

- **`listAllHoldings(brokerName)`**: List all holdings

### Order Parameters

```javascript
{
  symbolName: 'RELIANCE-EQ',     // Trading symbol
  exchange: 'NSE',               // Exchange (optional if symbolName can be resolved)
  transactionType: 'BUY',        // BUY or SELL
  orderType: 'MARKET',           // MARKET, LIMIT, SL, SL-M
  quantity: 1,                   // Order quantity
  price: 2000,                   // Limit price (for LIMIT orders)
  triggerPrice: 1950,            // Trigger price (for SL, SL-M orders)
  validity: 'DAY',               // DAY, IOC
  variety: 'NORMAL',             // NORMAL, AMO, CO, OCO
  product: 'INTRADAY'            // INTRADAY, DELIVERY, MARGIN
}
```

## Advanced Usage Examples

### Placing a Limit Order with Stop Loss

```javascript
async function placeLimitOrderWithSL() {
  try {
    // Get instrument details
    await orderProvider.updateInstrumentCache("zerodha");
    const instrument = orderProvider.findInstrumentBySecurityId(
      "zerodha",
      "INFY-EQ"
    );

    if (!instrument) {
      console.error("Instrument not found");
      return;
    }

    // Place limit order
    const limitResponse = await orderProvider.placeOrder("zerodha", {
      symbolName: "INFY-EQ",
      exchange: instrument.exchange,
      transactionType: "BUY",
      orderType: "LIMIT",
      quantity: 1,
      price: 1500.0,
      product: "INTRADAY",
    });

    // Place stop loss order
    const slResponse = await orderProvider.placeOrder("zerodha", {
      symbolName: "INFY-EQ",
      exchange: instrument.exchange,
      transactionType: "SELL",
      orderType: "SL-M",
      quantity: 1,
      triggerPrice: 1470.0,
      product: "INTRADAY",
    });

    console.log("Limit order:", limitResponse);
    console.log("Stop loss order:", slResponse);
  } catch (error) {
    console.error("Error:", error.message);
  }
}
```

### Managing Positions Across Multiple Brokers

```javascript
async function manageAllPositions() {
  try {
    // Get positions from all brokers
    const upstoxPositions = await orderProvider.listAllPositions("upstox");
    const zerodhaPositions = await orderProvider.listAllPositions("zerodha");
    const dhanPositions = await orderProvider.listAllPositions("dhan");

    console.log(
      "Total positions:",
      upstoxPositions.length + zerodhaPositions.length + dhanPositions.length
    );

    // Exit all positions if market is volatile
    if (isMarketVolatile()) {
      await orderProvider.exitAllPositions("upstox");
      await orderProvider.exitAllPositions("zerodha");
      await orderProvider.exitAllPositions("dhan");
      console.log("Exited all positions across brokers");
    }
  } catch (error) {
    console.error("Error managing positions:", error.message);
  }
}
```

## Extending for New Brokers

To add support for a new broker, create a new client class in `src/providers/brokers/` that implements the required methods:

```javascript
// src/providers/brokers/newBrokerClient.js
class NewBrokerClient {
  constructor(credentials) {
    this.credentials = credentials;
    // Initialize broker-specific client
  }

  // Implement required methods:
  // - placeOrder
  // - cancelOrder
  // - cancelAllOrders
  // - listOrders
  // - listPositions
  // - listHoldings
  // - exitAllPositions
  // - exitAllPositionsLimit
  // - exitAllPositionsAddStopLoss
  // - getInstrumentDetails
}

module.exports = NewBrokerClient;
```

Then register your new broker in the environment configuration:

```javascript
// Add to config/environment.js
{
  name: 'newBroker',
  enabled: process.env.NEW_BROKER_ENABLED === 'true',
  credentials: {
    // Broker-specific credentials
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This software is for educational purposes only. Use at your own risk. Trading in financial markets involves substantial risk of loss. The authors are not responsible for any financial losses incurred while using this software.
