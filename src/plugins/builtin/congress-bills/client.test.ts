import { describe, expect, test } from "bun:test";
import { parseBills } from "./client";

const fixture = JSON.parse(`{
  "bills": [
    {
      "congress": 118,
      "type": "S",
      "number": "5",
      "title": "Older Senate bill",
      "updateDate": "2024-01-02",
      "latestAction": { "actionDate": "2024-01-01", "text": "Introduced in Senate" }
    },
    {
      "congress": 119,
      "type": "HR",
      "number": "1234",
      "title": "A newer House bill",
      "updateDate": "2024-06-01T12:00:00Z",
      "latestAction": { "actionDate": "2024-05-30", "text": "Passed House" }
    }
  ]
}`);

describe("parseBills", () => {
  test("reads number, title, and latest action from two bills, newest update first", () => {
    expect(parseBills(fixture)).toEqual([
      {
        id: "119-hr-1234",
        number: "hr 1234",
        title: "A newer House bill",
        actionDate: "2024-05-30",
        actionText: "Passed House",
      },
      {
        id: "118-s-5",
        number: "s 5",
        title: "Older Senate bill",
        actionDate: "2024-01-01",
        actionText: "Introduced in Senate",
      },
    ]);
  });
});
