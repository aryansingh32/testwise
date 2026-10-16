-- Coin-only pricing: series and tournament entries are paid from the wallet.
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'SPEND';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'SPEND_REFUND';

-- The wallet is on by default; flip an explicitly stored "disabled" setting too.
UPDATE "AppConfig" SET "value" = jsonb_set("value"::jsonb, '{enabled}', 'true')
WHERE "key" = 'wallet.settings' AND "value"::jsonb ->> 'enabled' = 'false';
