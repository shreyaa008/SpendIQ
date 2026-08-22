/* =========================================================
   CURRENCY.JS  —  Member C: Currency Converter
   Demonstrates: Fetch API, Promises, async/await, JSON, try/catch.
   Uses the free open.er-api.com endpoint (no API key required).

   TABLE OF CONTENTS
     1. fetchWithRetry()   — do-while retry loop
     2. convertCurrency()  — async/await version
     3. checkApiStatus()   — .then()/.catch() chaining version
     4. UI wiring           — form handler, error/result display
     5. Init
   ========================================================= */

const CURRENCY_LIST = ["INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD", "AED"];
const EXCHANGE_RATE_API_BASE = "https://open.er-api.com/v6/latest/";
const MAX_FETCH_RETRIES = 2;
const FETCH_TIMEOUT_MS = 8000;

const currencyForm = document.getElementById("currency-form");
const currencyAmountInput = document.getElementById("input-currency-amount");
const currencyFromSelect = document.getElementById("input-currency-from");
const currencyToSelect = document.getElementById("input-currency-to");
const currencyErrorEl = document.getElementById("currency-error");
const currencyResultEl = document.getElementById("currency-result");
const currencyConvertBtn = document.getElementById("currency-convert-btn");
const apiStatusEl = document.getElementById("api-status");


/* =========================================================
   FETCH WITH RETRY  (Lecture 5-6: do-while)
   ========================================================= */

/**
 * Fetches a URL, retrying on failure using a do-while loop.
 * A do-while (rather than while) is the right fit here because we always
 * want at least ONE attempt before deciding whether to retry.
 * @param {string} url
 * @param {number} maxRetries
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, maxRetries = MAX_FETCH_RETRIES) {
  let attempt = 0;
  let lastError = null;

  // Lecture 5-6: do-while — body runs first, condition is checked after
  do {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return response;
      lastError = new Error(`Request failed with status ${response.status}`);
    } catch (error) {
      lastError = error.name === "AbortError"
        ? new Error("The request timed out. Please check your connection.")
        : error;
    } finally {
      clearTimeout(timeoutId);
    }
    attempt++;
  } while (attempt <= maxRetries);

  throw lastError;
}


/* =========================================================
   FETCH + ASYNC/AWAIT  (Lecture 25-28)
   ========================================================= */

/**
 * Converts an amount from one currency to another using live rates.
 * @param {number} amount
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @returns {Promise<{convertedAmount: number, rate: number}>}
 * @throws if the network request fails or the API returns an error
 */
async function convertCurrency(amount, fromCurrency, toCurrency) {
  const response = await fetchWithRetry(`${EXCHANGE_RATE_API_BASE}${fromCurrency}`);
  const data = await response.json();

  if (data.result !== "success") {
    throw new Error("Exchange rate service returned an error.");
  }

  const rate = data.rates[toCurrency];

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No rate available for ${toCurrency}.`);
  }

  return {
    convertedAmount: amount * rate,
    rate
  };
}


/* =========================================================
   PROMISE .then()/.catch() CHAINING
   ========================================================= */

/**
 * Lecture 25-26: classic Promise .then()/.catch() CHAINING.
 * Performs an API check and returns true if the API responds successfully.
 * @returns {Promise<boolean>}
 */
function checkApiStatus() {
  return fetchWithRetry(`${EXCHANGE_RATE_API_BASE}INR`)
    .then((response) => response.json())
    .then((data) => data.result === "success")
    .catch((error) => {
      console.error("API status check failed:", error);
      return false;
    });
}


/* =========================================================
   UI WIRING
   ========================================================= */

/** Shows an error message and hides any previous result. */
function showCurrencyError(message) {
  currencyErrorEl.textContent = message;
  currencyErrorEl.classList.remove("is-hidden");
  currencyResultEl.classList.add("is-hidden");
}

/** Hides the error message, if one is showing. */
function clearCurrencyError() {
  currencyErrorEl.classList.add("is-hidden");
}

/** Renders the converted amount and the rate used, in the result box. */
function showCurrencyResult(amount, fromCurrency, toCurrency, convertedAmount, rate) {
  currencyResultEl.innerHTML = `
    ${amount} ${fromCurrency} = ${convertedAmount.toFixed(2)} ${toCurrency}
    <span class="rate-note">1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}</span>
  `;
  currencyResultEl.classList.remove("is-hidden");
}

/**
 * Handles the "Convert" button click: validates input, shows a loading
 * state, calls convertCurrency(), and displays the result or an error.
 */
async function handleConvertClick(event) {
  event.preventDefault();
  clearCurrencyError();

  const amount = Number(currencyAmountInput.value);
  const fromCurrency = currencyFromSelect.value;
  const toCurrency = currencyToSelect.value;

  if (!Number.isFinite(amount) || amount <= 0) {
    showCurrencyError("Please enter an amount greater than 0.");
    return;
  }

  if (fromCurrency === toCurrency) {
    showCurrencyResult(amount, fromCurrency, toCurrency, amount, 1);
    return;
  }

  // Lecture 25-26: loading state while the Promise is pending
  currencyConvertBtn.disabled = true;
  currencyConvertBtn.textContent = "Converting…";

  try {
    const { convertedAmount, rate } =
      await convertCurrency(amount, fromCurrency, toCurrency);

    showCurrencyResult(
      amount,
      fromCurrency,
      toCurrency,
      convertedAmount,
      rate
    );
  } catch (error) {
    console.error("Currency conversion failed:", error);
    // Lecture 25-26: try/catch error handling — never let a failed
    // fetch crash the app, always show a friendly message instead
    showCurrencyError(
      error.message || "Something went wrong. Please try again."
    );
  } finally {
    currencyConvertBtn.disabled = false;
    currencyConvertBtn.textContent = "Convert";
  }
}


/* =========================================================
   INIT
   ========================================================= */

/**
 * Populates the currency dropdowns and wires up the Convert button.
 * Does NOT call the exchange rate API — that only happens once the user
 * actually opens Settings (via checkCurrencyApiOnce) or clicks Convert,
 * so simply loading the app never makes an unrequested network call.
 */
function initCurrency() {
  populateSelectOptions(currencyFromSelect, CURRENCY_LIST);
  populateSelectOptions(currencyToSelect, CURRENCY_LIST);
  currencyFromSelect.value = "INR";
  currencyToSelect.value = "USD";

  currencyForm.addEventListener("submit", handleConvertClick);
}

let apiStatusChecked = false;

/**
 * Checks the exchange rate API's reachability, but only does real work the
 * first time it's called (subsequent calls in the same session are no-ops).
 * Called from ui.js when the Settings section is first opened.
 */
function checkCurrencyApiOnce() {
  if (apiStatusChecked) return;
  apiStatusChecked = true;

  if (!apiStatusEl) return;

  apiStatusEl.textContent = "Live rates: checking…";

  // Lecture 25-26: .then() callback runs once the Promise settles,
  // asynchronously, without blocking the rest of the app
  checkApiStatus().then((isOnline) => {
    apiStatusEl.textContent = isOnline
      ? "Live rates: connected"
      : "Live rates: unavailable";

    apiStatusEl.classList.toggle("status-ok", isOnline);
    apiStatusEl.classList.toggle("status-down", !isOnline);
  });
}

document.addEventListener("DOMContentLoaded", initCurrency);