-- Creates the default user Roles needed for the application to work properly
-- The default roles are 'USER' and 'ADMIN'

INSERT INTO "Role" ("id", "name", "createdAt", "updatedAt")
SELECT uuid_generate_v4(), 'USER', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'USER');

INSERT INTO "Role" ("id", "name", "createdAt", "updatedAt")
SELECT uuid_generate_v4(), 'ADMIN', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN');