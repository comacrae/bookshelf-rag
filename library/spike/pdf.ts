import { readFile } from "node:fs/promises";
import { PathLike } from "node:fs";
import {extractText, getDocumentProxy} from "unpdf";
import path from "node:path";

async function readPdf(filepath:PathLike, page:number):Promise<void>{
    /*
    * Read a pdf file and return string from given page
    */

   // read the file buffer and convert it to a byte array for unpdf
   const buffer = new Uint8Array(await readFile(filepath));

   // decode the buffer
    const pdf = await getDocumentProxy(buffer);

   // extract pages
    const extraction =  await extractText(pdf, {mergePages:false});

    console.log(`Total pages: ${extraction.totalPages}`)
    console.log(`Extraction from page idx ${page}:`);
    console.log(extraction.text[page]);
}

async function exec(corpusPath="./corpus"):Promise<void>{
    /*
    * Read the pdf file for given args
    */

    const filename = process.argv[2];
    const pageNum = Number(process.argv[3]);

    const filepath = path.join(corpusPath, filename);
    await readPdf(filepath, pageNum);
};

exec().then(()=>console.log("Read complete"));