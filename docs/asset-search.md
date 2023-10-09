# Asset search using Prisma DB's Full text search

We wanted to implement a simple yet powerful search solution that will allow the users(in the short term) to quick search assets not just based on name but also based on related entries.
After doing some research we chose an approach that might not be the most performant due to multiple JOINS but it works great in combination with Prisma's Full Text Search.

## The strategy

1. Create a `pg view` called `AssetSearchView` which has a `searchVector` field
2. The view has a relation to Asset model
3. Populate the view with the correct query. Here is the example query we used as a start:

```SQL
-- create view for searching assets
CREATE OR REPLACE VIEW "AssetSearchView" AS
SELECT
    a.id,
    a."createdAt",
    a.id as "assetId",
    COALESCE(a.title, '')
    || ' ' || COALESCE(c.name, '')
    || ' ' || COALESCE(a.description, '')
    || ' ' || COALESCE(string_agg(tm.name, ' '), '')
    || ' ' || COALESCE(string_agg(t.name, ' '), '')
    || ' ' || COALESCE(l.name, '') as "searchVector"
FROM
    public."Asset" a
LEFT JOIN
    public."Category" c ON a."categoryId" = c.id
LEFT JOIN
    public."Location" l ON a."locationId" = l.id
LEFT JOIN
    public."_AssetToTag" atr ON a.id = atr."A"
LEFT JOIN
    public."Tag" t ON atr."B" = t.id
LEFT JOIN
    public."Custody" custd ON a.id = custd."assetId"
LEFT JOIN
    public."TeamMember" tm ON custd."teamMemberId" = tm.id
GROUP BY
    a.id, c.id, l.id;
```

When you want to add more parameters to search by, you can simply create a new empty migration, copy the SQL code from above and adjust it to your liking.

Special thanks to [@mahendraHedge](https://github.com/mahendraHegde) for doing the research and coming up with this solution considering lots of limitations we have at the time or creating this.
