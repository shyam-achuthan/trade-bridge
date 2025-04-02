// src/providers/brokers/dhanClient.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");

/**
 * DhanClient - API client for Dhan broker
 */
class DhanClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.baseUrl = "https://api.dhan.co";
    this.instrumentsCache = null;

    // Initialize axios instance with auth headers
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
        "client-id": credentials.clientId,
      },
    });

    // Initialize client
    this._initialize();
  }

  /**
   * Initialize the client
   * @private
   */
  async _initialize() {
    try {
      // Load instruments cache
      await this._loadInstrumentsCache();
    } catch (error) {
      console.error("Failed to initialize Dhan client:", error.message);
    }
  }

  /**
   * Load instruments cache
   * @private
   */
  async _loadInstrumentsCache() {
    try {
      const cacheDir = path.join(__dirname, "..", "..", "cache");
      const filePath = path.join(cacheDir, "dhan_instruments.json");

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

        try {
          // Get NSE Equity instruments
          const nseEquity = await this.axiosInstance.get(
            "/instruments/nse-equity"
          );
          // Get BSE Equity instruments
          const bseEquity = await this.axiosInstance.get(
            "/instruments/bse-equity"
          );
          // Get NFO (Futures & Options) instruments
          const nfo = await this.axiosInstance.get("/instruments/nfo");
          // Get Currency instruments
          const cds = await this.axiosInstance.get("/instruments/cds");
          // Get MCX Commodity instruments
          const mcx = await this.axiosInstance.get("/instruments/mcx");

          // Combine all instruments
          const allInstruments = [
            ...nseEquity.data,
            ...bseEquity.data,
            ...nfo.data,
            ...cds.data,
            ...mcx.data,
          ];

          fs.writeFileSync(filePath, JSON.stringify(allInstruments, null, 2));
          this.instrumentsCache = allInstruments;
        } catch (error) {
          console.error("Failed to download Dhan instruments:", error.message);

          // Try to load from cache if download fails
          if (fs.existsSync(filePath)) {
            const cachedData = fs.readFileSync(filePath, "utf8");
            this.instrumentsCache = JSON.parse(cachedData);
          }
        }
      } else {
        // Load from cache
        const cachedData = fs.readFileSync(filePath, "utf8");
        this.instrumentsCache = JSON.parse(cachedData);
      }

      if (this.instrumentsCache) {
        console.log(
          `Loaded ${this.instrumentsCache.length} instruments from Dhan cache`
        );
      }
    } catch (error) {
      console.error("Failed to load Dhan instruments cache:", error.message);
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
        return (
          instrument.tradingSymbol === securityId ||
          instrument.tradingSymbol.toUpperCase() === securityId.toUpperCase() ||
          instrument.securityId === securityId
        );
      } else if (typeof securityId === "number") {
        return instrument.exchangeToken === securityId;
      }
      return false;
    });
  }

  /**
   * Map product type to Dhan format
   * @private
   * @param {string} product - Product type
   * @returns {string} Mapped product type
   */
  _mapProduct(product) {
    const productMap = {
      INTRADAY: "INTRADAY",
      DELIVERY: "DELIVERY",
      MARGIN: "MARGIN",
      NORMAL: "NORMAL",
      MIS: "INTRADAY",
      CNC: "DELIVERY",
      NRML: "NORMAL",
    };

    return productMap[product] || "INTRADAY";
  }

  /**
   * Map order type to Dhan format
   * @private
   * @param {string} orderType - Order type
   * @returns {string} Mapped order type
   */
  _mapOrderType(orderType) {
    const orderTypeMap = {
      MARKET: "MARKET",
      LIMIT: "LIMIT",
      SL: "SL",
      "SL-M": "SLM",
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
   * @param {string} [params.product] - DELIVERY, INTRADAY, MARGIN, NORMAL
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(params) {
    try {
      // Get instrument details if needed
      let securityId = params.securityId;
      let exchange = params.exchange;
      let symbol = params.symbolName;

      if (!securityId) {
        const instrument = this.getInstrumentDetails(params.symbolName);
        if (!instrument) {
          throw new Error(`Instrument not found: ${params.symbolName}`);
        }
        securityId = instrument.securityId;
        exchange = instrument.exchange;
        symbol = instrument.tradingSymbol;
      }

      // Map parameters to Dhan format
      const orderRequest = {
        securityId: securityId,
        exchange: exchange,
        quantity: params.quantity,
        product: this._mapProduct(params.product || "INTRADAY"),
        validity: params.validity?.toUpperCase() || "DAY",
        orderType: this._mapOrderType(params.orderType),
        transactionType: params.transactionType,
        disclosedQuantity: 0,
        source: "API",
      };

      // Add price for LIMIT and SL orders
      if (["LIMIT", "SL"].includes(params.orderType) && params.price) {
        orderRequest.price = params.price;
      }

      // Add trigger price for SL, SL-M orders
      if (
        ["SL", "SLM"].includes(orderRequest.orderType) &&
        params.triggerPrice
      ) {
        orderRequest.triggerPrice = params.triggerPrice;
      }

      // Place the order
      const response = await this.axiosInstance.post("/orders", orderRequest);

      return {
        orderId: response.data.orderId,
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
      const response = await this.axiosInstance.delete(`/orders/${orderId}`);

      return {
        orderId: orderId,
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
        openOrders.map((order) => this.cancelOrder(order.orderId))
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
      return response.data || [];
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
      return response.data || [];
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
      const response = await this.axiosInstance.get("/holdings");
      return response.data || [];
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
              securityId: position.securityId,
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
              position.securityId
            );

            // Calculate limit price with offset
            const priceOffset = params.priceOffset || 0;
            let limitPrice;

            if (transactionType === "SELL") {
              // For sell orders, set limit price slightly higher than market price (to ensure execution)
              limitPrice = ltp * (1 + priceOffset / 100);
            } else {
              // For buy orders, set limit price slightly lower than market price (to ensure execution)
              limitPrice = ltp * (1 - priceOffset / 100);
            }

            // Round price to 2 decimal places
            limitPrice = Math.round(limitPrice * 100) / 100;

            return this.placeOrder({
              securityId: position.securityId,
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
              position.securityId
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
              securityId: position.securityId,
              exchange: position.exchange,
              transactionType,
              orderType: "SLM", // Stop Loss-Market
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
   * @param {string} securityId - Security ID
   * @returns {Promise<number>} Last traded price
   */
  async _getLTP(exchange, securityId) {
    try {
      const response = await this.axiosInstance.get(
        `/quotes/${exchange}/${securityId}`
      );
      return response.data.lastTradedPrice;
    } catch (error) {
      console.error(
        `Failed to get LTP for ${exchange}:${securityId}:`,
        error.message
      );
      throw error;
    }
  }
}

module.exports = DhanClient;
