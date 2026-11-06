import {expect, it, describe} from "vitest";
import { validateCitations } from "../src/citations";

describe("validateCitations", () => { 
    it("extracts invalid citations", () => {
        const validWeb = ["w1","w2"];
        const validChunks = ["1","2"];
        const text = "[w1] [w2] [w3] [1] [2] [4]";;
        expect(validateCitations(text, validChunks,validWeb)).toStrictEqual({isValid:false, invalid:["w3","4"]});
    })
})