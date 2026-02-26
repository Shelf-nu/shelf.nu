# Advanced Asset Sorting Guide

This guide explains how to use the sorting system to organize your assets in a meaningful way.

## Understanding Asset Sorting

### Basic Sorting Concepts

- Each field can be sorted in ascending (A to Z, 0 to 9) or descending (Z to A, 9 to 0) order
- You can sort by multiple fields in a specific priority order
- Sorting is case-insensitive ("Scanner" and "scanner" are treated the same)

## Single Field Sorting

When you sort by a single field, all assets are organized based on that one criterion.

### Examples of Single Field Sorting:

1. **Sort by Name (A to Z)**

   - Result: Assets arranged alphabetically
   - Example order:
     1. Anesthesia Machine
     2. Blood Pressure Monitor
     3. CT Scanner
     4. X-Ray Machine

2. **Sort by Value (High to Low)**
   - Result: Assets arranged by monetary value
   - Example order:
     1. MRI Machine ($1,000,000)
     2. CT Scanner ($500,000)
     3. Ultrasound ($75,000)
     4. Blood Pressure Monitor ($500)

## Multi-Field Sorting

Multi-field sorting is powerful but often misunderstood. Here's how it works:

1. **Primary Sort**: First field is applied to all assets
2. **Secondary Sort**: When two items have the same value in the primary sort, the second sort field determines their order
3. **Additional Sorts**: This continues for each additional sort field

### Example of Multi-Field Sorting:

Let's say you sort by:

1. Category (Primary)
2. Value (Secondary)
3. Name (Tertiary)

Your results might look like this:

```
Imaging Equipment (Category)
  └─ CT Scanner ($500,000)
  └─ MRI Scanner ($1,000,000)
  └─ X-Ray Machine ($200,000)

Patient Monitors (Category)
  └─ Advanced Monitor ($5,000)
  └─ Basic Monitor ($1,000)
  └─ Cardiac Monitor ($3,000)

Surgical Equipment (Category)
  └─ Anesthesia Machine ($50,000)
  └─ Basic Surgical Kit ($1,000)
  └─ Laser System ($75,000)
```

## Practical Sorting Strategies

### For Inventory Management

1. **Location → Category → Name**
   - Groups all equipment by location first
   - Within each location, groups by category
   - Alphabetically orders items within each category

### For Maintenance Planning

1. **Maintenance Due Date → Category → Location**
   - Shows equipment needing attention soonest
   - Grouped by category for efficient maintenance scheduling
   - Location helps plan maintenance routes

### For Asset Tracking

1. **Category → Value → Name**
   - Groups similar equipment together
   - Shows highest value items within each category
   - Easy alphabetical reference within value groups

## Tips for Effective Sorting

1. **Think Hierarchically**

   - Start with your most important grouping
   - Add supporting sorts that make sense within groups
   - Use name as a final sort for easy scanning

2. **Consider Your Task**

   - Inventory: Location-based sorting might be most useful
   - Maintenance: Date-based sorting might be priority
   - Auditing: Value-based sorting might be key

3. **Combine with Filters**
   - First filter to your relevant subset of assets
   - Then apply sorting to organize them meaningfully

## Sortable Fields Reference

Not all fields can be sorted. Here's what you can sort by:

### Basic Fields

- Name
- ID
- Status
- Description
- Value
- Created Date
- Category
- Location
- Kit
- Custody

### Custom Fields

- Text fields
- Date fields
- Number fields
- Option fields (dropdown selections)

Note: Multi-line text fields cannot be sorted.

## Common Sorting Scenarios

### Maintenance Planning

```
1. Maintenance Due Date (ascending)
2. Location
3. Name
```

Shows what needs attention first, grouped by location.

### Inventory Audit

```
1. Category
2. Value (descending)
3. Name
```

Groups similar items together, with highest value items first.

### Daily Operations

```
1. Location
2. Category
3. Name
```

Organizes items by physical location for easy access.

Remember: You can always reverse the sort direction (ascending/descending) of any field by clicking the toggle switch next to it.
