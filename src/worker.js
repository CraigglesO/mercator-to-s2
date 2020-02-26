import { workerData, parentPort } from 'worker_threads'
import fs from 'fs'
import SphericalMercator from '@mapbox/sphericalmercator'
import { S2Point, S2LonLat, bboxST } from 's2projection'
import { PNG } from 'pngjs'

import type { Face } from 's2projection'

const LAT_BOUND = 85.05

type Images = {
  [string]: PNG // encoded x + y + zoom ID
}

type OutPNG = {
  width: number,
  height: number,
  depth: number,
  interlace: boolean,
  palette: boolean,
  color: boolean,
  alpha: boolean,
  bpp: number,
  colorType: number,
  data: Buffer,
  gamma: number
}

export type Options = {
  inputZoom?: number,
  inputFolder?: string,
  outputZoom?: number,
  outputFolder?: string,
  tileSize?: number,
  tmsStyle?: boolean,
  srs?: 'WGS84' | '900913',
  defaultColor?: [number, number, number, number]
}

export type S2Tile = {
  face: Face,
  zoom: number,
  x: number,
  y: number
}

export type WorkOrder = {
  type: 'build',
  s2tile?: S2Tile
}

class Worker {
  inputZoom: number = 2
  inputFolder: string = './img'
  outputZoom: number = 0
  outputFolder: string = './out'
  tileSize: number = 512
  tmsStyle: boolean = true
  srs: 'WGS84' | '900913' = '900913'
  maxPixelSize: number
  merc: SphericalMercator
  inputImages: Images = {}
  outPNG: OutPNG
  defaultColor: [number, number, number, number] = [9, 8, 17, 255]
  constructor () {
    const options: Options = workerData.options
    // pull in options
    if (options.inputZoom) this.inputZoom = options.inputZoom
    if (options.inputFolder) this.inputFolder = options.inputFolder
    if (options.outputZoom) this.outputZoom = options.outputZoom
    if (options.outputFolder) this.outputFolder = options.outputFolder
    if (options.tileSize) this.tileSize = options.tileSize
    if (options.tmsStyle) this.tmsStyle = options.tmsStyle
    if (options.srs) this.srs = options.srs
    if (options.defaultColor) this.defaultColor = options.defaultColor
    // set maxPixelSize based upon inputs
    this.maxPixelSize = (1 << this.inputZoom) * this.tileSize
    // prep mercator projection
    this.merc = new SphericalMercator({ size: this.tileSize })

    parentPort.postMessage({ status: 'ready' })
  }

  onMessage (workOrder: WorkOrder) {
    const { type, s2tile } = workOrder
    if (type === 'build') {
      const { face, zoom, x, y } = s2tile
      this.buildTile(face, zoom, x, y)
    }
  }

