# Filtering Advanced Index

## Fields

### id: "ID"

```
type: string
```

### name: "Name"

```
type: string
```

### status: "Status"

```
type: enum (from a set of fixed options)
```

### description: "Description"

```
type: text
```

### valuation: "Value"

```
type: number
```

### availableToBook: "Available to book"

```
type: boolean
```

### createdAt: "Created at"

```
type: Date
```

### category: "Category" - relation category.name

```
type: string
```

### tags: "Tags"

```
type: array
```

### location: "Location" - relation - location.name

```
type: string
```

### kit: "Kit" - relation - kit.name

```
type: string
```

### custody: "Custody" - relation - teamMember.name or user.firstName + user.lastName

```
type: string
```

### CustomField - single line text

```
type: string
```

### CustomField - multiline text

```
type: text
```

### CustomField - BOOLEAN

```
type: boolean
```

### CustomField - DATE

```
type: date
```

### CustomField - OPTION

```
type: enum (from a set of fixed options)
```

## Operators

- string
  - is
  - is not
  - contains
- text
  - contains
- boolean
  - is (true || false)
- date
  - is
  - isNot
  - before
  - after
  - between
- number
  - is
  - isNot
  - >
  - <
  - > =
  - <=
  - between
- enum
  - is
  - isNot
  - in
- array
  - contains
  - contains all
  - contains any
