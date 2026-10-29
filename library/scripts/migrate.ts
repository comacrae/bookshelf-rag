import {readdir, readFile} from "node:fs/promises"
import path from "node:path"
import { pool } from "@/src/db";
import { PathLike } from "node:fs";

async function readFilepaths(migrationDirpath:PathLike):Promise<string[]> {
    /*
    * Read all files from given path and return names of files ending in .sql in order 
    * Dirpath is relative to working path library/
    */
    // read all files in migration dir
    const files = await readdir(migrationDirpath);
    // filter to only get files ending in .sql and sort ascending
    return files.filter((file) => file.endsWith('.sql')).sort()
}

async function applyMigrations(migrationDir="migrations"): Promise<void> {
    /*
    * Read the contents of a file and apply the migration 
    */
   // build migration dir path 
   const migrationDirPath = path.join(process.cwd(), migrationDir);
   // read in files
   const files = await readFilepaths(migrationDirPath);
   //init client
   const client = await pool.connect();

   

   try{

        //create migrations table if it doesnt exist yet
        await client.query(`
            create table if not exists schema_migrations
            (
                filename text not null primary key,
                applied_at timestamptz not null default now()
            );
        `);
        // get already applied migrations
        const results = await client.query<{filename:string}>('SELECT filename FROM schema_migrations');
        const prevApplied = new Set(results.rows.map((row) => row.filename));
        const migrationsToApply = files.filter((file) => !prevApplied.has(file));

        if(migrationsToApply.length === 0)
            console.log('No migrations to apply');

       // for each file
        for (const file of migrationsToApply){
            try{
                // read contents
                const contents = await readFile(path.join(migrationDirPath, file), {encoding:'utf-8'});

                //attempt to apply
                await client.query('BEGIN TRANSACTION;');
                await client.query(contents);
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT;')
                console.log(`Applied migration: ${file}`);

            }catch(err){
                // on error print filename that caused error, rollback failed query, and throw to handler so we release client
                console.error(`Error occurred processing file: ${file}`);
                await client.query('ROLLBACK;');
                throw err;
            }            
        }
   }finally{
    client.release();
   }
   return;
}

applyMigrations().finally(()=> pool.end()); // run migration and close pool's connections