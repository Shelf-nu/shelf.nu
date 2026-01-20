# Product Requirements Document: Asset Age Calculation & Display

## Overview

**Feature Name**: Asset Age Calculation and Display
**Status**: Draft
**Created**: 2026-01-20
**Author**: Product Team
**Priority**: High

## Problem Statement

Asset managers need visibility into the age of their assets to make informed decisions about device lifecycle management and replacement planning. Currently, while users can create a "Purchase Date" custom field, there is no automated way to calculate or display the age of assets, requiring manual calculations and making it difficult to identify aging equipment that may need replacement.

## Goals

### Primary Goals

1. Automatically calculate asset age based on purchase date custom field
2. Display asset age in a clear, scannable format across key views
3. Enable sorting and filtering by asset age
4. Support age-based reporting for replacement planning

### Success Metrics

- 80%+ of organizations with purchase date data utilize age display features
- Reduce time spent on manual age calculations by 90%
- Increase identification of aging assets requiring replacement by 40%

## User Stories

### Asset Manager

> "As an asset manager, I want to see the age of each device at a glance so I can identify equipment that needs replacing based on our 3-year refresh cycle."

### IT Administrator

> "As an IT admin, I want to filter assets by age so I can generate reports of all devices older than 4 years for budget planning."

### Operations Lead

> "As an operations lead, I want to sort assets by age so I can prioritize replacement of the oldest equipment first."

## Requirements

### Functional Requirements

#### FR-1: Age Calculation

- **FR-1.1**: System shall calculate age based on a designated "Purchase Date" custom field
- **FR-1.2**: Age shall be calculated as years and months (e.g., "2y 3m")
- **FR-1.3**: Age calculation shall update daily/dynamically
- **FR-1.4**: System shall handle edge cases (future dates, missing dates)
- **FR-1.5**: Calculation shall be timezone-aware based on organization settings

#### FR-2: Age Display

- **FR-2.1**: Age shall display in asset list view as a dedicated column
- **FR-2.2**: Age shall display in asset detail view within metadata section
- **FR-2.3**: Age display shall be optional and configurable per organization
- **FR-2.4**: Age shall display as "N/A" when purchase date is not set

#### FR-3: Sorting & Filtering

- **FR-3.1**: Users shall be able to sort assets by age (oldest first, newest first)
- **FR-3.2**: Users shall be able to filter assets by age ranges:
  - Less than 1 year
  - 1-2 years
  - 2-3 years
  - 3-5 years
  - 5+ years
  - Custom range (min-max)
- **FR-3.3**: Age filters shall be compatible with other existing filters
- **FR-3.4**: Age sorting/filtering shall work with bulk select operations

#### FR-4: Custom Field Integration

- **FR-4.1**: System shall detect custom fields with type "Date" and name containing "purchase" (case-insensitive)
- **FR-4.2**: Users shall be able to designate which date field to use for age calculation in settings
- **FR-4.3**: System shall support fallback to "acquisitionDate" if no custom field is configured
- **FR-4.4**: Configuration shall be per-organization

#### FR-5: Reporting & Export

- **FR-5.1**: Age shall be included in asset exports (CSV, PDF)
- **FR-5.2**: Age-based reports shall be available in analytics
- **FR-5.3**: Bulk operations shall support age as a selection criteria

### Non-Functional Requirements

#### NFR-1: Performance

- Age calculation shall not impact asset list load time by more than 50ms
- Filtering by age shall return results within 1 second for up to 10,000 assets

#### NFR-2: Usability

- Age display format shall be clear and intuitive
- Configuration shall require no more than 3 clicks
- Visual indicators for aging assets (optional color coding)

#### NFR-3: Compatibility

- Feature shall work with existing custom field system
- Shall not break existing asset list functionality
- Shall be compatible with all supported browsers

## Design Considerations

### Display Format Options

- **Option A**: Compact format - "2y 3m" (recommended for table views)
- **Option B**: Verbose format - "2 years, 3 months"
- **Option C**: Months only - "27 months"

**Recommendation**: Use Option A in tables, Option B in detail views

### UI Placement

1. **Asset List View**: New "Age" column (hideable via column settings)
2. **Asset Detail View**: Metadata section alongside other date fields
3. **Filter Panel**: New "Age" filter group
4. **Settings**: Organization settings for custom field selection

### Visual Indicators (Optional Enhancement)

- Green: < 2 years
- Yellow: 2-4 years
- Orange: 4-5 years
- Red: 5+ years

_Note: Color thresholds should be configurable per organization_

## Technical Considerations

### Implementation Approach

#### Option 1: Virtual Column (Recommended)

Calculate age on-the-fly during query time

- **Pros**: Always accurate, no storage overhead
- **Cons**: Cannot index, potential performance impact at scale

#### Option 2: Computed Field with Daily Update

Store calculated age, update via scheduled job

- **Pros**: Can index, better query performance
- **Cons**: Requires job scheduler, slight staleness

