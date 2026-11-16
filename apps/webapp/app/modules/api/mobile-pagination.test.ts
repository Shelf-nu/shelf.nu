import { parseMobilePagination } from "./mobile-pagination";

/** Parses one query string with the default page size and ceiling. */
function parse(qs: string) {
  return parseMobilePagination(new URLSearchParams(qs));
}

describe("parseMobilePagination", () => {
  it("defaults to the first page of 20", () => {
    expect(parse("")).toEqual({ page: 1, perPage: 20, skip: 0 });
  });

  it("reads a valid page and page size", () => {
    expect(parse("page=3&perPage=10")).toEqual({
      page: 3,
      perPage: 10,
      skip: 20,
    });
  });

  it("floors a fractional page rather than falling back to page 1", () => {
    // 2.5 discriminates: flooring gives page 2, a fallback would give 1.
    expect(parse("page=2.5")).toEqual({ page: 2, perPage: 20, skip: 20 });
  });

  it("floors a fractional page size", () => {
    expect(parse("perPage=2.5").perPage).toBe(2);
  });

  it("reads exponent notation as the number it spells", () => {
    expect(parse("page=1e1").page).toBe(10);
  });

  it.each(["0", "-3", "abc", "", "Infinity", "NaN"])(
    "falls back to the first page for page=%s",
    (bad) => {
      expect(parse(`page=${bad}`)).toMatchObject({ page: 1, skip: 0 });
    }
  );

  it("falls back to the first page when the offset would overflow", () => {
    // 1.79e308 is finite AND an integer, so validating the input alone lets
    // it through; the overflow only appears once it is multiplied by perPage.
    const result = parse("page=1.7976931348623157e308");

    expect(result).toEqual({ page: 1, perPage: 20, skip: 0 });
  });

  it("caps the page size at the ceiling", () => {
    expect(parse("perPage=999").perPage).toBe(50);
  });

  it("honours a caller's default and ceiling", () => {
    const result = parseMobilePagination(new URLSearchParams("perPage=80"), {
      defaultPerPage: 10,
      maxPerPage: 100,
    });

    expect(result.perPage).toBe(80);
    expect(
      parseMobilePagination(new URLSearchParams(""), { defaultPerPage: 10 })
        .perPage
    ).toBe(10);
  });
});
