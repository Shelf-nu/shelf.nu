-- Add month-name date-format preferences (display-only, opt-in via settings):
--   MMM_DD_YYYY -> "Jul 20, 2026"   (US, month name first, comma before year)
--   DD_MMM_YYYY -> "20 Jul 2026"    (EU, day first, no comma)
--
-- `ALTER TYPE ... ADD VALUE` is safe inside a single migration transaction on
-- PostgreSQL 12+ provided the new values are not USED in the same transaction
-- (this migration only adds them). Detection never emits these values, so they
-- are chosen manually by users; existing rows keep their current preference.
ALTER TYPE "DateFormatPreference" ADD VALUE 'MMM_DD_YYYY';
ALTER TYPE "DateFormatPreference" ADD VALUE 'DD_MMM_YYYY';
