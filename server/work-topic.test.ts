// Fork: which card an assignment is about, so a code agent keeps one thread per card.
import { expect, it } from "vitest";
import { workTopicOf } from "./work-topic.ts";

it("reads the card id from an assignment, however the PM writes it", () => {
  expect(workTopicOf("Doel: dezelfde kaart 2a1ceef4-0301-4a8a-903b-ca4b773cbfb1: twee leveringen")).toBe("2a1ceef4");
  expect(workTopicOf("gerichte afwerking op dezelfde kaart2a1ceef4; Wiebren vroeg")).toBe("2a1ceef4");
  expect(workTopicOf("Kaart D3D9DED6: header")).toBe("d3d9ded6");
  expect(workTopicOf("card aaaa1111 follow-up")).toBe("aaaa1111");
  expect(workTopicOf("fix de header, geen kaart genoemd")).toBeUndefined();
  expect(workTopicOf("commit 52477c1 en kaart d3d9ded6 na kaart 2a1ceef4")).toBe("d3d9ded6");
});
