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