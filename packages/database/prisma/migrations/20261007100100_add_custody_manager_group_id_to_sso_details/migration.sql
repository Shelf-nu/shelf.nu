-- The IdP group whose members are assigned the Custody Manager role.
ALTER TABLE "SsoDetails" ADD COLUMN "custodyManagerGroupId" TEXT;
