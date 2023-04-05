-- Enable RLS
alter table "_prisma_migrations" ENABLE row level security;

alter table "Item" ENABLE row level security;

alter table "User" ENABLE row level security;

alter table "Category" ENABLE row level security;
