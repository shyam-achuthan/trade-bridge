// src/providers/OrderProvider.js
const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/**
 * OrderProvider - A central provider to manage orders across different brokers
 */
class OrderProvider {
  constructor(config) {
    this.config = config;
    this.brokerClients = {};
    this.instrumentCache = {};

    // Initialize broker clients based on config
    if (config.brokers) {
      config.brokers.forEach((broker) => {
        this.registerBroker(broker.name, broker.credentials);
      });
    }
  }

  /**
   * Register a broker client with the provider
   * @param {string} brokerName - Name of the broker (upstox, zerodha, etc.)
   * @param {Object} credentials - API credentials for the broker
   */
  registerBroker(brokerName, credentials) {
    // Import the broker-specific implementation
    try {
      const BrokerClient = require(`./brokers/${brokerName}Client`);
      this.brokerClients[brokerName] = new BrokerClient(credentials);
    } catch (error) {
      console.error(`Failed to register broker ${brokerName}:`, error.message);
    }
  }

  /**
   * Get broker client instance
   * @param {string} brokerName - Name of the broker
   * @returns {Object} Broker client instance
   */
  getBrokerClient(brokerName) {
    if (!this.brokerClients[brokerName]) {
      throw new Error(`Broker ${brokerName} is not registered`);
    }
    return this.brokerClients[brokerName];
  }

  /**
   * Place an order
   * @param {string} brokerName - Name of the broker
   * @param {Object} orderParams - Order parameters
   * @returns {Promise<Object>} Order response
   */
  async placeOrder(brokerName, orderParams) {
    const client = this.getBrokerClient(brokerName);
    return client.placeOrder(orderParams);
  }

  /**
   * Cancel all orders for a broker
   * @param {string} brokerName - Name of the broker
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelAllOrders(brokerName) {
    const client = this.getBrokerClient(brokerName);
    return client.cancelAllOrders();
  }

  /**
   * Cancel a specific order
   * @param {string} brokerName - Name of the broker
   * @param {string} orderId - ID of the order to cancel
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelSingleOrder(brokerName, orderId) {
    const client = this.getBrokerClient(brokerName);
    return client.cancelOrder(orderId);
  }

  /**
   * Exit all positions for a broker
   * @param {string} brokerName - Name of the broker
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositions(brokerName) {
    const client = this.getBrokerClient(brokerName);
    return client.exitAllPositions();
  }

  /**
   * Exit all positions with limit orders
   * @param {string} brokerName - Name of the broker
   * @param {Object} limitParams - Parameters for limit orders
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositionsLimit(brokerName, limitParams) {
    const client = this.getBrokerClient(brokerName);
    return client.exitAllPositionsLimit(limitParams);
  }

  /**
   * Exit all positions and add stop loss orders
   * @param {string} brokerName - Name of the broker
   * @param {Object} slParams - Parameters for stop loss orders
   * @returns {Promise<Object>} Exit positions response
   */
  async exitAllPositionsAddStopLoss(brokerName, slParams) {
    const client = this.getBrokerClient(brokerName);
    return client.exitAllPositionsAddStopLoss(slParams);
  }

  /**
   * List all positions for a broker
   * @param {string} brokerName - Name of the broker
   * @returns {Promise<Array>} List of positions
   */
  async listAllPositions(brokerName) {
    const client = this.getBrokerClient(brokerName);
    return client.listPositions();
  }

  /**
   * List all holdings for a broker
   * @param {string} brokerName - Name of the broker
   * @returns {Promise<Array>} List of holdings
   */
  async listAllHoldings(brokerName) {
    const client = this.getBrokerClient(brokerName);
    return client.listHoldings();
  }

  /**
   * Get instrument details by symbol/token
   * @param {string} brokerName - Name of the broker
   * @param {string} securityId - Security ID or symbol
   * @returns {Promise<Object>} Instrument details
   */
  async getInstrumentDetails(brokerName, securityId) {
    const client = this.getBrokerClient(brokerName);
    return client.getInstrumentDetails(securityId);
  }

  /**
   * Download and update instrument cache for a broker
   * @param {string} brokerName - Name of the broker
   * @returns {Promise<boolean>} Success status
   */
  async updateInstrumentCache(brokerName) {
    try {
      if (brokerName === "upstox") {
        return await this._updateUpstoxInstrumentCache();
      }
      // Add other brokers as needed

      return false;
    } catch (error) {
      console.error(
        `Failed to update instrument cache for ${brokerName}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Download and update Upstox instrument cache
   * @private
   * @returns {Promise<boolean>} Success status
   */
  async _updateUpstoxInstrumentCache() {
    try {
      const cacheDir = path.join(__dirname, "..", "cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const filePath = path.join(cacheDir, "upstox_instruments.json.gz");
      const response = await axios({
        method: "get",
        url: "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
        responseType: "arraybuffer",
      });

      fs.writeFileSync(filePath, response.data);

      // Decompress and load the instruments data
      const compressedData = fs.readFileSync(filePath);
      const decompressedData = zlib.gunzipSync(compressedData);
      const instrumentsData = JSON.parse(decompressedData.toString());

      // Cache the data in memory
      this.instrumentCache.upstox = instrumentsData;

      return true;
    } catch (error) {
      console.error("Failed to update Upstox instrument cache:", error.message);
      return false;
    }
  }

  /**
   * Find instrument by security ID from cache
   * @param {string} brokerName - Name of the broker
   * @param {string} securityId - Security ID or symbol
   * @returns {Object|null} Instrument details or null if not found
   */
  findInstrumentBySecurityId(brokerName, securityId) {
    if (!this.instrumentCache[brokerName]) {
      return null;
    }

    if (brokerName === "upstox") {
      return this.instrumentCache.upstox.find(
        (instrument) =>
          instrument.tradingsymbol === securityId ||
          instrument.instrument_token === securityId ||
          instrument.instrument_key === securityId
      );
    }

    return null;
  }
}

module.exports = OrderProvider;
