import fs from 'fs'
import SphericalMercator from '@mapbox/sphericalmercator'
import { S2Point, S2LonLat, bboxST } from 's2projection'
import { PNG } from 'pngjs'

import type { Face } from 's2projection'

const LAT_BOUND = 85.05

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

export default class ToS2 {
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
  constructor (options?: Options = {}) {
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
  }

  // after prepping, we convert raster images from Mercator to S2
  convert (tiles?: Array<S2Tile>) {
    // if tiles does not exist, we build a set of ALL tiles at said zoom
    if (!tiles) tiles = buildZoomSet(this.outputZoom)
    // run through each tile
    for (const tile of tiles) {
      const { face, zoom, x, y } = tile
      if (fs.existsSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x + '/' + y + '.png')) continue
      // sanity check
      if (zoom !== this.outputZoom) continue
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
    }
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
    const buffer = Buffer.from(data)
    this.outPNG.data = buffer

    const outBuffer = PNG.sync.write(this.outPNG)
    if (!fs.existsSync(this.outputFolder + '/' + face)) fs.mkdirSync(this.outputFolder + '/' + face)
    if (!fs.existsSync(this.outputFolder + '/' + face + '/' + zoom)) fs.mkdirSync(this.outputFolder + '/' + face + '/' + zoom)
    if (!fs.existsSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x)) fs.mkdirSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x)
    fs.writeFileSync(this.outputFolder + '/' + face + '/' + zoom + '/' + x + '/' + y + '.png', outBuffer)
  }
}

function toID (z, x, y) {
  return (((1 << z) * y + x) * 32) + z
}

function buildZoomSet (zoom: number) {
  const tiles = []
  for (let face = 0; face < 6; face++) {
    const xySize = 1 << zoom
    for (let y = 0; y < xySize; y++) {
      for (let x = 0; x < xySize; x++) {
        tiles.push({ face, zoom, x, y })
      }
    }
  }

  return tiles
}
