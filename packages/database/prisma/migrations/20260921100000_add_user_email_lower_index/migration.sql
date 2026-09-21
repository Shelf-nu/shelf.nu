-- Invite creation, invite acceptance and CSV user import all match an account
-- without regard to letter case, which compares LOWER("email"). The unique
-- btree on "email" cannot answer that, so each of those lookups reads the whole
-- "User" table. This index restores an index scan for them.
--
-- Prisma has no schema syntax for an expression index, so this is raw SQL and
-- the declaration is carried as a comment on the User model in schema.prisma —
-- the same arrangement as the LOWER("name") unique indexes on CustomField,
-- Location and Tag.
CREATE INDEX "User_email_lower_idx" ON "User"(LOWER("email"));
