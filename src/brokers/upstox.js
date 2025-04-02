// src/providers/brokers/upstoxClient.js
const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/**
 * UpstoxClient - API client for Upstox broker
 */
class UpstoxClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.baseUrl = "https://api.upstox.com/v2";
    this.token = null;
    this.instrumentsCache = null;

    // Initialize client
    this._initialize();
  }

  /**
   * Initialize the client
   * @private
   */
  async _initialize() {
    try {
      // Authenticate with Upstox API
      await this._authenticate();

      // Load instruments cache
      await this._loadInstrumentsCache();
    } catch (error) {
      console.error("Failed to initialize Upstox client:", error.message);
    }
  }

  /**
   * Authenticate with Upstox API
   * @private
   */
  async _authenticate() {
    try {
      const response = await axios.post(`${this.baseUrl}/login`, {
        api_key: this.credentials.apiKey,
        secret_key: this.credentials.secretKey,
        redirect_uri: this.credentials.redirectUri,
        code: this.credentials.code,
      });

      this.token = response.data.data.access_token;

      // Set up Authorization header for future requests
      this.axiosInstance = axios.create({
        baseURL: this.baseUrl,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      console.error("Authentication failed:", error.message);
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
      const filePath = path.join(cacheDir, "upstox_instruments.json.gz");

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

        const response = await axios({
          method: "get",
          url: "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
          responseType: "arraybuffer",
        });

        fs.writeFileSync(filePath, response.data);
      }

      // Load and decompress instruments data
      const compressedData = fs.readFileSync(filePath);
      const decompressedData = zlib.gunzipSync(compressedData);
      this.instrumentsCache = JSON.parse(decompressedData.toString());

      console.log(
        `Loaded ${this.instrumentsCache.length} instruments from Upstox cache`
      );
    } catch (error) {
      console.error("Failed to load instruments cache:", error.message);
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

    return this.instrumentsCache.find(
      (instrument) =>
        instrument.tradingsymbol === securityId ||
        instrument.instrument_token === securityId ||
        instrument.instrument_key === securityId
    );
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
   * @param {string} [params.variety] - NORMAL, AMO, CO, OCO
   * @param {string} [params.product] - DELIVERY, INTRADAY, etc.
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(params) {
    try {
      // Get instrument details
      const instrument = this.getInstrumentDetails(params.symbolName);
      if (!instrument) {
        throw new Error(`Instrument not found: ${params.symbolName}`);
      }

      // Prepare order request
      const orderRequest = {
        instrument_token: instrument.instrument_token,
        exchange: params.exchange || instrument.exchange,
        transaction_type: params.transactionType,
        order_type: params.orderType,
        quantity: params.quantity,
        product: params.product || "INTRADAY",
        validity: params.validity || "DAY",
      };

      // Add price for LIMIT orders
      if (params.orderType === "LIMIT" && params.price) {
        orderRequest.price = params.price;
      }

      // Add trigger price for SL, SL-M orders
      if (["SL", "SL-M"].includes(params.orderType) && params.triggerPrice) {
        orderRequest.trigger_price = params.triggerPrice;
      }

      // Place the order
      const response = await this.axiosInstance.post(
        "/order/place",
        orderRequest
      );
      return response.data;
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
      const response = await this.axiosInstance.delete(`/order/${orderId}`);
      return response.data;
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
        ["open", "pending", "validation_pending"].includes(
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
      const response = await this.axiosInstance.get("/orders");
      return response.data.data || [];
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
      const response = await this.axiosInstance.get("/positions");
      return response.data.data || [];
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
      const response = await this.axiosInstance.get("/portfolio/holdings");
      return response.data.data || [];
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
            const ltp = await this._getLTP(position.instrument_token);

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
            const ltp = await this._getLTP(position.instrument_token);

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
   * @param {string} instrumentToken - Instrument token
   * @returns {Promise<number>} Last traded price
   */
  async _getLTP(instrumentToken) {
    try {
      const response = await this.axiosInstance.get(
        `/market-quote/ltp?instrument_key=${instrumentToken}`
      );
      return response.data.data[instrumentToken].last_price;
    } catch (error) {
      console.error(
        `Failed to get LTP for instrument ${instrumentToken}:`,
        error.message
      );
      throw error;
    }
  }
}

module.exports = UpstoxClient;