  buildTile (face: Face, zoom: number, x: number, y: number) {
    if (fs.existsSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x + '/' + y + '.png')) {
      return parentPort.postMessage({ status: 'ready', built: true })
    }
    // sanity check
    if (zoom !== this.outputZoom) return parentPort.postMessage({ status: 'ready' })
    // get tile's ST-bounds
    const bbox = bboxST(x, y, zoom)
    // use tileSize to build a 512x512 pixel image
    const outputData = new Array(this.tileSize * this.tileSize * 4)
    for (let j = 0; j < this.tileSize; j++) {
      for (let i = 0; i < this.tileSize; i++) {
        // for each pixel of said projection, convert from st to ll and than
        // to mercator projections tile and pixel position
        // first get ST
        const s = bbox[0] + i * (bbox[2] - bbox[0]) / this.tileSize
        const t = bbox[1] + j * (bbox[3] - bbox[1]) / this.tileSize
        const s2Point = S2Point.fromST(face, s, t)
        // convert to LonLat and ensure data within bounds
        const llPoint = S2LonLat.fromS2Point(s2Point)
        llPoint.normalize()
        if (llPoint.lat < -LAT_BOUND) llPoint.lat = -LAT_BOUND
        else if (llPoint.lat > LAT_BOUND) llPoint.lat = LAT_BOUND
        // now get the actual pixel position in the mercator projection
        const px = this.merc.px([llPoint.lon, llPoint.lat], this.inputZoom, this.tmsStyle, this.srs)
        // ensure pixels within bounds
        if (px[0] < 0) px[0] = 0
        else if (px[0] >= this.maxPixelSize) px[0] = this.maxPixelSize - 1
        if (px[1] < 0) px[1] = 0
        else if (px[1] >= this.maxPixelSize) px[1] = this.maxPixelSize - 1
        // get tile and pixel position
        const tileX = Math.floor(px[0] / this.tileSize)
        const tileY = Math.floor(px[1] / this.tileSize)
        const tileXPos = px[0] % this.tileSize
        const tileYPos = px[1] % this.tileSize
        // now request pixel data
        const rgba = this.getPixel(tileX, tileY, tileXPos, tileYPos)
        const idx = (this.tileSize * (this.tileSize - 1 - j) + i) << 2
        outputData[idx] = rgba[0]
        outputData[idx + 1] = rgba[1]
        outputData[idx + 2] = rgba[2]
        outputData[idx + 3] = rgba[3]
      }
    }
    this.flush()
    this.saveImage(face, zoom, x, y, outputData)
    parentPort.postMessage({ status: 'ready', built: true })
  }

  // use positional data to get image's rgb value
  getPixel (tileX: number, tileY: number, tileXPos: number, tileYPos: number): [number, number, number, number] {
    // get tileID
    const id = toID(this.inputZoom, tileX, tileY)
    // if we haven't pulled the image in yet do so now
    if (!this.inputImages[id]) {
      if (!fs.existsSync(this.inputFolder + '/' + this.inputZoom + '/' + tileX + '/' + tileY + '.png')) {
        return this.defaultColor
      }
      this.inputImages[id] = PNG.sync.read(
        fs.readFileSync(this.inputFolder + '/' + this.inputZoom + '/' + tileX + '/' + tileY + '.png')
      )
    }
    // grab the raster and get the rgb
    const raster = this.inputImages[id]
    // if we have yet to build what the outputPNG looks like, do so now
    if (!this.outPNG) {
      this.outPNG = {
        width: raster.width,
        height: raster.height,
        depth: raster.depth,
        interlace: raster.interlace,
        palette: raster.palette,
        color: raster.color,
        alpha: raster.alpha,
        bpp: raster.bpp,
        colorType: raster.colorType,
        gamma: raster.gamma
      }
    }
    // get the appropraite pixel data and send back
    const idx = (this.tileSize * tileYPos + tileXPos) << 2
    return [raster.data[idx], raster.data[idx + 1], raster.data[idx + 2], raster.data[idx + 3]]
  }

  // after each image, we flush so not too many images are open at once
  flush () {
    this.inputImages = {}
  }

  saveImage (face, zoom, x, y, data) {
    const noOutputFlag = this.outPNG === undefined
    if (noOutputFlag) { // set defaults
      this.outPNG = {
        width: 512,
        height: 512,
        depth: 8,
        interlace: false,
        palette: false,
        color: true,
        alpha: true,
        bpp: 4,
        colorType: 6,
        gamma: 0
      }
    }
    const buffer = Buffer.from(data)
    this.outPNG.data = buffer

    const outBuffer = PNG.sync.write(this.outPNG)
    if (!fs.existsSync(this.outputFolder + '/' + face)) try { fs.mkdirSync(this.outputFolder + '/' + face) } catch (err) {}
    if (!fs.existsSync(this.outputFolder + '/' + face + '/' + zoom)) try { fs.mkdirSync(this.outputFolder + '/' + face + '/' + zoom) } catch (err) {}
    if (!fs.existsSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x)) try { fs.mkdirSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x) } catch (err) {}
    fs.writeFileSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x + '/' + y + '.png', outBuffer)
    if (noOutputFlag) delete this.outputPNG
  }
}

function toID (z, x, y) {
  return (((1 << z) * y + x) * 32) + z
}

const worker = new Worker()

parentPort.on('message', worker.onMessage.bind(worker))
