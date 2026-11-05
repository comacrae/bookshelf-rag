import {it, describe, expect} from "vitest";
import { rrf} from "../src/rrf";
import type { Hit } from "../src/retrieval";
const fake = (id: string): Hit => ({ id, bookId: "x", page: 1, pageEnd: 1, content: "", score: 0 });
describe("rrf", () => {
    /*
                   list 1    list 2    total
        A          1st       -         1/61          = 0.0164
        B          2nd       1st       1/62 + 1/61   = 0.0325  ← in both lists
        C          -         2nd       1/62          = 0.0161
    */
    it("returns expected order", () => {
        const l1 = [fake('A'), fake('B')];
        const l2 = [fake('B'), fake('C')];
        expect(rrf([l1,l2]).flatMap((hit) => hit.id)).toStrictEqual(['B','A','C'])
    })

})