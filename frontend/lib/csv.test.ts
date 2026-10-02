/**
 * The CSV reader, on the input it will actually be given.
 *
 * Every case here is a real paste shape, not a synthetic edge case. The quoted
 * comma one is the reason this module exists: `split(",")` turns
 * `"Bio-NPK, liquid"` into two cells and the operator is then told their price
 * column is missing, which sends them looking in the wrong place.
 */

import { describe, expect, it } from "vitest";

import { normaliseHeader, parseCsv, parseCsvToObjects } from "./csv";

describe("parseCsv", () => {
  it("reads a plain comma-separated paste", () => {
    const { header, records } = parseCsvToObjects(
      "sku_code,min_quantity,max_quantity,price\nVBT-001,1,10,450\nVBT-001,11,50,420"
    );
    expect(header).toEqual(["sku_code", "min_quantity", "max_quantity", "price"]);
    expect(records).toEqual([
      { sku_code: "VBT-001", min_quantity: "1", max_quantity: "10", price: "450" },
      { sku_code: "VBT-001", min_quantity: "11", max_quantity: "50", price: "420" },
    ]);
  });

  it("reads a tab-separated paste, which is what Excel actually copies", () => {
    const { records } = parseCsvToObjects(
      "sku_code\tmin_quantity\tprice\nVBT-001\t51\t400"
    );
    expect(records).toEqual([{ sku_code: "VBT-001", min_quantity: "51", price: "400" }]);
  });

  it("keeps a comma that is inside a quoted cell", () => {
    const { records } = parseCsvToObjects(
      'name,category,sku_code,price\n"Bio-NPK, liquid",Fertiliser,VBT-001,450'
    );
    expect(records[0]?.name).toBe("Bio-NPK, liquid");
    expect(records[0]?.price).toBe("450");
  });

  it("reads a doubled quote inside a quoted cell as one quote", () => {
    const { records } = parseCsvToObjects('note\n"the ""premium"" rate"');
    expect(records[0]?.note).toBe('the "premium" rate');
  });

  it("survives Windows line endings and a trailing blank line", () => {
    const { records } = parseCsvToObjects("sku_code,price\r\nVBT-001,450\r\n\r\n");
    expect(records).toHaveLength(1);
    expect(records[0]?.sku_code).toBe("VBT-001");
  });

  it("pads a short row rather than rejecting it", () => {
    // A spreadsheet row whose last cell is empty is copied with no trailing
    // delimiter. That is ordinary input, not a malformed row.
    const { records } = parseCsvToObjects(
      "sku_code,min_quantity,max_quantity,price\nVBT-001,51,,400\nVBT-002,1,10"
    );
    expect(records[0]?.max_quantity).toBe("");
    expect(records[1]?.price).toBe("");
  });

  it("normalises header spelling so 'Min Quantity' and 'min_quantity' both work", () => {
    expect(normaliseHeader("Min Quantity")).toBe("min_quantity");
    expect(normaliseHeader("SKU Code")).toBe("sku_code");
    expect(normaliseHeader("Max-Quantity")).toBe("max_quantity");
    expect(normaliseHeader("  Price (₹) ")).toBe("price_");
  });

  it("returns nothing for empty input instead of a phantom row", () => {
    expect(parseCsv("")).toEqual({ header: [], rows: [] });
    expect(parseCsv("   \n  \n")).toEqual({ header: [], rows: [] });
  });
});
