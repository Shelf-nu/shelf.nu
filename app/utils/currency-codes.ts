/**
 * ISO 4217 Currency Codes
 *
 * This file serves as the single source of truth for all supported currencies
 * in the Shelf application. The list is based on the ISO 4217 standard which
 * defines alphabetic and numeric codes for currencies.
 *
 * @see https://www.iso.org/iso-4217-currency-codes.html
 * @see https://www.iban.com/currency-codes
 *
 * IMPORTANT: When adding new currencies, also update:
 * 1. The Prisma schema enum (app/database/schema.prisma)
 * 2. Create a migration to add the currency to the database
 */

export interface CurrencyDefinition {
  /** ISO 4217 3-letter currency code */
  code: string;
  /** Full currency name */
  name: string;
  /** ISO 4217 3-digit numeric code */
  numericCode: string;
  /** Number of decimal places (minor unit) */
  decimalDigits: number;
}

/**
 * Complete list of active ISO 4217 currencies.
 * Sorted alphabetically by currency code.
 */
export const ISO_4217_CURRENCIES: CurrencyDefinition[] = [
  { code: "AED", name: "UAE Dirham", numericCode: "784", decimalDigits: 2 },
  { code: "AFN", name: "Afghani", numericCode: "971", decimalDigits: 2 },
  { code: "ALL", name: "Lek", numericCode: "008", decimalDigits: 2 },
  { code: "AMD", name: "Armenian Dram", numericCode: "051", decimalDigits: 2 },
  {
    code: "ANG",
    name: "Netherlands Antillean Guilder",
    numericCode: "532",
    decimalDigits: 2,
  },
  { code: "AOA", name: "Kwanza", numericCode: "973", decimalDigits: 2 },
  { code: "ARS", name: "Argentine Peso", numericCode: "032", decimalDigits: 2 },
  {
    code: "AUD",
    name: "Australian Dollar",
    numericCode: "036",
    decimalDigits: 2,
  },
  { code: "AWG", name: "Aruban Florin", numericCode: "533", decimalDigits: 2 },
  {
    code: "AZN",
    name: "Azerbaijan Manat",
    numericCode: "944",
    decimalDigits: 2,
  },
  {
    code: "BAM",
    name: "Convertible Mark",
    numericCode: "977",
    decimalDigits: 2,
  },
  {
    code: "BBD",
    name: "Barbados Dollar",
    numericCode: "052",
    decimalDigits: 2,
  },
  { code: "BDT", name: "Taka", numericCode: "050", decimalDigits: 2 },
  { code: "BGN", name: "Bulgarian Lev", numericCode: "975", decimalDigits: 2 },
  { code: "BHD", name: "Bahraini Dinar", numericCode: "048", decimalDigits: 3 },
  { code: "BIF", name: "Burundi Franc", numericCode: "108", decimalDigits: 0 },
  {
    code: "BMD",
    name: "Bermudian Dollar",
    numericCode: "060",
    decimalDigits: 2,
  },
  { code: "BND", name: "Brunei Dollar", numericCode: "096", decimalDigits: 2 },
  { code: "BOB", name: "Boliviano", numericCode: "068", decimalDigits: 2 },
  { code: "BRL", name: "Brazilian Real", numericCode: "986", decimalDigits: 2 },
  {
    code: "BSD",
    name: "Bahamian Dollar",
    numericCode: "044",
    decimalDigits: 2,
  },
  { code: "BTN", name: "Ngultrum", numericCode: "064", decimalDigits: 2 },
  { code: "BWP", name: "Pula", numericCode: "072", decimalDigits: 2 },
  {
    code: "BYN",
    name: "Belarusian Ruble",
    numericCode: "933",
    decimalDigits: 2,
  },
  { code: "BZD", name: "Belize Dollar", numericCode: "084", decimalDigits: 2 },
  {
    code: "CAD",
    name: "Canadian Dollar",
    numericCode: "124",
    decimalDigits: 2,
  },
  {
    code: "CDF",
    name: "Congolese Franc",
    numericCode: "976",
    decimalDigits: 2,
  },
  { code: "CHF", name: "Swiss Franc", numericCode: "756", decimalDigits: 2 },
  { code: "CLP", name: "Chilean Peso", numericCode: "152", decimalDigits: 0 },
  { code: "CNY", name: "Yuan Renminbi", numericCode: "156", decimalDigits: 2 },
  { code: "COP", name: "Colombian Peso", numericCode: "170", decimalDigits: 2 },
  {
    code: "CRC",
    name: "Costa Rican Colon",
    numericCode: "188",
    decimalDigits: 2,
  },
  { code: "CUP", name: "Cuban Peso", numericCode: "192", decimalDigits: 2 },
  {
    code: "CVE",
    name: "Cabo Verde Escudo",
    numericCode: "132",
    decimalDigits: 2,
  },
  { code: "CZK", name: "Czech Koruna", numericCode: "203", decimalDigits: 2 },
  {
    code: "DJF",
    name: "Djibouti Franc",
    numericCode: "262",
    decimalDigits: 0,
  },
  { code: "DKK", name: "Danish Krone", numericCode: "208", decimalDigits: 2 },
  { code: "DOP", name: "Dominican Peso", numericCode: "214", decimalDigits: 2 },
  { code: "DZD", name: "Algerian Dinar", numericCode: "012", decimalDigits: 2 },
  { code: "EGP", name: "Egyptian Pound", numericCode: "818", decimalDigits: 2 },
  { code: "ERN", name: "Nakfa", numericCode: "232", decimalDigits: 2 },
  { code: "ETB", name: "Ethiopian Birr", numericCode: "230", decimalDigits: 2 },
  { code: "EUR", name: "Euro", numericCode: "978", decimalDigits: 2 },
  { code: "FJD", name: "Fiji Dollar", numericCode: "242", decimalDigits: 2 },
  {
    code: "FKP",
    name: "Falkland Islands Pound",
    numericCode: "238",
    decimalDigits: 2,
  },
  { code: "GBP", name: "Pound Sterling", numericCode: "826", decimalDigits: 2 },
  { code: "GEL", name: "Lari", numericCode: "981", decimalDigits: 2 },
  { code: "GHS", name: "Ghana Cedi", numericCode: "936", decimalDigits: 2 },
  {
    code: "GIP",
    name: "Gibraltar Pound",
    numericCode: "292",
    decimalDigits: 2,
  },
  { code: "GMD", name: "Dalasi", numericCode: "270", decimalDigits: 2 },
  { code: "GNF", name: "Guinean Franc", numericCode: "324", decimalDigits: 0 },
  { code: "GTQ", name: "Quetzal", numericCode: "320", decimalDigits: 2 },
  { code: "GYD", name: "Guyana Dollar", numericCode: "328", decimalDigits: 2 },
  {
    code: "HKD",
    name: "Hong Kong Dollar",
    numericCode: "344",
    decimalDigits: 2,
  },
  { code: "HNL", name: "Lempira", numericCode: "340", decimalDigits: 2 },
  { code: "HTG", name: "Gourde", numericCode: "332", decimalDigits: 2 },
  { code: "HUF", name: "Forint", numericCode: "348", decimalDigits: 2 },
  { code: "IDR", name: "Rupiah", numericCode: "360", decimalDigits: 2 },
  {
    code: "ILS",
    name: "New Israeli Sheqel",
    numericCode: "376",
    decimalDigits: 2,
  },
  { code: "INR", name: "Indian Rupee", numericCode: "356", decimalDigits: 2 },
  { code: "IQD", name: "Iraqi Dinar", numericCode: "368", decimalDigits: 3 },
  { code: "IRR", name: "Iranian Rial", numericCode: "364", decimalDigits: 2 },
  { code: "ISK", name: "Iceland Krona", numericCode: "352", decimalDigits: 0 },
  {
    code: "JMD",
    name: "Jamaican Dollar",
    numericCode: "388",
    decimalDigits: 2,
  },
  {
    code: "JOD",
    name: "Jordanian Dinar",
    numericCode: "400",
    decimalDigits: 3,
  },
  { code: "JPY", name: "Yen", numericCode: "392", decimalDigits: 0 },
  {
    code: "KES",
    name: "Kenyan Shilling",
    numericCode: "404",
    decimalDigits: 2,
  },
  { code: "KGS", name: "Som", numericCode: "417", decimalDigits: 2 },
  { code: "KHR", name: "Riel", numericCode: "116", decimalDigits: 2 },
  { code: "KMF", name: "Comorian Franc", numericCode: "174", decimalDigits: 0 },
  {
    code: "KPW",
    name: "North Korean Won",
    numericCode: "408",
    decimalDigits: 2,
  },
  { code: "KRW", name: "Won", numericCode: "410", decimalDigits: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", numericCode: "414", decimalDigits: 3 },
  {
    code: "KYD",
    name: "Cayman Islands Dollar",
    numericCode: "136",
    decimalDigits: 2,
  },
  { code: "KZT", name: "Tenge", numericCode: "398", decimalDigits: 2 },
  { code: "LAK", name: "Lao Kip", numericCode: "418", decimalDigits: 2 },
  { code: "LBP", name: "Lebanese Pound", numericCode: "422", decimalDigits: 2 },
  {
    code: "LKR",
    name: "Sri Lanka Rupee",
    numericCode: "144",
    decimalDigits: 2,
  },
  {
    code: "LRD",
    name: "Liberian Dollar",
    numericCode: "430",
    decimalDigits: 2,
  },
  { code: "LSL", name: "Loti", numericCode: "426", decimalDigits: 2 },
  { code: "LYD", name: "Libyan Dinar", numericCode: "434", decimalDigits: 3 },
  {
    code: "MAD",
    name: "Moroccan Dirham",
    numericCode: "504",
    decimalDigits: 2,
  },
  { code: "MDL", name: "Moldovan Leu", numericCode: "498", decimalDigits: 2 },
  {
    code: "MGA",
    name: "Malagasy Ariary",
    numericCode: "969",
    decimalDigits: 2,
  },
  { code: "MKD", name: "Denar", numericCode: "807", decimalDigits: 2 },
  { code: "MMK", name: "Kyat", numericCode: "104", decimalDigits: 2 },
  { code: "MNT", name: "Tugrik", numericCode: "496", decimalDigits: 2 },
  { code: "MOP", name: "Pataca", numericCode: "446", decimalDigits: 2 },
  { code: "MRU", name: "Ouguiya", numericCode: "929", decimalDigits: 2 },
  {
    code: "MUR",
    name: "Mauritius Rupee",
    numericCode: "480",
    decimalDigits: 2,
  },
  { code: "MVR", name: "Rufiyaa", numericCode: "462", decimalDigits: 2 },
  { code: "MWK", name: "Malawi Kwacha", numericCode: "454", decimalDigits: 2 },
  { code: "MXN", name: "Mexican Peso", numericCode: "484", decimalDigits: 2 },
  {
    code: "MYR",
    name: "Malaysian Ringgit",
    numericCode: "458",
    decimalDigits: 2,
  },
  {
    code: "MZN",
    name: "Mozambique Metical",
    numericCode: "943",
    decimalDigits: 2,
  },
  { code: "NAD", name: "Namibia Dollar", numericCode: "516", decimalDigits: 2 },
  { code: "NGN", name: "Naira", numericCode: "566", decimalDigits: 2 },
  { code: "NIO", name: "Cordoba Oro", numericCode: "558", decimalDigits: 2 },
  {
    code: "NOK",
    name: "Norwegian Krone",
    numericCode: "578",
    decimalDigits: 2,
  },
  { code: "NPR", name: "Nepalese Rupee", numericCode: "524", decimalDigits: 2 },
  {
    code: "NZD",
    name: "New Zealand Dollar",
    numericCode: "554",
    decimalDigits: 2,
  },
  { code: "OMR", name: "Rial Omani", numericCode: "512", decimalDigits: 3 },
  { code: "PAB", name: "Balboa", numericCode: "590", decimalDigits: 2 },
  { code: "PEN", name: "Sol", numericCode: "604", decimalDigits: 2 },
  { code: "PGK", name: "Kina", numericCode: "598", decimalDigits: 2 },
  {
    code: "PHP",
    name: "Philippine Peso",
    numericCode: "608",
    decimalDigits: 2,
  },
  { code: "PKR", name: "Pakistan Rupee", numericCode: "586", decimalDigits: 2 },
  { code: "PLN", name: "Zloty", numericCode: "985", decimalDigits: 2 },
  { code: "PYG", name: "Guarani", numericCode: "600", decimalDigits: 0 },
  { code: "QAR", name: "Qatari Rial", numericCode: "634", decimalDigits: 2 },
  { code: "RON", name: "Romanian Leu", numericCode: "946", decimalDigits: 2 },
  { code: "RSD", name: "Serbian Dinar", numericCode: "941", decimalDigits: 2 },
  { code: "RUB", name: "Russian Ruble", numericCode: "643", decimalDigits: 2 },
  { code: "RWF", name: "Rwanda Franc", numericCode: "646", decimalDigits: 0 },
  { code: "SAR", name: "Saudi Riyal", numericCode: "682", decimalDigits: 2 },
  {
    code: "SBD",
    name: "Solomon Islands Dollar",
    numericCode: "090",
    decimalDigits: 2,
  },
  {
    code: "SCR",
    name: "Seychelles Rupee",
    numericCode: "690",
    decimalDigits: 2,
  },
  { code: "SDG", name: "Sudanese Pound", numericCode: "938", decimalDigits: 2 },
  { code: "SEK", name: "Swedish Krona", numericCode: "752", decimalDigits: 2 },
  {
    code: "SGD",
    name: "Singapore Dollar",
    numericCode: "702",
    decimalDigits: 2,
  },
  {
    code: "SHP",
    name: "Saint Helena Pound",
    numericCode: "654",
    decimalDigits: 2,
  },
  { code: "SLE", name: "Leone", numericCode: "925", decimalDigits: 2 },
  {
    code: "SOS",
    name: "Somali Shilling",
    numericCode: "706",
    decimalDigits: 2,
  },
  {
    code: "SRD",
    name: "Surinam Dollar",
    numericCode: "968",
    decimalDigits: 2,
  },
  {
    code: "SSP",
    name: "South Sudanese Pound",
    numericCode: "728",
    decimalDigits: 2,
  },
  { code: "STN", name: "Dobra", numericCode: "930", decimalDigits: 2 },
  {
    code: "SVC",
    name: "El Salvador Colon",
    numericCode: "222",
    decimalDigits: 2,
  },
  { code: "SYP", name: "Syrian Pound", numericCode: "760", decimalDigits: 2 },
  { code: "SZL", name: "Lilangeni", numericCode: "748", decimalDigits: 2 },
  { code: "THB", name: "Baht", numericCode: "764", decimalDigits: 2 },
  { code: "TJS", name: "Somoni", numericCode: "972", decimalDigits: 2 },
  {
    code: "TMT",
    name: "Turkmenistan Manat",
    numericCode: "934",
    decimalDigits: 2,
  },
  { code: "TND", name: "Tunisian Dinar", numericCode: "788", decimalDigits: 3 },
  { code: "TOP", name: "Pa'anga", numericCode: "776", decimalDigits: 2 },
  { code: "TRY", name: "Turkish Lira", numericCode: "949", decimalDigits: 2 },
  {
    code: "TTD",
    name: "Trinidad and Tobago Dollar",
    numericCode: "780",
    decimalDigits: 2,
  },
  {
    code: "TWD",
    name: "New Taiwan Dollar",
    numericCode: "901",
    decimalDigits: 2,
  },
  {
    code: "TZS",
    name: "Tanzanian Shilling",
    numericCode: "834",
    decimalDigits: 2,
  },
  { code: "UAH", name: "Hryvnia", numericCode: "980", decimalDigits: 2 },
  {
    code: "UGX",
    name: "Uganda Shilling",
    numericCode: "800",
    decimalDigits: 0,
  },
  { code: "USD", name: "US Dollar", numericCode: "840", decimalDigits: 2 },
  { code: "UYU", name: "Peso Uruguayo", numericCode: "858", decimalDigits: 2 },
  { code: "UZS", name: "Uzbekistan Sum", numericCode: "860", decimalDigits: 2 },
  {
    code: "VES",
    name: "Bolívar Soberano",
    numericCode: "928",
    decimalDigits: 2,
  },
  { code: "VND", name: "Dong", numericCode: "704", decimalDigits: 0 },
  { code: "VUV", name: "Vatu", numericCode: "548", decimalDigits: 0 },
  { code: "WST", name: "Tala", numericCode: "882", decimalDigits: 2 },
  {
    code: "XAF",
    name: "CFA Franc BEAC",
    numericCode: "950",
    decimalDigits: 0,
  },
  {
    code: "XCD",
    name: "East Caribbean Dollar",
    numericCode: "951",
    decimalDigits: 2,
  },
  {
    code: "XOF",
    name: "CFA Franc BCEAO",
    numericCode: "952",
    decimalDigits: 0,
  },
  { code: "XPF", name: "CFP Franc", numericCode: "953", decimalDigits: 0 },
  { code: "YER", name: "Yemeni Rial", numericCode: "886", decimalDigits: 2 },
  { code: "ZAR", name: "Rand", numericCode: "710", decimalDigits: 2 },
  { code: "ZMW", name: "Zambian Kwacha", numericCode: "967", decimalDigits: 2 },
  {
    code: "ZWL",
    name: "Zimbabwe Dollar",
    numericCode: "932",
    decimalDigits: 2,
  },
] as const;

/**
 * Array of ISO 4217 currency codes only (for validation, dropdowns, etc.)
 */
export const ISO_4217_CURRENCY_CODES = ISO_4217_CURRENCIES.map(
  (c) => c.code
) as readonly string[];

/**
 * Type representing valid ISO 4217 currency codes
 */
export type Iso4217CurrencyCode = (typeof ISO_4217_CURRENCIES)[number]["code"];

/**
 * Map of currency code to currency definition for quick lookup
 */
export const CURRENCY_MAP = new Map<string, CurrencyDefinition>(
  ISO_4217_CURRENCIES.map((c) => [c.code, c])
);

/**
 * Get the full currency definition by code
 */
export function getCurrencyDefinition(
  code: string
): CurrencyDefinition | undefined {
  return CURRENCY_MAP.get(code);
}

/**
 * Get the display name for a currency code
 */
export function getCurrencyName(code: string): string {
  return CURRENCY_MAP.get(code)?.name ?? code;
}

/**
 * Get decimal digits for a currency (used for formatting)
 */
export function getCurrencyDecimalDigits(code: string): number {
  return CURRENCY_MAP.get(code)?.decimalDigits ?? 2;
}

/**
 * Check if a string is a valid ISO 4217 currency code
 */
export function isValidCurrencyCode(code: string): code is Iso4217CurrencyCode {
  return CURRENCY_MAP.has(code);
}
