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

cudaError_t hipErrorToCudaError(hipError_t hipError)
{
    switch (hipError) {
        case hipSuccess:
            return cudaSuccess;
        case hipErrorOutOfMemory:
            return cudaErrorMemoryAllocation;
        case hipErrorNotInitialized:
            return cudaErrorInitializationError;
        case hipErrorDeinitialized:
            return cudaErrorCudartUnloading;
        case hipErrorProfilerDisabled:
        case hipErrorProfilerNotInitialized:
        case hipErrorProfilerAlreadyStarted:
        case hipErrorProfilerAlreadyStopped:
            // There is no direct equivalent in CUDA for these,
            // so we use a generic error
            return cudaErrorUnknown;
        case hipErrorInvalidValue:
            return cudaErrorInvalidValue;
        case hipErrorInvalidDevicePointer:
            return cudaErrorInvalidDevicePointer;
        case hipErrorInvalidMemcpyDirection:
            return cudaErrorInvalidMemcpyDirection;
        // Add more cases as needed
        default:
            // For any error not explicitly mapped above, return a generic error
            return cudaErrorUnknown;
    }
}

// cudaError_t cudaGetDeviceCount(int *count) using hipGetDeviceCount(int *count)
extern "C" cudaError_t cudaGetDeviceCount(int * count)
{
    std:: cout << "Intercepted cudaGetDeviceCount call" << std:: endl;
    // Translate the call to its HIP counterpart
    hipError_t hipError = hipGetDeviceCount(count);

    return hipErrorToCudaError(hipError);
}

`

async function main() {
    let hipify = await parseCSV('./input/cuda_runtime.csv');

    let cudaApi = readJson('./input/cuda_api.json')
    cudaApi = organizeCudaApi(cudaApi)

    let hipApi = readJson('./input/hip_api.json')

    console.log("check")
}

main()
