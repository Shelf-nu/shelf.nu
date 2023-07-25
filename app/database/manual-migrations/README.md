# Manual migrations

Inside this file are some manual migrations (seeds) that are required in order to populate the DB with master data. The master data is required for the Shelf application to run properly.

## Master data

1. Role - default are 2 roles with the names "USER" & "ADMIN"

## Relationship Data updates

Data updates are added at a later stage in the development and need to be run only if you are not doing a fresh install of Shelf

1. add-organizations-to-existing-users - create a PERSONAL organization for all users that don't have one yet
