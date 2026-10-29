import {describe, it,expect} from "vitest";
import { removeHyphens } from "../src/clean";

describe("removeHyphens", () => {
    it("Joins a word across a line break", () => 
        expect(removeHyphens("to-\ngether")).toBe("together"));

    it("Removes all line breaks in a word", () => {
        expect(removeHyphens("-\nmul-\ntiple-\n")).toBe("multiple");
    });

    it("Preserves version hyphens", () => {
        expect(removeHyphens("...the\n--resolved, -i and -3 options")).toBe("...the\n--resolved, -i and -3 options");
    });

    it("Preserves real hyphens", () => {
        expect(removeHyphens("single-queue")).toBe("single-queue");
    });

    it("Preserves flags", () => {
        expect(removeHyphens("v1.8.5-rc0")).toBe("v1.8.5-rc0");
    })
    });

