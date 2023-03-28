# Title

Date: 28-03-2023

Status: accepted

## Context

Profile pictures of users should be private as our platform doesn't have any public profiles.
However pictures have no way of being actually crawled by bots as their url should not get exposed as it will only be visible behind a logged in layout so they should not get crawled.

There are 2 options:

1. Implement a signed url functionality for the picture. That would require us to store an expiration time and generate a new image url when the signed image is expired and update the user.
2. Change the policy of the bucket to make viewing images public. So if someone somehow gets access to the url they will be able to view the picture.

## Decision

For the purpose of shipping fast, we have decided to go for option 2 and if needed in the future implement a signed url functionality.

## Consequences