#### Option 3: Hybrid Approach

Cache age ranges (e.g., "2-3 years") for filtering, calculate exact age on display

- **Pros**: Balance of performance and accuracy
- **Cons**: More complex implementation

**Recommendation**: Start with Option 1, migrate to Option 3 if performance issues arise

### Database Schema Changes

```prisma
// Add to Organization model (optional)
model Organization {
  // ... existing fields
  ageCalculationField String? // Custom field ID to use for age calculation
  ageThresholds       Json?   // Optional: color coding thresholds
}

// Leverage existing CustomField model
// No schema changes needed - use existing date fields
```

### URL State Pattern

Follow existing bookmark/filter pattern:

```
/assets?ageMin=24&ageMax=60  // 2-5 years in months
```

## User Flow

### Flow 1: Configure Age Calculation (First-time Setup)

1. Navigate to Organization Settings
2. Find "Asset Age" section
3. Select custom field to use for age calculation (default: "Purchase Date")
4. Save configuration
5. System displays toast: "Asset age will now be calculated from [Field Name]"

### Flow 2: View Asset Age

1. Navigate to Assets list
2. See "Age" column (if enabled in column settings)
3. View age displayed as "Xy Ym" format
4. Click asset to see detailed age in asset detail view

### Flow 3: Filter by Age

1. Open filter panel
2. Expand "Age" filter group
3. Select age range or enter custom min/max
4. Apply filter
5. See filtered results with age column visible

### Flow 4: Sort by Age

1. Click "Age" column header
2. Toggle between ascending/descending sort
3. See assets sorted oldest-to-newest or newest-to-oldest

## Edge Cases & Constraints

### Edge Cases

- **No Purchase Date**: Display "N/A", exclude from age filters
- **Future Purchase Date**: Display negative age or "Invalid date"
- **Invalid Date Format**: Display "Invalid", log warning
- **Multiple Date Fields**: Use configured field, fallback to first "purchase\*" field
- **Date Field Deleted**: Revert to default, notify admin
- **Leap Years**: Handle correctly in age calculation
- **Timezone Differences**: Use organization timezone for consistency

### Constraints

- Feature requires at least one date-type custom field
- Maximum supported age: 99 years, 11 months
- Age updates daily (not real-time to second)
- Limited to one age calculation field per organization

## Dependencies

### Technical Dependencies

- Existing custom field system
- Date handling utilities (date-fns or similar)
- Column visibility settings system
- Filter/bookmark URL state management

### Product Dependencies

- Custom field feature must be enabled
- User must have date-type custom field created
- Organizations must configure which field to use

## Rollout Plan

### Phase 1: MVP (Week 1-2)

- Age calculation logic
- Display in asset list and detail views
- Basic sorting capability
- Configuration in organization settings

### Phase 2: Filtering (Week 3)

- Age range filters
- URL state integration
- Preset age ranges (1y, 2y, 3y, 5y+)

### Phase 3: Enhancements (Week 4+)

- Export support
- Visual indicators/color coding
- Analytics integration
- Custom age thresholds

### Phase 4: Advanced Features (Future)

- Age-based notifications ("Asset X is 5 years old")
- Replacement planning tools
- Predictive maintenance based on age
- Age vs. maintenance cost analytics

## Success Criteria

### Launch Criteria

- [ ] Age calculates correctly for all test cases
- [ ] Display works across all supported browsers
- [ ] Sorting by age works correctly
- [ ] Performance impact < 50ms on 1000-asset list
- [ ] Configuration persists correctly
- [ ] Edge cases handled gracefully

### Adoption Criteria (30 days post-launch)

- 50%+ of orgs with purchase date field have viewed age column
- 25%+ have used age filtering
- 10%+ have configured custom age field settings
- < 5% bug report rate
- 4.0+ user satisfaction score (if surveyed)

## Open Questions

1. Should we support multiple date fields for different age calculations (e.g., warranty age vs. purchase age)?
2. What should the default age thresholds be for color coding?
3. Should we notify users when assets reach certain age milestones?
4. Do we need age-based automation (e.g., auto-tag assets > 5 years)?
5. Should age be visible to all user roles or restricted?

## Future Enhancements

- Age trending over time (analytics dashboard)
- Age distribution charts
- Replacement cost estimation based on age
- Integration with warranty expiration
- Age-based automated workflows
- Comparison of age vs. maintenance costs
- Bulk update of purchase dates via import

## References

- [Custom Fields Documentation](../custom-fields.md)
- [Filter Pattern Documentation](../filtering.md)
- [Select All Pattern](../select-all-pattern.md)
- User Request: [Original Feature Request Link]

---

**Approval Sign-off**

- [ ] Product Manager: ******\_\_\_******
- [ ] Engineering Lead: ******\_\_\_******
- [ ] Design Lead: ******\_\_\_******
- [ ] Stakeholder: ******\_\_\_******

**Next Steps**: Review PRD with team → Create implementation tickets → Design mockups → Begin development
