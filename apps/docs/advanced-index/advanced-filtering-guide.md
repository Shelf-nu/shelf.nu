# Advanced Asset Filtering Guide

This guide explains how to use the advanced filtering system to find your assets quickly and efficiently.

## Understanding Filter Types

Each field in your asset database can be filtered in different ways depending on its type. Below you'll find detailed explanations for each type of filter and how to use them.

## Text Filters (Name, Description, etc.)

### Available Operators:

- **is**: Exact match (case-insensitive)
  - Use when: You know the exact text you're looking for
  - Example: `Name is "Ultrasound Machine 3"`

- **is not**: Excludes exact match
  - Use when: You want to exclude a specific item
  - Example: `Name is not "Broken Scanner"`

- **contains**: Partial match
  - Use when: You remember part of the text
  - Example: `Description contains "calibrated"`

- **matches any**: Multiple exact matches
  - Use when: You want to find items that match any of several exact terms
  - Example: `Name matches any "Scanner A, Scanner B, Scanner C"`

- **contains any**: Multiple partial matches
  - Use when: You want to find items containing any of several terms
  - Example: `Description contains any "maintenance, repair, calibration"`

## Number Filters (Value, etc.)

### Available Operators:

- **is**: Exact match
  - Use when: You know the exact value
  - Example: `Value is 5000`

- **is not**: Excludes exact match
  - Use when: You want to exclude a specific value
  - Example: `Value is not 0`

- **greater than**: Above value
  - Use when: You want items above a certain value
  - Example: `Value greater than 1000`

- **less than**: Below value
  - Use when: You want items below a certain value
  - Example: `Value less than 5000`

- **between**: Range of values
  - Use when: You want items within a specific range
  - Example: `Value between 1000 and 5000`

## Date Filters (Created At, etc.)

### Available Operators:

- **is**: Specific date
  - Use when: You want items from a specific date
  - Example: `Created At is 2024-01-15`

- **is not**: Exclude specific date
  - Use when: You want to exclude a specific date
  - Example: `Created At is not 2024-01-15`

- **before**: Before date
  - Use when: You want items before a certain date
  - Example: `Created At before 2024-01-15`

- **after**: After date
  - Use when: You want items after a certain date
  - Example: `Created At after 2024-01-15`

- **between**: Date range
  - Use when: You want items within a specific date range
  - Example: `Created At between 2024-01-01 and 2024-01-31`

- **in dates**: Multiple specific dates
  - Use when: You want items from several specific dates
  - Example: `Created At in dates 2024-01-15, 2024-01-20, 2024-01-25`

## Yes/No Filters (Available to Book, etc.)

### Available Operators:

- **is**: Yes or No
  - Use when: You want to filter by a yes/no condition
  - Example: `Available to Book is Yes`

## Category, Location, and Kit Filters

### Available Operators:

- **is**: Exact match
  - Use when: You want items from a specific category/location/kit
  - Example: `Category is "Imaging Equipment"`

- **is not**: Exclude match
  - Use when: You want to exclude a specific category/location/kit
  - Example: `Location is not "Storage Room A"`

- **contains any**: Multiple matches
  - Use when: You want items from any of several categories/locations/kits
  - Example: `Category contains any "Imaging Equipment, Patient Monitors"`

Special Options:

- "Without category" for uncategorized items
- "Without location" for items without a location
- "Without kit" for items not in any kit

## Tags

### Available Operators:

- **contains**: Has specific tag
  - Use when: You want items with a specific tag
  - Example: `Tags contains "needs-calibration"`

- **contains all**: Has all specified tags
  - Use when: You want items that have all of several tags
  - Example: `Tags contains all "maintenance-due, high-priority"`

- **contains any**: Has any of specified tags
  - Use when: You want items that have any of several tags
  - Example: `Tags contains any "maintenance-due, calibration-due"`

## Custody

### Available Operators:

- **is**: Assigned to specific custodian
  - Use when: You want items assigned to a specific person
  - Example: `Custody is "Dr. Smith"`

- **is not**: Not assigned to specific custodian
  - Use when: You want items not assigned to a specific person
  - Example: `Custody is not "Dr. Smith"`

- **contains any**: Assigned to any of specified custodians
  - Use when: You want items assigned to any of several people
  - Example: `Custody contains any "Dr. Smith, Dr. Jones"`

Special Option:

- "Without custody" for unassigned items

## Tips for Effective Filtering

1. **Combine Filters**: You can add multiple filters to narrow down your search
   - Example: Find all high-value imaging equipment in a specific location
     - `Category is "Imaging Equipment"`
     - `Value greater than 10000`
     - `Location is "Radiology Department"`

2. **Start Broad, Then Narrow**: Begin with broader filters and add more specific ones as needed

3. **Use Clear Names**: When naming assets, categories, or tags, use clear, consistent names to make filtering easier

4. **Regular Maintenance**: Regularly update tags, categories, and locations to maintain accurate filtering

## Troubleshooting Common Issues

- **No Results**: If you're getting no results, try:
  1. Checking for typos in your filter values
  2. Using broader filters or fewer filters
  3. Using "contains" instead of "is" for partial matches
  4. Verifying date formats (YYYY-MM-DD)

- **Too Many Results**: If you're getting too many results, try:
  1. Adding more specific filters
  2. Using exact matches ("is") instead of partial matches ("contains")
  3. Adding date ranges to narrow the time period

Remember: Filters are case-insensitive, so "SCANNER" and "scanner" will return the same results.
