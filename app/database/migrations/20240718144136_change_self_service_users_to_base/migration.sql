-- Change SELF_SERVICE users to BASE users

UPDATE "UserOrganization"
SET "roles" = array_replace("roles", 'SELF_SERVICE', 'BASE')
WHERE 'SELF_SERVICE' = ANY("roles");