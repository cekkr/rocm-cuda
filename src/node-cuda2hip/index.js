/*
This library uses a simple local http server that runs predictions using CodeLlama 13b model
For confortability, this project could be found in a my personal git server:
http://eswayer.com:3000/riccardo/codellama-center
*/
import { requestCodeLlama } from '../libs/node-codellama-request/index.js'
//import XLSX from 'xlsx'
import fs from 'fs'
import csv from 'csv-parser'

const llamaHost = '192.168.1.102:9500'

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

`
/* REMOVED:
// hipError_t to cudaError_t
cudaError_t hipError_t_TO_cudaError_t(hipError_t hipError);
*/

let initPredictionFunctions =
    `
// cudaError_t cudaGetDeviceCount(int* count) using hipGetDeviceCount(int* count)
extern "C" cudaError_t cudaGetDeviceCount(int* count)
{
    if(VERBOSE) std::cout << "Intercepted cudaGetDeviceCount call" << std::endl;
    // Translate the call to its HIP counterpart
    hipError_t hipError = hipGetDeviceCount(count);

    return hipError_t_TO_cudaError_t(hipError);
}

`

let status = { functions: {}, types: {}, ignoredFunctions: [], requestedConverters: [] }

function loadStatus() {
    if (fs.existsSync('status.json')) {
        let json = fs.readFileSync('status.json').toString()
        status = JSON.parse(json)
    }
}

function saveStatus() {
    let json = JSON.stringify(status, null, 2)
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
                    let hipFun = hipApi.functions[hip]

                    if (!cudaFun || !hipFun) {
                        status.ignoredFunctions.push([cuda, hip])
                        continue;
                    }

                    cudaFun.args = cudaFun.args.replaceAll(' ', ' ').replaceAll(' * ', '* ').trim().replace('(', '').replace(')', '')

                    cudaFun.types = []
                    let argsTyped = [...cudaFun.args.split(','), cudaFun.return]
                    for (let arg of argsTyped) {
                        arg = arg.trim()
                        let type = arg.split(' ')[0]
                        let pointer = type.includes('*')
                        type = type.replace('*').trim()
                        pointers[type] = pointer

                        if (cudaFun.types.indexOf(type) < 0)
                            cudaFun.types.push(type)

                        if (types.cuda.indexOf(type) < 0)
                            types.cuda.push(type)
                    }

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
                    cudaLine += '(' + cudaFun.args + ')'

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
        catch (err) {
            console.error(err)
            console.log('line ', r, ' jumped')
        }
    }

    ///
    ///
    ///
    console.log("generate converters")

    function generateTypeGraft(t) {
        let type = status.types[t] = status.types[t] || { onPrediction: 0, goToPrediction: 0 }

        if (type.onPrediction == 0) {
            type.pointer = pointers[t] || false
            let ptr = type.pointer ? '*' : ''

            if (!type.converter) {
                if (hip2Cuda[t]) {
                    let toType = type.toType = hip2Cuda[t]
                    type.converter = '// ' + t + ptr + ' to ' + toType + ptr + '\n'
                    type.converterName = t + '_TO_' + toType
                    type.converter += toType + ptr + ' ' + type.converterName + '(' + t + ptr + ');\n'

                    generateTypeGraft(toType)
                }

                if (cuda2Hip[t]) {
                    let toType = type.toType = cuda2Hip[t]
                    type.converter = '// ' + t + ptr + ' to ' + toType + ptr + '\n'
                    type.converterName = t + '_TO_' + toType
                    type.converter += toType + ptr + ' ' + type.converterName + '(' + t + ptr + ');\n'

                    generateTypeGraft(toType)
                }

                type.graft = type.converter
            }
        }
    }

    let allTypes = [...types.cuda, ...types.hip]
    for (let t of allTypes) {
        if (!t.includes('hip') && !t.includes('cuda'))
            continue;

        generateTypeGraft(t)
    }

    saveStatus()

    async function checkType(t) {
        let type = status.types[t]
        if (type) {
            while (type.onPrediction < type.goToPrediction) {

                console.log("Going to predict ", t, "\n", type.graft)
                let prediction = await requestCodeLlama(type.graft, llamaHost)
                console.log("prediction ", t, '\n', prediction)
                type.graft = prediction

                type.onPrediction++

                saveStatus()
            }

            let res = {}
            res[t] = type.converter

            if (status.requestedConverters.indexOf(type.converterName) < 0)
                status.requestedConverters.push(type.converterName)

            let toType = status.types[type.toType]
            if (toType) {
                res[type.toType] = toType.converter

                if (status.requestedConverters.indexOf(toType.converterName) < 0)
                    status.requestedConverters.push(toType.converterName)
            }

            return res
        }
        else {
            console.warn("check exception 24234")
        }
    }

    ///
    ///
    ///
    console.log("beginning functions predictions")

    for (let f in status.functions) {
        let fun = status.functions[f]

        if (fun.cudaFun && fun.hipFun) {
            if (!fun.prediction || fun.forcePrediction) {
                let typesGrafts = {}

                for (let type of fun.cudaFun.types) {
                    let graft = await checkType(type)
                    if (graft)
                        typesGrafts = { ...typesGrafts, ...graft }
                }

                for (let type of fun.hipFun.types) {
                    let graft = await checkType(type)
                    if (graft)
                        typesGrafts = { ...typesGrafts, ...graft }
                }

                let strTypesGrafts = ''
                for (let t in typesGrafts) {
                    let graft = typesGrafts[t]
                    strTypesGrafts += graft + '\n'
                }

                let totGraft = fun.prediction || (initPrediction + strTypesGrafts + initPredictionFunctions + fun.graft)

                console.log("Going to predict ", fun.cuda, "\n", totGraft)
                let prediction = await requestCodeLlama(totGraft, llamaHost)
                console.log("prediction ", fun.cuda, '\n', prediction)

                fun.prediction = prediction
                fun.forcePrediction = false

                saveStatus()
            }
            else {
                console.log(f, ' already predicted')
            }
        }
    }


    console.log("execution ends")
}

main()
