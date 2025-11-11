# Advanced Asset Index Documentation

## Overview

The Advanced Asset Index is a powerful feature designed for asset management that provides sophisticated filtering, sorting, and visualization capabilities. It offers a more detailed and customizable view of your asset inventory compared to the simple index, allowing for complex queries and organization of equipment.

## Key Features

- **Advanced Filtering**: Multi-criteria filtering with various operators for different data types
- **Natural Sorting**: Human-friendly sorting that properly handles numerical sequences
- **Multi-column Sorting**: Sort by multiple fields with customizable priority
- **Column Customization**: Show/hide and reorder columns based on your needs
- **Bulk Actions**: Perform actions on multiple assets simultaneously
- **Custom Fields Support**: Full support for organization-specific custom fields

## Technical Architecture

The Advanced Index is built using:

- Raw Prisma queries for optimal performance
- Type-safe TypeScript implementation
- React components for the UI
- Custom hooks for state management
- Server-side filtering and sorting for large datasets

## Documentation Index

### User Guides

1. [Advanced Filtering Guide](./advanced-filtering-guide.md)

   - Comprehensive guide to using the filtering system
   - Detailed explanations of operators for each field type
   - Examples and best practices

2. [Advanced Sorting Guide](./advanced-sorting-guide.md)

   - How to use single and multi-field sorting
   - Practical sorting strategies
   - Common sorting scenarios

3. [Natural Sorting Explanation](./natural-sorting-explanation.md)

   - Understanding natural sort order
   - Comparison with traditional sorting
   - Benefits for medical device management

4. [Asset Index Settings Guide](./asset-index-settings.md)
   - Column configuration and management
   - First column freezing functionality
   - Asset image display options
   - Settings persistence and troubleshooting

### Technical Documentation

1. **Components**

   - `advanced-asset-columns.tsx`: Column definitions and rendering
   - `advanced-asset-row.tsx`: Row component implementation
   - `advanced-filters/`: Filter-related components
   - `advanced-table-header.tsx`: Table header implementation

2. **Services**

   - `query.server.ts`: Raw query implementations
   - `service.server.ts`: Business logic and data processing
   - `types.ts`: TypeScript type definitions

3. **Hooks**
   - `use-asset-index-columns.ts`: Column management
   - `use-asset-index-mode.ts`: Mode switching logic
   - Various other utility hooks

## Getting Started

1. **Access Advanced Mode**

   - Switch to advanced mode from the asset index page
   - Note: Advanced mode requires appropriate permissions

2. **Configure Columns**

   - Use the column configuration menu to select visible columns
   - Drag and drop to reorder columns
   - Custom fields will appear at the end of the column list

3. **Set Up Filters**

   - Click the filter button to add filters
   - Multiple filters can be combined
   - Use different operators based on field types

4. **Configure Sorting**
   - Click the sort button to add sort criteria
   - Multiple sort fields can be added
   - Toggle ascending/descending order

## Common Use Cases

1. **Maintenance Planning**

   - Filter by maintenance due dates
   - Sort by priority and location
   - Group by department

2. **Inventory Audit**

   - Filter by categories and value ranges
   - Sort by acquisition date
   - Group by location

3. **Compliance Monitoring**
   - Filter by certification status
   - Sort by expiration dates
   - Group by regulatory requirements

## Best Practices

1. **Performance**

   - Start with broad filters before adding specific ones
   - Use exact matches when possible
   - Combine filters effectively

2. **Organization**

   - Use consistent naming conventions
   - Maintain accurate custom field data
   - Regular cleanup of unused filters

3. **Security**
   - Respect role-based access controls
   - Validate all user inputs
   - Maintain audit trails

## Contributing

If you find issues or have suggestions for improvement:

1. Document the specific use case
2. Provide example data if possible
3. Submit through the appropriate channel
4. Follow the provided templates

## Support

For technical support or questions:

- Check the troubleshooting guides
- Contact technical support
- Submit feature requests through proper channels

---
