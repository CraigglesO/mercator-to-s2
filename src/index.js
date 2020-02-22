import os from 'os'
import { Worker } from 'worker_threads'

import type { Options, S2Tile } from './worker'

const log = require('single-line-log').stdout

export default class ToS2 {
  options: Options
  outputZoom: number = 0
  maxThreadCount: number = os.cpus().length
  workers: { [string | number]: Worker }
  constructor (options?: Options = {}, maxThreadCount?: number) {
    this.options = options
    if (options.outputZoom) this.outputZoom = options.outputZoom
    if (maxThreadCount) this.maxThreadCount = Math.max(Math.min(this.maxThreadCount, maxThreadCount), 1)
  }

  buildTiles () {
    const self = this
    const zoom = self.options.outputZoom
    // find total
    let finished = 0
    const total = (1 << zoom) * (1 << zoom) * 6
    // prep iterator
    const iterator = tileGenerator(zoom)

    // prep workers
    for (let i = 0; i < self.maxThreadCount; i++) {
      const worker = new Worker('./lib/worker.js', { workerData: { options: self.options } })

      worker.on('message', (response) => {
        const { status, built } = response

        if (built) {
          finished++
          log(`${finished}/${total}`)
        }

        if (status === 'ready') {
          const next = iterator.next()
          if (!next.done) {
            const s2tile: S2Tile = next.value
            worker.postMessage({ type: 'build', s2tile })
          } else {
            worker.terminate()
          }
        }
      })

      worker.on('error', (err) => {
        console.log('Worker ERROR', err)
      })
    }
  }
}

function * tileGenerator (zoom: number) {
  const xySize = 1 << zoom
  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < xySize; y++) {
      for (let x = 0; x < xySize; x++) {
        yield { face, zoom, x, y }
      }
    }
  }
}
