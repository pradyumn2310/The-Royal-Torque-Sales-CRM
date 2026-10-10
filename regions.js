// Single source of truth for Region -> Currency mapping.
// Used by the server (validation, CSV import, stats) and served to the
// browser via GET /api/regions so the client never needs its own copy.
//
// To add a new region/currency later, just add a row here — nothing else
// needs to change.
const REGIONS = [
  { name: 'India', currency: 'INR', symbol: '₹', locale: 'en-IN' },
  { name: 'United States', currency: 'USD', symbol: '$', locale: 'en-US' },
  { name: 'United Kingdom', currency: 'GBP', symbol: '£', locale: 'en-GB' },
  { name: 'European Union', currency: 'EUR', symbol: '€', locale: 'en-IE' },
  { name: 'United Arab Emirates', currency: 'AED', symbol: 'AED ', locale: 'en-AE' },
  { name: 'Saudi Arabia', currency: 'SAR', symbol: 'SAR ', locale: 'en-SA' },
  { name: 'Australia', currency: 'AUD', symbol: 'A$', locale: 'en-AU' },
  { name: 'Canada', currency: 'CAD', symbol: 'C$', locale: 'en-CA' },
  { name: 'Singapore', currency: 'SGD', symbol: 'S$', locale: 'en-SG' },
  { name: 'Other / Unspecified', currency: 'USD', symbol: '$', locale: 'en-US' },
];

const DEFAULT_REGION = 'India';

function regionByName(name) {
  return REGIONS.find((r) => r.name === name) || REGIONS.find((r) => r.name === DEFAULT_REGION);
}
function currencyForRegion(name) {
  return regionByName(name).currency;
}
function isValidRegion(name) {
  return REGIONS.some((r) => r.name === name);
}

module.exports = { REGIONS, DEFAULT_REGION, regionByName, currencyForRegion, isValidRegion };
