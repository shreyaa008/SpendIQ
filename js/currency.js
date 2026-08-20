/* =========================================================
   Basic currency conversion using Fetch API and JSON.
   ========================================================= */

const CURRENCY_LIST = ["INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD", "AED"];

const EXCHANGE_RATE_API_BASE = "https://open.er-api.com/v6/latest/";

const currencyForm = document.getElementById("currency-form");
const currencyAmountInput = document.getElementById("input-currency-amount");
const currencyFromSelect = document.getElementById("input-currency-from");
const currencyToSelect = document.getElementById("input-currency-to");
const currencyErrorEl = document.getElementById("currency-error");
const currencyResultEl = document.getElementById("currency-result");
const currencyConvertBtn = document.getElementById("currency-convert-btn");


/* =========================================================
   BASIC CURRENCY CONVERSION
   ========================================================= */

/**
 * Converts an amount from one currency to another using live rates.
 * @param {number} amount
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @returns {Promise<{convertedAmount: number, rate: number}>}
 */
async function convertCurrency(amount, fromCurrency, toCurrency) {

  const response = await fetch(
    `${EXCHANGE_RATE_API_BASE}${fromCurrency}`
  );

  const data = await response.json();

  const rate = data.rates[toCurrency];

  return {
    convertedAmount: amount * rate,
    rate: rate
  };
}