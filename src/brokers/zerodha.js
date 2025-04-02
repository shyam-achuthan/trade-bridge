// src/providers/brokers/zerodhaClient.js
const KiteConnect = require("kiteconnect").KiteConnect;
const axios = require("axios");
const fs = require("fs");
const path = require("path");

/**
 * ZerodhaClient - API client for Zerodha (Kite) broker
 */
class ZerodhaClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.instrumentsCache = null;

    // Initialize KiteConnect
    this.kiteConnect = new KiteConnect({
      api_key: credentials.apiKey,
    });

    if (credentials.accessToken) {
      this.kiteConnect.setAccessToken(credentials.accessToken);
    }

    // Initialize client
    this._initialize();
  }

  /**
   * Initialize the client
   * @private
   */
  async _initialize() {
    try {
      // If we don't have an access token, try to get it using the request token
      if (!this.credentials.accessToken && this.credentials.requestToken) {
        await this._generateSession();
      }

      // Load instruments cache
      await this._loadInstrumentsCache();
    } catch (error) {
      console.error("Failed to initialize Zerodha client:", error.message);
    }
  }

  /**
   * Generate session and obtain access token
   * @private
   */
  async _generateSession() {
    try {
      const response = await this.kiteConnect.generateSession(
        this.credentials.requestToken,
        this.credentials.apiSecret
      );

      this.credentials.accessToken = response.access_token;
      this.kiteConnect.setAccessToken(response.access_token);

      // Optionally save the token for future use
      console.log("Zerodha access token generated successfully");
    } catch (error) {
      console.error("Failed to generate Zerodha session:", error.message);
      throw error;
    }
  }

  /**
   * Load instruments cache
   * @private
   */
  async _loadInstrumentsCache() {
    try {
      const cacheDir = path.join(__dirname, "..", "..", "cache");
      const filePath = path.join(cacheDir, "zerodha_instruments.json");

      // Check if cache exists and is recent (less than 24 hours old)
      let shouldDownload = true;
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const cacheAge = Date.now() - stats.mtime.getTime();
        shouldDownload = cacheAge > 24 * 60 * 60 * 1000; // 24 hours
      }

      // Download fresh data if needed
      if (shouldDownload) {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }

        const instruments = await this.kiteConnect.getInstruments();
        fs.writeFileSync(filePath, JSON.stringify(instruments, null, 2));
        this.instrumentsCache = instruments;
      } else {
        // Load from cache
        const cachedData = fs.readFileSync(filePath, "utf8");
        this.instrumentsCache = JSON.parse(cachedData);
      }

      console.log(
        `Loaded ${this.instrumentsCache.length} instruments from Zerodha cache`
      );
    } catch (error) {
      console.error("Failed to load Zerodha instruments cache:", error.message);
    }
  }

  /**
   * Get instrument details by security ID
   * @param {string} securityId - Security ID, trading symbol, or instrument token
   * @returns {Object|null} Instrument details or null if not found
   */
  getInstrumentDetails(securityId) {
    if (!this.instrumentsCache) {
      throw new Error("Instruments cache not loaded");
    }

    return this.instrumentsCache.find((instrument) => {
      if (typeof securityId === "string") {
        return instrument.tradingsymbol === securityId;
      } else if (typeof securityId === "number") {
        return instrument.instrument_token === securityId;
      }
      return false;
    });
  }

  /**
   * Map product type to Zerodha format
   * @private
   * @param {string} product - Product type
   * @returns {string} Mapped product type
   */
  _mapProduct(product) {
    const productMap = {
      INTRADAY: "MIS",
      DELIVERY: "CNC",
      NORMAL: "NRML",
      MIS: "MIS",
      CNC: "CNC",
      NRML: "NRML",
    };

    return productMap[product] || "MIS";
  }

  /**
   * Map order type to Zerodha format
   * @private
   * @param {string} orderType - Order type
   * @returns {string} Mapped order type
   */
  _mapOrderType(orderType) {
    const orderTypeMap = {
      MARKET: "MARKET",
      LIMIT: "LIMIT",
      SL: "SL",
      "SL-M": "SL-M",
    };

    return orderTypeMap[orderType] || "MARKET";
  }

  /**
   * Place an order
   * @param {Object} params - Order parameters
   * @param {string} params.symbolName - Trading symbol
   * @param {string} params.exchange - Exchange (NSE, BSE, etc.)
   * @param {string} params.transactionType - BUY or SELL
   * @param {string} params.orderType - MARKET, LIMIT, SL, SL-M
   * @param {number} params.quantity - Order quantity
   * @param {number} [params.price] - Order price (for LIMIT orders)
   * @param {number} [params.triggerPrice] - Trigger price (for SL, SL-M orders)
   * @param {string} [params.validity] - DAY, IOC
   * @param {string} [params.variety] - regular, amo, co, iceberg
   * @param {string} [params.product] - CNC, MIS, NRML
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(params) {
    try {
      // Get instrument details if needed
      let exchange = params.exchange;
      let tradingSymbol = params.symbolName;

      if (!exchange || !tradingSymbol) {
        const instrument = this.getInstrumentDetails(params.symbolName);
        if (!instrument) {
          throw new Error(`Instrument not found: ${params.symbolName}`);
        }
        exchange = instrument.exchange;
        tradingSymbol = instrument.tradingsymbol;
      }

      // Map parameters to Zerodha format
      const orderRequest = {
        exchange: exchange,
        tradingsymbol: tradingSymbol,
        transaction_type: params.transactionType,
        quantity: params.quantity,
        product: this._mapProduct(params.product || "INTRADAY"),
        order_type: this._mapOrderType(params.orderType),
        validity: params.validity?.toLowerCase() || "day",
        variety: params.variety?.toLowerCase() || "regular",
      };

      // Add price for LIMIT orders
      if (["LIMIT", "SL"].includes(params.orderType) && params.price) {
        orderRequest.price = params.price;
      }

      // Add trigger price for SL, SL-M orders
      if (["SL", "SL-M"].includes(params.orderType) && params.triggerPrice) {
        orderRequest.trigger_price = params.triggerPrice;
      }

      // Place the order
      const response = await this.kiteConnect.placeOrder(
        orderRequest.variety,
        orderRequest
      );

      return {
        orderId: response.order_id,
        status: "success",
        message: "Order placed successfully",
      };
    } catch (error) {
      console.error("Failed to place order:", error.message);
      throw error;
    }
  }

  /**
   * Cancel an order
   * @param {string} orderId - ID of the order to cancel
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelOrder(orderId) {
    try {
      const response = await this.kiteConnect.cancelOrder("regular", orderId);

      return {
        orderId: response.order_id,
        status: "success",
        message: "Order cancelled successfully",
      };
    } catch (error) {
      console.error(`Failed to cancel order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Cancel all orders
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelAllOrders() {
    try {
      // Get all open orders
      const orders = await this.listOrders();
      const openOrders = orders.filter((order) =>
        ["open", "pending", "trigger pending"].includes(
          order.status.toLowerCase()
        )
      );

      // Cancel each open order
      const results = await Promise.all(
        openOrders.map((order) => this.cancelOrder(order.order_id))
      );

      return {
        success: true,
        message: `Cancelled ${results.length} orders`,
        details: results,
      };
    } catch (error) {
      console.error("Failed to cancel all orders:", error.message);
      throw error;
    }
  }

  /**
   * List all orders
   * @returns {Promise<Array>} List of orders
   */
  async listOrders() {
    try {
      return await this.kiteConnect.getOrders();
    } catch (error) {
      console.error("Failed to list orders:", error.message);
      throw error;
    }
  }

  /**
   * List all positions
   * @returns {Promise<Array>} List of positions
   */
  async listPositions() {
    try {
      const positions = await this.kiteConnect.getPositions();
      return positions.net; // Return net positions
    } catch (error) {
      console.error("Failed to list positions:", error.message);
      throw error;
    }
  }

  /**
   * List all holdings
   * @returns {Promise<Array>} List of holdings
   */
  async listHoldings() {
    try {
      return await this.kiteConnect.getHoldings();
    } catch (error) {
      console.error("Failed to list holdings:", error.message);
      throw error;
    }
  }

  /**
   * Exit all positions
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositions() {
    try {
      // Get all positions
      const positions = await this.listPositions();

      // Exit each position with a market order
      const results = await Promise.all(
        positions
          .map((position) => {
            if (position.quantity === 0) return null; // Skip positions with zero quantity

            // Create opposite transaction type
            const transactionType = position.quantity > 0 ? "SELL" : "BUY";
            const quantity = Math.abs(position.quantity);

            return this.placeOrder({
              symbolName: position.tradingsymbol,
              exchange: position.exchange,
              transactionType,
              orderType: "MARKET",
              quantity,
              product: position.product,
            });
          })
          .filter(Boolean) // Remove null results
      );

      return {
        success: true,
        message: `Exited ${results.length} positions`,
        details: results,
      };
    } catch (error) {
      console.error("Failed to exit all positions:", error.message);
      throw error;
    }
  }

  /**
   * Exit all positions with limit orders
   * @param {Object} params - Parameters for limit orders
   * @param {number} [params.priceOffset=0] - Price offset from LTP in percentage
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositionsLimit(params = {}) {
    try {
      // Get all positions
      const positions = await this.listPositions();

      // Exit each position with a limit order
      const results = await Promise.all(
        positions
          .map(async (position) => {
            if (position.quantity === 0) return null; // Skip positions with zero quantity

            // Create opposite transaction type
            const transactionType = position.quantity > 0 ? "SELL" : "BUY";
            const quantity = Math.abs(position.quantity);

            // Get current market price
            const ltp = await this._getLTP(
              position.exchange,
              position.tradingsymbol
            );

            // Calculate limit price with offset
            const priceOffset = params.priceOffset || 0;
            let limitPrice;

            if (transactionType === "SELL") {
              // For sell orders, set limit price slightly lower than market price
              limitPrice = ltp * (1 - priceOffset / 100);
            } else {
              // For buy orders, set limit price slightly higher than market price
              limitPrice = ltp * (1 + priceOffset / 100);
            }

            // Round price to 2 decimal places
            limitPrice = Math.round(limitPrice * 100) / 100;

            return this.placeOrder({
              symbolName: position.tradingsymbol,
              exchange: position.exchange,
              transactionType,
              orderType: "LIMIT",
              quantity,
              price: limitPrice,
              product: position.product,
            });
          })
          .filter(Boolean) // Remove null results
      );

      return {
        success: true,
        message: `Exited ${results.length} positions with limit orders`,
        details: results,
      };
    } catch (error) {
      console.error(
        "Failed to exit all positions with limit orders:",
        error.message
      );
      throw error;
    }
  }

  /**
   * Exit all positions and add stop loss orders
   * @param {Object} params - Parameters for stop loss orders
   * @param {number} [params.slPercentage=1] - Stop loss percentage from LTP
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositionsAddStopLoss(params = {}) {
    try {
      // Get all positions
      const positions = await this.listPositions();

      // Exit each position with a stop loss order
      const results = await Promise.all(
        positions
          .map(async (position) => {
            if (position.quantity === 0) return null; // Skip positions with zero quantity

            // Create opposite transaction type
            const transactionType = position.quantity > 0 ? "SELL" : "BUY";
            const quantity = Math.abs(position.quantity);

            // Get current market price
            const ltp = await this._getLTP(
              position.exchange,
              position.tradingsymbol
            );

            // Calculate stop loss price
            const slPercentage = params.slPercentage || 1;
            let triggerPrice;

            if (transactionType === "SELL") {
              // For sell orders, set stop loss below the current price
              triggerPrice = ltp * (1 - slPercentage / 100);
            } else {
              // For buy orders, set stop loss above the current price
              triggerPrice = ltp * (1 + slPercentage / 100);
            }

            // Round price to 2 decimal places
            triggerPrice = Math.round(triggerPrice * 100) / 100;

            return this.placeOrder({
              symbolName: position.tradingsymbol,
              exchange: position.exchange,
              transactionType,
              orderType: "SL-M", // Stop Loss-Market
              quantity,
              triggerPrice,
              product: position.product,
            });
          })
          .filter(Boolean) // Remove null results
      );

      return {
        success: true,
        message: `Added stop loss orders for ${results.length} positions`,
        details: results,
      };
    } catch (error) {
      console.error(
        "Failed to add stop loss orders for positions:",
        error.message
      );
      throw error;
    }
  }

  /**
   * Get Last Traded Price (LTP) for an instrument
   * @private
   * @param {string} exchange - Exchange (NSE, BSE, etc.)
   * @param {string} tradingSymbol - Trading symbol
   * @returns {Promise<number>} Last traded price
   */
  async _getLTP(exchange, tradingSymbol) {
    try {
      const instrument = `${exchange}:${tradingSymbol}`;
      const response = await this.kiteConnect.getLTP([instrument]);
      return response[instrument].last_price;
    } catch (error) {
      console.error(
        `Failed to get LTP for ${exchange}:${tradingSymbol}:`,
        error.message
      );
      throw error;
    }
  }
}

module.exports = ZerodhaClient;
