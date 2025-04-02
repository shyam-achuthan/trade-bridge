/**
 * BrokerAdapter Interface
 * All broker implementations should implement these methods
 */
class BrokerAdapter {
  constructor(config) {
    if (this.constructor === BrokerAdapter) {
      throw new Error(
        "BrokerAdapter is an abstract class and cannot be instantiated directly"
      );
    }

    this.config = config;
  }

  // Authentication
  async login() {
    throw new Error("Method 'login' must be implemented");
  }

  async logout() {
    throw new Error("Method 'logout' must be implemented");
  }

  // Order operations
  async placeOrder(params) {
    throw new Error("Method 'placeOrder' must be implemented");
  }

  async modifyOrder(orderId, params) {
    throw new Error("Method 'modifyOrder' must be implemented");
  }

  async cancelOrder(orderId) {
    throw new Error("Method 'cancelOrder' must be implemented");
  }

  async cancelAllOrders(params) {
    throw new Error("Method 'cancelAllOrders' must be implemented");
  }

  // Position and holding operations
  async getPositions(params) {
    throw new Error("Method 'getPositions' must be implemented");
  }

  async getHoldings(params) {
    throw new Error("Method 'getHoldings' must be implemented");
  }

  // Market data
  async getQuote(symbolToken) {
    throw new Error("Method 'getQuote' must be implemented");
  }

  // Order book
  async getOrderBook(params) {
    throw new Error("Method 'getOrderBook' must be implemented");
  }

  // Trade book
  async getTradeBook(params) {
    throw new Error("Method 'getTradeBook' must be implemented");
  }
}

module.exports = BrokerAdapter;
