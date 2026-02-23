-- Add all ISO 4217 currency codes to the Currency enum
-- This migration is idempotent (safe to run multiple times) using IF NOT EXISTS
-- Reference: https://www.iso.org/iso-4217-currency-codes.html

-- New currencies added (alphabetical order)
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AFN'; -- Afghani
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ALL'; -- Lek
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AMD'; -- Armenian Dram
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ANG'; -- Netherlands Antillean Guilder
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AOA'; -- Kwanza
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ARS'; -- Argentine Peso
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AWG'; -- Aruban Florin
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AZN'; -- Azerbaijan Manat
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BAM'; -- Convertible Mark
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BBD'; -- Barbados Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BDT'; -- Taka
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BHD'; -- Bahraini Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BIF'; -- Burundi Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BMD'; -- Bermudian Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BND'; -- Brunei Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BOB'; -- Boliviano
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BSD'; -- Bahamian Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BTN'; -- Ngultrum
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BWP'; -- Pula
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BYN'; -- Belarusian Ruble
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BZD'; -- Belize Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CDF'; -- Congolese Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CLP'; -- Chilean Peso
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'COP'; -- Colombian Peso
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CRC'; -- Costa Rican Colon
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CUP'; -- Cuban Peso
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CVE'; -- Cabo Verde Escudo
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'DJF'; -- Djibouti Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'DOP'; -- Dominican Peso
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'DZD'; -- Algerian Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'EGP'; -- Egyptian Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ERN'; -- Nakfa
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ETB'; -- Ethiopian Birr
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'FJD'; -- Fiji Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'FKP'; -- Falkland Islands Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GEL'; -- Lari
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GHS'; -- Ghana Cedi
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GIP'; -- Gibraltar Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GMD'; -- Dalasi
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GNF'; -- Guinean Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GTQ'; -- Quetzal
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GYD'; -- Guyana Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'HNL'; -- Lempira
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'HTG'; -- Gourde
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'HUF'; -- Forint
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ILS'; -- New Israeli Sheqel
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'IQD'; -- Iraqi Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'IRR'; -- Iranian Rial
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ISK'; -- Iceland Krona
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'JMD'; -- Jamaican Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'JOD'; -- Jordanian Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KES'; -- Kenyan Shilling
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KGS'; -- Som
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KHR'; -- Riel
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KMF'; -- Comorian Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KPW'; -- North Korean Won
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KWD'; -- Kuwaiti Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KYD'; -- Cayman Islands Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'KZT'; -- Tenge
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'LAK'; -- Lao Kip
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'LBP'; -- Lebanese Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'LRD'; -- Liberian Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'LSL'; -- Loti
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'LYD'; -- Libyan Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MAD'; -- Moroccan Dirham
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MDL'; -- Moldovan Leu
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MGA'; -- Malagasy Ariary
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MKD'; -- Denar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MMK'; -- Kyat
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MNT'; -- Tugrik
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MOP'; -- Pataca
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MRU'; -- Ouguiya
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MUR'; -- Mauritius Rupee
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MVR'; -- Rufiyaa
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MWK'; -- Malawi Kwacha
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MZN'; -- Mozambique Metical
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'NAD'; -- Namibia Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'NGN'; -- Naira
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'NIO'; -- Cordoba Oro
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'NPR'; -- Nepalese Rupee
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'OMR'; -- Rial Omani
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'PAB'; -- Balboa
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'PEN'; -- Sol
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'PGK'; -- Kina
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'PYG'; -- Guarani
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'QAR'; -- Qatari Rial
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'RSD'; -- Serbian Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'RWF'; -- Rwanda Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SBD'; -- Solomon Islands Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SCR'; -- Seychelles Rupee
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SDG'; -- Sudanese Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SHP'; -- Saint Helena Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SLE'; -- Leone
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SOS'; -- Somali Shilling
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SRD'; -- Surinam Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SSP'; -- South Sudanese Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'STN'; -- Dobra
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SVC'; -- El Salvador Colon
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SYP'; -- Syrian Pound
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SZL'; -- Lilangeni
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'THB'; -- Baht
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TJS'; -- Somoni
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TMT'; -- Turkmenistan Manat
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TND'; -- Tunisian Dinar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TOP'; -- Pa'anga
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TRY'; -- Turkish Lira
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TTD'; -- Trinidad and Tobago Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TZS'; -- Tanzanian Shilling
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'UAH'; -- Hryvnia
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'UYU'; -- Peso Uruguayo
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'UZS'; -- Uzbekistan Sum
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'VES'; -- Bolívar Soberano
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'VND'; -- Dong
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'VUV'; -- Vatu
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'WST'; -- Tala
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'XAF'; -- CFA Franc BEAC
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'XCD'; -- East Caribbean Dollar
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'XOF'; -- CFA Franc BCEAO
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'XPF'; -- CFP Franc
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'YER'; -- Yemeni Rial
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ZMW'; -- Zambian Kwacha
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'ZWL'; -- Zimbabwe Dollar
