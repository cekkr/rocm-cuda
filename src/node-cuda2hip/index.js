/*
This library uses a simple local http server that runs predictions using CodeLlama 13b model
For confortability, this project could be found in a my personal git server:
http://eswayer.com:3000/riccardo/codellama-center
*/
import { requestCodeLlama } from '../libs/node-codellama-request/index.js'
//import XLSX from 'xlsx'
import fs from 'fs'
import csv from 'csv-parser'

function parseCSV(filePath) {
    const results = [];

    fs.createReadStream(filePath)
        .pipe(csv({ headers: ['cuda0', 'cuda1', 'cuda2', 'cuda3', 'cuda4', 'hip0', 'hip1', 'hip2', 'hip3', 'hip4'] }))
        .on('data', (data) => results.push(data))
        .on('end', () => {
            // important cuda0 and hip0 (functions names)
            console.log(results);
            // Process results here
        })
        .on('error', (error) => {
            console.error('Error reading the CSV file:', error);
        });
}

parseCSV('./input/cuda_runtime.csv');
