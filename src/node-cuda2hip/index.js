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

// hipError_t to cudaError_t
cudaError_t hipError_t_TO_cudaError_t(hipError_t hipError);

`

let initPredictionFunctions =
    `
// cudaError_t cudaGetDeviceCount(int *count) using hipGetDeviceCount(int *count)
extern "C" cudaError_t cudaGetDeviceCount(int * count)
{
    if(VERBOSE) std::cout << "Intercepted cudaGetDeviceCount call" << std::endl;
    // Translate the call to its HIP counterpart
    hipError_t hipError = hipGetDeviceCount(count);

    return hipErrorToCudaError(hipError);
}

`

let status = { functions: {}, types: {} }

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

    let pointers = []

    let hip2Cuda = {}
    let cuda2Hip = {}

    let types = {
        hip: [],
        cuda: []
    }

    for (let r in hipify) {
        try {
            let row = hipify[r]
            let cuda = row['cuda0']
            let hip = row['hip0']
            if (cuda && hip && cuda.startsWith('cuda') && hip.startsWith('hip')) {

                hip2Cuda[hip] = cuda
                cuda2Hip[cuda] = hip

                let statusFun = status.functions[cuda]

                if (!statusFun) {
                    let cudaFun = cudaApi.functions[cuda]
                    cudaFun.args = cudaFun.args.replaceAll(' ', ' ').replaceAll(' * ', '* ').trim()

                    cudaFun.types = []
                    let argsTyped = [...cudaFun.args.split(','), cudaFun.return]
                    for (let arg of argsTyped) {
                        while (arg[0] == ' ') arg.splice(0, 1)
                        let type = arg.split(' ')[0]
                        let pointer = type.includes('*')
                        type = type.replace('*').trim()
                        pointers[type] = pointer

                        if (cudaFun.types.indexOf(type) < 0)
                            cudaFun.types.push(type)

                        if (types.cuda.indexOf(type) < 0)
                            types.cuda.push(type)
                    }

                    let hipFun = hipApi.functions[hip]
                    hipFun.return = hipFun.type[0].ref[0]['_']
                    hipFun.types = []

                    for (let param of [...hipFun.param, hipFun]) {
                        let type = param.type[0]

                        if (typeof type == 'object') {
                            type = type['ref'][0]['_']
                        }

                        let pointer = type.includes('*')
                        type = type.replace('*').trim()
                        pointers[type] = pointer

                        if (hipFun.types.indexOf(type) < 0)
                            hipFun.types.push(type)

                        if (types.hip.indexOf(type) < 0)
                            types.hip.push(type)
                    }

                    let cudaLine = cudaFun.return + ' '
                    cudaLine += cudaFun.name + ' '
                    cudaLine += cudaFun.args

                    let hipLine = hipFun.definition[0] + ' ' + hipFun.argsstring[0]

                    let graft = '// ' + cudaLine + ' using ' + hipLine + '\n'
                    graft += 'extern "C" ' //+ cudaLine + ' {\n'

                    //let totGraft = initPrediction + graft

                    statusFun = status.functions[cuda] = {
                        cuda,
                        hip,
                        cudaFun,
                        hipFun,
                        cudaLine,
                        hipLine,
                        graft                        
                    }
                }
                else {
                    console.log(cuda, " already done.")
                }
            }
        }
        catch {
            console.log('line ', r, ' jumped')
        }
    }

    ///
    ///
    ///
    console.log("generate converters")

    let allTypes = [...types.cuda, ...types.hip]
    for (let t of allTypes) {
        if (!t.includes('hip') && !t.includes('cuda'))
            continue;

        let type = status.types[t] = status.types[t] || { onPrediction: 0, goToPrediction: 0 }

        if (type.onPrediction == 0) {
            type.pointer = pointers[t] || false
            let ptr = type.pointer ? '*' : ''

            if (hip2Cuda[type]) {
                let toType = hip2Cuda[type]
                type.converter = '// ' + type + ptr + ' to ' + toType + ptr + '\n'
                type.converter += toType + ptr + ' ' + type + '_TO_' + toType + '(' + type + ptr + ');\n'
            }

            if (cuda2Hip[type]) {
                let toType = cuda2Hip[type]
                type.converter = '// ' + type + ptr + ' to ' + toType + ptr + '\n'
                type.converter += toType + ptr + ' ' + type + '_TO_' + toType + '(' + type + ptr + ');\n'
            }

            type.graft = type.converter
        }
    }

    saveStatus()

    async function checkType(t) {
        let type = status.types[t]
        while (type.onPrediction < type.goToPrediction) {

            console.log("Going to predict ", t, "\n", type.graft)
            let prediction = await requestCodeLlama(type.graft)
            console.log("prediction ", t, '\n', prediction)
            type.graft = prediction

            type.onPrediction++

            saveStatus()
        }

        return type.graft
    }

    ///
    ///
    ///
    console.log("beginning functions predictions")

    for (let f in status.functions) {
        let fun = status.functions[f]

        if (fun.cudaFun && fun.hipFun) {
            if(!fun.prediction || fun.forcePrediction){
                let typesGrafts = ''

                for (let type of fun.cudaFun.types) {
                    typesGrafts += await checkType(type) + '\n'
                }

                for (let type of fun.hipFun.types) {
                    typesGrafts += await checkType(type) + '\n'
                }

                let totGraft = initPrediction + typesGrafts + initPredictionFunctions + fun.graft

                console.log("Going to predict ", cuda, "\n", totGraft)
                let prediction = await requestCodeLlama(totGraft)
                console.log("prediction ", cuda, '\n', prediction)

                fun.prediction = prediction
                fun.forcePrediction = false 
                
                saveStatus()
            }
        }
    }


    console.log("execution ends")
}

main()
