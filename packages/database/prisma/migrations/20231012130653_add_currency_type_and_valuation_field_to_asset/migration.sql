-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'ZAR', 'BRL', 'MXN', 'SGD', 'NZD', 'SEK', 'NOK', 'KRW', 'RUB', 'HKD', 'SAR');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "value" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD';
