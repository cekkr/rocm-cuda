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
    return new Promise((res) => {
        const results = [];

        fs.createReadStream(filePath)
            .pipe(csv({ headers: ['cuda0', 'cuda1', 'cuda2', 'cuda3', 'cuda4', 'hip0', 'hip1', 'hip2', 'hip3', 'hip4'] }))
            .on('data', (data) => results.push(data))
            .on('end', () => {
                // important cuda0 and hip0 (functions names)
                res(results)
            })
            .on('error', (error) => {
                console.error('Error reading the CSV file:', error);
            });
    })
}

function readJson(path) {
    let json = fs.readFileSync(path)
    return JSON.parse(json)
}

function organizeCudaApi(api) {
    let funs = {}
    for (let m in api.modules) {
        let mod = api.modules[m]
        for (let fun of mod) {
            funs[fun.name] = fun
        }
    }

    return { functions: funs }
}

let initPrediction =
    `
#include <iostream>
#include <hip/hip_runtime.h>
#include <hip/hip.h>
#include <cuda_runtime_api.h>

#DEFINE VERBOSE 1

cudaError_t hipErrorToCudaError(hipError_t hipError);

// cudaError_t cudaGetDeviceCount(int *count) using hipGetDeviceCount(int *count)
extern "C" cudaError_t cudaGetDeviceCount(int * count)
{
    if(VERBOSE) std::cout << "Intercepted cudaGetDeviceCount call" << std::endl;
    // Translate the call to its HIP counterpart
    hipError_t hipError = hipGetDeviceCount(count);

    return hipErrorToCudaError(hipError);
}

`

let status = { functions: {} }

function loadStatus() {
    if (fs.existsSync('status.json')) {
        let json = fs.readFileSync('status.json').toString()
        status = JSON.parse(json)
    }
}

function saveStatus() {
    let json = JSON.stringify(status)
    fs.writeFileSync('status.json', json)
}

// study enum structs: https://docs.amd.com/projects/HIP/en/latest/doxygen/html/hip__runtime__api_8h.html#

async function main() {
    loadStatus()

    let hipify = await parseCSV('./input/cuda_runtime.csv');

    let cudaApi = readJson('./input/cuda_api.json')
    cudaApi = organizeCudaApi(cudaApi)

    let hipApi = readJson('./input/hip_api.json')

    for (let r in hipify) {
        try {
            let row = hipify[r]
            let cuda = row['cuda0']
            let hip = row['hip0']
            if (cuda && hip && cuda.startsWith('cuda') && hip.startsWith('hip')) {

                let statusFun = status.functions[cuda]

                if (!statusFun) {
                    let cudaFun = cudaApi.functions[cuda]
                    let hipFun = hipApi.functions[hip]

                    let cudaLine = cudaFun.return + ' '
                    cudaLine += cudaFun.name + ' '
                    cudaLine += cudaFun.args

                    let hipLine = hipFun.definition[0] + ' ' + hipFun.argsstring[0]

                    statusFun = status.functions[cuda] = {
                        cuda,
                        hip,
                        cudaFun,
                        hipFun,
                        cudaLine,
                        hipLine
                    }

                    let graft = '// ' + cudaLine + ' using ' + hipLine + '\n'
                    graft += 'extern "C" ' + cudaLine + ' {\n'

                    let totGraft = initPrediction + graft

                    console.log("Going to predict ", cuda, "\n", totGraft)
                    let prediction = await requestCodeLlama(totGraft)
                    console.log("prediction ", cuda, '\n', prediction)

                    statusFun.prediction = prediction
                    saveStatus()
                }
            }
        }
        catch {
            console.log('line ', r, ' jumped')
        }
    }

    console.log("execution ends")
}

main()
