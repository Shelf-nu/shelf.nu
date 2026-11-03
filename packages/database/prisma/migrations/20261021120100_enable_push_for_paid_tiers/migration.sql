-- Enable canUsePushNotifications for Plus (tier_1) and Team (tier_2) tiers
  UPDATE "TierLimit"
  SET "canUsePushNotifications" = true
  WHERE id IN ('tier_1', 'tier_2');
