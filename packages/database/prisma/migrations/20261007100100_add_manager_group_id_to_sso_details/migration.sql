-- The IdP group whose members are assigned the Manager role.
ALTER TABLE "SsoDetails" ADD COLUMN "managerGroupId" TEXT;
