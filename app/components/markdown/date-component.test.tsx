import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateComponent } from "./date-component";

// Mock the DateS component
vi.mock("~/components/shared/date", () => ({
  DateS: vi.fn(({ date, includeTime }) => (
    <span data-testid="date-s" data-date={date} data-include-time={includeTime}>
      Mocked DateS: {date} (includeTime: {includeTime?.toString()})
    </span>
  )),
}));

describe("DateComponent", () => {
  it("should render DateS with provided date value", () => {
    const { getByTestId } = render(
      <DateComponent value="2023-12-25T10:30:00.000Z" />
    );

    const dateElement = getByTestId("date-s");
    expect(dateElement).toBeInTheDocument();
    expect(dateElement.getAttribute("data-date")).toBe(
      "2023-12-25T10:30:00.000Z"
    );
  });

  it("should default includeTime to true", () => {
    const { getByTestId } = render(
      <DateComponent value="2023-12-25T10:30:00.000Z" />
    );

    const dateElement = getByTestId("date-s");
    expect(dateElement.getAttribute("data-include-time")).toBe("true");
  });

  it("should pass includeTime as false when specified", () => {
    const { getByTestId } = render(
      <DateComponent value="2023-12-25T10:30:00.000Z" includeTime={false} />
    );

    const dateElement = getByTestId("date-s");
    expect(dateElement.getAttribute("data-include-time")).toBe("false");
  });

  it("should pass includeTime as true when explicitly specified", () => {
    const { getByTestId } = render(
      <DateComponent value="2023-12-25T10:30:00.000Z" includeTime={true} />
    );

    const dateElement = getByTestId("date-s");
    expect(dateElement.getAttribute("data-include-time")).toBe("true");
  });

  it("should handle different date formats", () => {
    const dateValue = "2024-01-01T00:00:00.000Z";
    const { getByTestId } = render(
      <DateComponent value={dateValue} includeTime={false} />
    );

    const dateElement = getByTestId("date-s");
    expect(dateElement.getAttribute("data-date")).toBe(dateValue);
    expect(dateElement.getAttribute("data-include-time")).toBe("false");
  });

  it("should render with expected content from DateS component", () => {
    const { getByText } = render(
      <DateComponent value="2023-12-25T10:30:00.000Z" includeTime={false} />
    );

    expect(
      getByText("Mocked DateS: 2023-12-25T10:30:00.000Z (includeTime: false)")
    ).toBeInTheDocument();
  });
});
